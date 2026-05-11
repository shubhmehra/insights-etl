/**
 * Starts the NAIVE (broken) ETL workflow for creator-001.
 *
 * Watch it fail in the Temporal UI at http://localhost:8080
 * — the workflow will throw once it hits DEMO_HISTORY_LIMIT events.
 *
 * This is the broken version. See start-workflows.ts for the fix.
 */
import { Client, Connection } from '@temporalio/client';
import { naiveEtlWorkflow } from '../workflows/naive';
import * as dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  const client = new Client({ connection });

  const workflowId = `naive-etl-${Date.now()}`;
  await client.workflow.start(naiveEtlWorkflow, {
    workflowId,
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'creator-insights',
    args: ['creator-001'],
  });

  console.log(`🚀 Naive ETL started: workflowId=${workflowId}`);
  console.log('Open http://localhost:8080 and watch it fail.');
  console.log(`Search for workflowId: ${workflowId}`);

  await connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
