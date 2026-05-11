/**
 * Starts the data validation workflow for all creators.
 * Validates the past 30 days of data.
 * Run after npm run corrupt:data to see recovery in action.
 */
import { Client, Connection } from '@temporalio/client';
import { dataValidationWorkflow } from '../workflows/dataValidation.workflow';
import type { ValidationParams } from '../shared/types';
import * as dotenv from 'dotenv';

dotenv.config();

const CREATORS = ['creator-001', 'creator-002', 'creator-003'];

async function main(): Promise<void> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  const client = new Client({ connection });

  const toDate = new Date().toISOString();
  const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const creatorId of CREATORS) {
    const params: ValidationParams = { creatorId, fromDate, toDate };

    await client.workflow.start(dataValidationWorkflow, {
      workflowId: `validation-${creatorId}-${Date.now()}`,
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'creator-insights',
      args: [params],
    });
    console.log(`✅ Validation started for ${creatorId}`);
  }

  console.log('\nOpen http://localhost:8080 to watch the validation workflows.');
  await connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
