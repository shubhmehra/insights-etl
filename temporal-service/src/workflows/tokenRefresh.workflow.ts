import {
  proxyActivities,
  sleep,
  continueAsNew,
  defineQuery,
  setHandler,
  log,
} from '@temporalio/workflow';
import type * as activities from '../activities';
import type { TokenCheckpoint } from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Token Refresh Workflow
//
// Instagram long-lived tokens expire every 60 days. This workflow runs
// indefinitely for each connected creator — sleeping, refreshing, sleeping.
//
// continueAsNew here is different from the ETL workflow:
//   - In ETL:          continueAsNew prevents history explosion from a tight loop
//   - Here:            continueAsNew allows the workflow to run FOREVER without
//                      accumulating history across years of refreshes
//
// Without continueAsNew, a workflow that refreshes every 55 days would
// accumulate ~6 events per refresh × 365/55 ≈ 40 events/year. Over 5 years
// that's only ~200 events — not a problem. But best practice is to use
// continueAsNew for any workflow designed to run indefinitely.
//
// The sleep() call demonstrates a key Temporal capability:
//   - In production:   sleep('55 days') — worker process can restart, deploy,
//                      crash, recover — the sleep continues from where it left off
//   - In tests:        testEnv's clock can be skipped instantly — no waiting
//   This is impossible with setTimeout, cron, or Bull delayed jobs.
// ─────────────────────────────────────────────────────────────────────────────

const { refreshToken, storeRefreshedToken } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 3 },
  });

export const tokenRefreshStatusQuery = defineQuery<{
  creatorId: string;
  lastRefreshedAt: string | null;
  nextRefreshAt: string;
}>('getTokenRefreshStatus');

export async function tokenRefreshWorkflow(
  checkpoint: TokenCheckpoint,
  currentAccessToken: string
): Promise<void> {
  const nextRefreshAt = new Date(
    Date.now() + checkpoint.refreshIntervalMs
  ).toISOString();

  setHandler(tokenRefreshStatusQuery, () => ({
    creatorId: checkpoint.creatorId,
    lastRefreshedAt: checkpoint.lastRefreshedAt,
    nextRefreshAt,
  }));

  log.info('Token refresh workflow started', {
    creatorId: checkpoint.creatorId,
    refreshIntervalMs: checkpoint.refreshIntervalMs,
    nextRefreshAt,
  });

  // Sleep until it's time to refresh.
  // Production: checkpoint.refreshIntervalMs = 55 * 24 * 60 * 60 * 1000
  // Demo:       checkpoint.refreshIntervalMs = 15_000 (15 seconds)
  // Tests:      checkpoint.refreshIntervalMs = 100 (100ms)
  await sleep(checkpoint.refreshIntervalMs);

  log.info('Refreshing token', { creatorId: checkpoint.creatorId });

  const { accessToken: newToken, expiresIn } = await refreshToken(currentAccessToken);
  await storeRefreshedToken(checkpoint.creatorId, newToken, expiresIn);

  log.info('Token refreshed successfully', {
    creatorId: checkpoint.creatorId,
    expiresIn,
  });

  // continueAsNew resets the workflow history and restarts the sleep cycle.
  // The new execution carries the updated token and records the refresh time.
  await continueAsNew<typeof tokenRefreshWorkflow>(
    {
      ...checkpoint,
      lastRefreshedAt: new Date().toISOString(),
    },
    newToken
  );
}
