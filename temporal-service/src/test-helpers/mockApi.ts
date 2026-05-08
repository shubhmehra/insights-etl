import * as http from 'http';
import * as path from 'path';

// Import the mock API's express app from the sibling package.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require(path.resolve(__dirname, '../../../../mock-api/app'));

export interface MockApiServer {
  baseUrl: string;
  close: () => Promise<void>;
  resetRateLimitCounters: () => Promise<void>;
}

/**
 * Start the mock Instagram API on an ephemeral port.
 * Use in before()/after() hooks — one server per test suite.
 */
export async function startMockApi(): Promise<MockApiServer> {
  const app = createApp();

  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s)); // port 0 = OS picks a free port
  });

  const { port } = server.address() as { port: number };
  const baseUrl = `http://localhost:${port}`;

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    ),
    // Resets the per-creator request counters between tests so rate-limit
    // behaviour is deterministic regardless of test execution order.
    resetRateLimitCounters: async () => {
      const axios = (await import('axios')).default;
      await axios.get(`${baseUrl}/v1/debug/reset`);
    },
  };
}
