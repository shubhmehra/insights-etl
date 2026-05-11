/**
 * Starts ETL + token refresh workflows for all 3 demo creators.
 * Run after: docker compose up -d && npm run db:migrate
 */
import { Client, Connection } from '@temporalio/client';
import { creatorInsightsETLWorkflow } from '../workflows/creatorInsightsETL.workflow';
import { tokenRefreshWorkflow } from '../workflows/tokenRefresh.workflow';
import type { ETLCheckpoint, TokenCheckpoint } from '../shared/types';
import * as dotenv from 'dotenv';

dotenv.config();

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'creator-insights';

// Demo refresh interval: 15s so you can watch it fire in the Temporal UI.
// In production set this to 55 * 24 * 60 * 60 * 1000 (55 days).
const REFRESH_INTERVAL_MS = process.env.DEMO_MODE === 'true'
  ? 15_000
  : 55 * 24 * 60 * 60 * 1000;

const CREATORS = [
  { id: 'creator-001', token: 'token_creator001_v1' },
  { id: 'creator-002', token: 'token_creator002_v1' },
  { id: 'creator-003', token: 'token_creator003_v1' },
];

async function main(): Promise<void> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  const client = new Client({ connection });

  for (const creator of CREATORS) {
    // ── ETL workflow ─────────────────────────────────────────────────────
    const etlCheckpoint: ETLCheckpoint = {
      creatorId: creator.id,
      afterCursor: null,
      processedUntil: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      totalProcessed: 0,
      batchSize: 10,
    };

    await client.workflow.start(creatorInsightsETLWorkflow, {
      // workflowId is per-creator — starting it twice for the same creator
      // throws WorkflowAlreadyStartedError, not a silent double-start.
      workflowId: `etl-${creator.id}`,
      taskQueue: TASK_QUEUE,
      args: [etlCheckpoint],
    });
    console.log(`✅ ETL started for ${creator.id}`);

    // ── Token refresh workflow ────────────────────────────────────────────
    const tokenCheckpoint: TokenCheckpoint = {
      creatorId: creator.id,
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      lastRefreshedAt: null,
    };

    await client.workflow.start(tokenRefreshWorkflow, {
      workflowId: `token-refresh-${creator.id}`,
      taskQueue: TASK_QUEUE,
      args: [tokenCheckpoint, creator.token],
    });
    console.log(`✅ Token refresh started for ${creator.id}`);
  }

  console.log('\nOpen http://localhost:8080 to watch the workflows run.');
  await connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
