import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from '../activities';
import type { ValidationParams, ValidationSummary } from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Data Validation Workflow
//
// The ETL runs every 15 minutes. Activities are at-least-once — if a worker
// crashes after fetching but before storing, the activity retries. But if the
// workflow itself is terminated mid-run (Temporal server restart, manual kill),
// some posts may have been fetched but never stored.
//
// This workflow runs nightly to find the gaps:
//   1. Fetch all post IDs from the Instagram API for a date range
//   2. Compare with what's stored in the database
//   3. Re-fetch and store anything that's missing
//
// "Silent data loss" is the problem — the ETL appeared to succeed, but
// some records are missing. Without this validation pass, you'd never know.
// ─────────────────────────────────────────────────────────────────────────────

const { getMediaIdsFromAPI, getStoredMediaIds, recoverMediaPost } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
  });

export async function dataValidationWorkflow(
  params: ValidationParams
): Promise<ValidationSummary> {
  const { creatorId, fromDate, toDate } = params;

  log.info('Starting data validation', { creatorId, fromDate, toDate });

  const [apiIds, storedIds] = await Promise.all([
    getMediaIdsFromAPI(creatorId, fromDate, toDate),
    getStoredMediaIds(creatorId, fromDate, toDate),
  ]);

  const storedSet = new Set(storedIds);
  const missingIds = apiIds.filter((id) => !storedSet.has(id));

  log.info('Validation scan complete', {
    creatorId,
    totalFromApi: apiIds.length,
    totalStored: storedIds.length,
    missing: missingIds.length,
  });

  let recovered = 0;
  let unrecovered = 0;

  for (const mediaId of missingIds) {
    try {
      await recoverMediaPost(creatorId, mediaId);
      recovered++;
      log.info('Recovered missing post', { creatorId, mediaId });
    } catch (err) {
      unrecovered++;
      log.error('Failed to recover post', {
        creatorId,
        mediaId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: ValidationSummary = {
    creatorId,
    totalFromApi: apiIds.length,
    totalStored: storedIds.length,
    missing: missingIds.length,
    recovered,
    unrecovered,
  };

  log.info('Data validation complete', summary);
  return summary;
}
