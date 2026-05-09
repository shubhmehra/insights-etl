import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import * as dotenv from 'dotenv';

dotenv.config();

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'creator-insights';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  console.log(`Worker started — task queue: ${TASK_QUEUE}`);
  console.log(`Temporal UI: http://localhost:8080`);

  await worker.run();
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
