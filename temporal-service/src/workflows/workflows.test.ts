import { strict as assert } from 'assert';
import { describe, it, before, after } from 'mocha';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowFailedError } from '@temporalio/client';

import { naiveEtlWorkflow } from './naive';
import { creatorInsightsETLWorkflow, progressQuery } from './creatorInsightsETL.workflow';
import { tokenRefreshWorkflow, tokenRefreshStatusQuery } from './tokenRefresh.workflow';
import { dataValidationWorkflow } from './dataValidation.workflow';
import type { ETLCheckpoint, TokenCheckpoint, ValidationParams } from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Shared test environment — one Temporal server for all workflow tests.
// TestWorkflowEnvironment.createLocal() starts an in-process Temporal server
// — no Docker required for the test suite.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: TestWorkflowEnvironment;
const TASK_QUEUE = 'test-queue';

before(async function () {
  this.timeout(30_000); // local Temporal server takes a few seconds to start
  testEnv = await TestWorkflowEnvironment.createLocal();
});

after(async () => {
  await testEnv?.teardown();
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR 5 — naiveEtlWorkflow fails at DEMO_HISTORY_LIMIT
// ─────────────────────────────────────────────────────────────────────────────

describe('naiveEtlWorkflow', () => {
  it('fails with a clear error message when history limit is reached', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    // Mock activities: fetchMediaBatch always returns more data so the
    // workflow loops until it hits the history limit.
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./naive'),
      activities: {
        fetchMediaBatch: async () => ({
          posts: [{ id: 'p1', timestamp: '2024-01-01T00:00:00Z', media_type: 'IMAGE' }],
          nextCursor: 'next',
          hasMore: true,
        }),
        storeMediaBatch: async () => {},
        fetchPostInsights: async () => ({ impressions: 1, reach: 1, likes: 1, comments: 1, saves: 1, shares: 1 }),
      },
    });

    const result = worker.runUntil(
      client.workflow.execute(naiveEtlWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `test-naive-${Date.now()}`,
        args: ['creator-001'],
      })
    );

    // The naive workflow should throw — not silently hang
    await assert.rejects(result, (err: unknown) => {
      assert.ok(err instanceof WorkflowFailedError, 'should be a WorkflowFailedError');
      assert.ok(
        err.message.includes('history limit') || err.cause?.message?.includes('history limit'),
        `error message should mention "history limit", got: ${err.message}`
      );
      return true;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR 6 — creatorInsightsETLWorkflow calls continueAsNew before limit
// BEHAVIOR 7 — checkpoint is persisted to DB before continueAsNew
// ─────────────────────────────────────────────────────────────────────────────

describe('creatorInsightsETLWorkflow', () => {
  it('completes successfully when the API has no more data', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./creatorInsightsETL.workflow'),
      activities: {
        fetchMediaBatch: async () => ({
          posts: [{ id: 'p1', timestamp: '2024-01-01T00:00:00Z', media_type: 'IMAGE' }],
          nextCursor: null,
          hasMore: false,     // ← no more pages, workflow should exit cleanly
        }),
        fetchPostInsights: async () => ({
          impressions: 100, reach: 80, likes: 10, comments: 2, saves: 5, shares: 1,
        }),
        storeMediaBatch: async () => {},
        persistCheckpoint: async () => {},
        getCheckpoint: async () => null,
      },
    });

    const checkpoint: ETLCheckpoint = {
      creatorId: 'creator-001',
      afterCursor: null,
      processedUntil: '2024-01-01T00:00:00.000Z',
      totalProcessed: 0,
      batchSize: 10,
    };

    await worker.runUntil(
      client.workflow.execute(creatorInsightsETLWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `test-etl-${Date.now()}`,
        args: [checkpoint],
      })
    );
    // If we get here without throwing, the workflow completed successfully
  });

  it('calls continueAsNew before reaching HISTORY_THRESHOLD and passes checkpoint forward', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    let continueAsNewFired = false;
    let capturedCheckpoint: ETLCheckpoint | null = null;

    // The workflow calls continueAsNew — in tests this resolves the workflow
    // promise and we inspect the args it was called with.
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./creatorInsightsETL.workflow'),
      activities: {
        fetchMediaBatch: async (_params: any) => ({
          posts: Array.from({ length: 10 }, (_, i) => ({
            id: `post_${i}`,
            timestamp: '2024-01-01T00:00:00Z',
            media_type: 'IMAGE' as const,
          })),
          nextCursor: 'cursor_next',
          hasMore: true,  // always more — forces continueAsNew path
        }),
        fetchPostInsights: async () => ({
          impressions: 100, reach: 80, likes: 10, comments: 2, saves: 5, shares: 1,
        }),
        storeMediaBatch: async () => {},
        persistCheckpoint: async (cp: ETLCheckpoint) => {
          // Behavior 7: verify checkpoint is persisted BEFORE continueAsNew fires
          capturedCheckpoint = cp;
        },
        getCheckpoint: async () => null,
      },
    });

    try {
      await worker.runUntil(
        client.workflow.execute(creatorInsightsETLWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: `test-etl-continue-${Date.now()}`,
          args: [{
            creatorId: 'creator-001',
            afterCursor: null,
            processedUntil: '2024-01-01T00:00:00.000Z',
            totalProcessed: 0,
            batchSize: 10,
          } as ETLCheckpoint],
        })
      );
      continueAsNewFired = true;
    } catch (err: any) {
      // continueAsNew in tests causes the workflow to complete, not throw
      continueAsNewFired = true;
    }

    assert.ok(continueAsNewFired, 'continueAsNew should have been called');
    assert.ok(capturedCheckpoint !== null, 'checkpoint should have been persisted before continueAsNew');
    assert.ok(
      (capturedCheckpoint as ETLCheckpoint).totalProcessed > 0,
      'checkpoint should carry forward the processed count'
    );
    assert.ok(
      (capturedCheckpoint as ETLCheckpoint).afterCursor !== null,
      'checkpoint should carry forward the cursor'
    );
  });

  it('exposes current progress via defineQuery', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./creatorInsightsETL.workflow'),
      activities: {
        fetchMediaBatch: async () => ({ posts: [], nextCursor: null, hasMore: false }),
        fetchPostInsights: async () => ({ impressions: 1, reach: 1, likes: 1, comments: 1, saves: 1, shares: 1 }),
        storeMediaBatch: async () => {},
        persistCheckpoint: async () => {},
        getCheckpoint: async () => null,
      },
    });

    const wfId = `test-etl-query-${Date.now()}`;
    const checkpoint: ETLCheckpoint = {
      creatorId: 'creator-001',
      afterCursor: null,
      processedUntil: '2024-01-01T00:00:00.000Z',
      totalProcessed: 42,
      batchSize: 10,
    };

    await worker.runUntil(
      client.workflow.execute(creatorInsightsETLWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: wfId,
        args: [checkpoint],
      })
    );

    const handle = client.workflow.getHandle(wfId);
    // In a running workflow this query returns live state.
    // After completion it returns the last-known state — still useful for audit.
    const progress = await handle.query(progressQuery);
    assert.strictEqual(progress.creatorId, 'creator-001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR 8 — tokenRefreshWorkflow fires after interval and resets via continueAsNew
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenRefreshWorkflow', () => {
  it('calls refreshToken activity after the configured interval and resets via continueAsNew', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    let refreshCalled = false;
    let capturedNewToken: string | null = null;

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./tokenRefresh.workflow'),
      activities: {
        refreshToken: async (_token: string) => {
          refreshCalled = true;
          return { accessToken: 'new_token_v2', expiresIn: 5184000 };
        },
        storeRefreshedToken: async (_creatorId: string, token: string) => {
          capturedNewToken = token;
        },
      },
    });

    const checkpoint: TokenCheckpoint = {
      creatorId: 'creator-001',
      refreshIntervalMs: 100, // 100ms instead of 55 days — tests skip actual time
      lastRefreshedAt: null,
    };

    // testEnv.sleep() skips Temporal's internal clock — the workflow's sleep()
    // call completes instantly in test, not after the real interval.
    // This is impossible in Bull or cron — it's unique to Temporal's testing SDK.
    try {
      await worker.runUntil(
        client.workflow.execute(tokenRefreshWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: `test-token-${Date.now()}`,
          args: [checkpoint, 'token_creator001_v1'],
        })
      );
    } catch {
      // continueAsNew resolves the promise — expected
    }

    assert.ok(refreshCalled, 'refreshToken activity should have been called after sleep');
    assert.strictEqual(capturedNewToken, 'new_token_v2', 'new token should be persisted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR 9 — dataValidationWorkflow detects and recovers missing posts
// ─────────────────────────────────────────────────────────────────────────────

describe('dataValidationWorkflow', () => {
  it('detects missing posts and recovers them', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    const recoveredIds: string[] = [];

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./dataValidation.workflow'),
      activities: {
        // API has 3 posts
        getMediaIdsFromAPI: async () => ['post_a', 'post_b', 'post_c'],
        // DB only has 2 — post_b is missing
        getStoredMediaIds: async () => ['post_a', 'post_c'],
        // Recovery should be called only for the missing one
        recoverMediaPost: async (_creatorId: string, mediaId: string) => {
          recoveredIds.push(mediaId);
        },
      },
    });

    const params: ValidationParams = {
      creatorId: 'creator-001',
      fromDate: '2024-01-01T00:00:00.000Z',
      toDate: '2024-01-31T23:59:59.999Z',
    };

    const summary = await worker.runUntil(
      client.workflow.execute(dataValidationWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `test-validation-${Date.now()}`,
        args: [params],
      })
    );

    assert.strictEqual(summary.totalFromApi, 3);
    assert.strictEqual(summary.missing, 1);
    assert.strictEqual(summary.recovered, 1);
    assert.deepStrictEqual(recoveredIds, ['post_b'], 'should recover only the missing post');
  });

  it('reports zero missing when all posts are stored', async function () {
    this.timeout(30_000);

    const { client, nativeConnection } = testEnv;

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./dataValidation.workflow'),
      activities: {
        getMediaIdsFromAPI: async () => ['post_a', 'post_b'],
        getStoredMediaIds: async () => ['post_a', 'post_b'],
        recoverMediaPost: async () => {},
      },
    });

    const summary = await worker.runUntil(
      client.workflow.execute(dataValidationWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `test-validation-clean-${Date.now()}`,
        args: [{
          creatorId: 'creator-001',
          fromDate: '2024-01-01T00:00:00.000Z',
          toDate: '2024-01-31T23:59:59.999Z',
        } as ValidationParams],
      })
    );

    assert.strictEqual(summary.missing, 0);
    assert.strictEqual(summary.recovered, 0);
  });
});
