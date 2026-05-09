import { proxyActivities, workflowInfo } from '@temporalio/workflow';
import type * as activities from '../activities';

// ─────────────────────────────────────────────────────────────────────────────
// THE BROKEN VERSION — read this file first to understand the problem.
//
// History math:
//   Every activity call generates ~3 events: Scheduled, Started, Completed.
//   Temporal's hard limit is ~50,000 events per workflow execution.
//   That means this loop breaks at ~16,000 activity calls — silently, in prod.
//
//   For a creator with 500 posts, each needing 2 activities (fetch + store):
//   500 × 2 × 3 = 3,000 events — looks fine in testing.
//
//   For a creator with 5,000 posts across 2 years:
//   5,000 × 2 × 3 = 30,000 events — getting close.
//
//   For a backfill of a creator with 10,000+ posts:
//   10,000 × 2 × 3 = 60,000 events — exceeds the limit. Workflow is terminated.
//
// DEMO_HISTORY_LIMIT lets you reproduce this failure in seconds without
// needing thousands of real posts. The limit is artificially low here;
// the production math above is what matters.
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_HISTORY_LIMIT = 50;

const { fetchMediaBatch, fetchPostInsights, storeMediaBatch } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '30 seconds',
  });

export async function naiveEtlWorkflow(creatorId: string): Promise<void> {
  let afterCursor: string | null = null;

  while (true) {
    // ── The missing check ──────────────────────────────────────────────────
    // In production this condition is never written — developers don't know
    // about the limit until a workflow silently dies on a large dataset.
    // This explicit throw makes the failure visible and debuggable.
    if (workflowInfo().historyLength >= DEMO_HISTORY_LIMIT) {
      throw new Error(
        `[naiveEtlWorkflow] History limit reached (${DEMO_HISTORY_LIMIT} events). ` +
        `In production this happens silently at ~50,000 events (~16,000 activity calls). ` +
        `See creatorInsightsETL.workflow.ts for the fix using continueAsNew.`
      );
    }

    const { posts, nextCursor, hasMore } = await fetchMediaBatch({
      creatorId,
      afterCursor,
      limit: 10,
    });

    if (posts.length > 0) {
      const insightsMap: Record<string, any> = {};
      for (const post of posts) {
        insightsMap[post.id] = await fetchPostInsights(post.id);
      }
      await storeMediaBatch({ creatorId, posts, insightsMap });
    }

    if (!hasMore) break;
    afterCursor = nextCursor;
  }
}
