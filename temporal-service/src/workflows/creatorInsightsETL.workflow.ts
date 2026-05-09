import {
  proxyActivities,
  continueAsNew,
  workflowInfo,
  defineQuery,
  setHandler,
  log,
} from '@temporalio/workflow';
import type * as activities from '../activities';
import type { ETLCheckpoint } from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// THE FIX — compare with naive.ts to see exactly what changed.
//
// Two additions solve the history limit problem:
//   1. HISTORY_THRESHOLD check before each iteration → triggers continueAsNew
//   2. continueAsNew(checkpoint) → fresh execution, carries cursor forward
//
// Why HISTORY_THRESHOLD = 1_000 and not 50_000?
//   You want headroom. The continueAsNew call itself adds events. Signals or
//   queries arriving concurrently add events. Operating at 95% capacity means
//   a burst could push you over. 1,000 events per execution is conservative —
//   you pay with more executions, but you never risk termination.
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_THRESHOLD = 1_000;

const { fetchMediaBatch, fetchPostInsights, storeMediaBatch, persistCheckpoint } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '2 minutes',
    retry: {
      maximumAttempts: 3,
      initialInterval: '5 seconds',
      backoffCoefficient: 2,
    },
  });

// ── Live progress query ───────────────────────────────────────────────────────
// defineQuery lets you inspect this workflow's state from outside while it
// runs — without polling a database or using signals.
// This is impossible in Bull or BullMQ. It's unique to Temporal.
export const progressQuery = defineQuery<ETLCheckpoint>('getProgress');

export async function creatorInsightsETLWorkflow(
  checkpoint: ETLCheckpoint
): Promise<void> {
  // The query handler always returns the current checkpoint — live or final.
  setHandler(progressQuery, () => checkpoint);

  while (true) {
    // ── Check BEFORE doing work, not after ───────────────────────────────
    // If you check after, you've already added events from this iteration.
    // A check before the loop body ensures you always have enough headroom
    // for the activities about to run.
    if (workflowInfo().historyLength >= HISTORY_THRESHOLD) {
      log.info('History threshold reached — continuing as new', {
        creatorId: checkpoint.creatorId,
        totalProcessed: checkpoint.totalProcessed,
        historyLength: workflowInfo().historyLength,
      });

      // ── Behavior 7: persist checkpoint to DB before continueAsNew ───────
      // If the Temporal server is wiped entirely (not just a worker crash),
      // the new workflow execution can call getCheckpoint() and resume from
      // here instead of starting from scratch.
      await persistCheckpoint(checkpoint);

      // continueAsNew starts a fresh execution with a clean history slate.
      // The checkpoint arg carries the cursor forward — no data loss.
      await continueAsNew<typeof creatorInsightsETLWorkflow>(checkpoint);
      return; // TypeScript requires this — continueAsNew never actually returns
    }

    const { posts, nextCursor, hasMore } = await fetchMediaBatch({
      creatorId: checkpoint.creatorId,
      afterCursor: checkpoint.afterCursor,
      limit: checkpoint.batchSize,
    });

    if (posts.length > 0) {
      const insightsMap: Record<string, any> = {};
      for (const post of posts) {
        insightsMap[post.id] = await fetchPostInsights(post.id);
      }
      await storeMediaBatch({
        creatorId: checkpoint.creatorId,
        posts,
        insightsMap,
      });
    }

    if (!hasMore) {
      log.info('ETL complete', {
        creatorId: checkpoint.creatorId,
        totalProcessed: checkpoint.totalProcessed + posts.length,
      });
      return;
    }

    // Advance checkpoint — AFTER successful storeMediaBatch.
    // If storeMediaBatch fails and Temporal retries it, the same batch is
    // reprocessed — which is safe because storeMediaBatch uses upserts.
    checkpoint = {
      ...checkpoint,
      afterCursor: nextCursor,
      // Timestamp fallback: advance processedUntil to the last post's timestamp.
      // If the afterCursor ever expires on Instagram's side, we resume from here.
      processedUntil: posts[posts.length - 1]?.timestamp ?? checkpoint.processedUntil,
      totalProcessed: checkpoint.totalProcessed + posts.length,
    };
  }
}
