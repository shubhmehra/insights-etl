/**
 * Queries the live progress of in-flight ETL workflows using defineQuery.
 * This demonstrates that you can inspect internal workflow state without
 * polling the database or using signals — unique to Temporal.
 */
import { Client, Connection } from '@temporalio/client';
import { progressQuery } from '../workflows/creatorInsightsETL.workflow';
import { tokenRefreshStatusQuery } from '../workflows/tokenRefresh.workflow';
import * as dotenv from 'dotenv';

dotenv.config();

const CREATORS = ['creator-001', 'creator-002', 'creator-003'];

async function main(): Promise<void> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  const client = new Client({ connection });

  console.log('── ETL Progress ──────────────────────────────────────\n');

  for (const creatorId of CREATORS) {
    try {
      const handle = client.workflow.getHandle(`etl-${creatorId}`);
      const progress = await handle.query(progressQuery);
      console.log(`${creatorId}:`);
      console.log(`  totalProcessed : ${progress.totalProcessed}`);
      console.log(`  afterCursor    : ${progress.afterCursor ?? '(start)'}`);
      console.log(`  processedUntil : ${progress.processedUntil}`);
    } catch {
      console.log(`${creatorId}: not running`);
    }
  }

  console.log('\n── Token Refresh Status ─────────────────────────────\n');

  for (const creatorId of CREATORS) {
    try {
      const handle = client.workflow.getHandle(`token-refresh-${creatorId}`);
      const status = await handle.query(tokenRefreshStatusQuery);
      console.log(`${creatorId}:`);
      console.log(`  lastRefreshedAt : ${status.lastRefreshedAt ?? 'never'}`);
      console.log(`  nextRefreshAt   : ${status.nextRefreshAt}`);
    } catch {
      console.log(`${creatorId}: not running`);
    }
  }

  await connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
