import { strict as assert } from 'assert';
import { describe, it, before, after, beforeEach } from 'mocha';
import { startMockApi, MockApiServer } from '../test-helpers/mockApi';

// Import will fail until the file exists — that's the RED state.
import { fetchMediaBatch, TokenExpiredError } from './instagram.activity';

describe('fetchMediaBatch', () => {
  let server: MockApiServer;

  before(async () => {
    server = await startMockApi();
    process.env.INSTAGRAM_API_BASE_URL = server.baseUrl;
  });

  after(async () => {
    await server.close();
  });

  beforeEach(async () => {
    // Reset rate-limit counters so every test starts from a clean slate.
    // Without this, test order would affect whether the 429 fires.
    await server.resetRateLimitCounters();
  });

  // ── TRACER BULLET ────────────────────────────────────────────────────────
  // Proves the full path: activity → mock API → parsed response works.
  it('returns posts and a cursor when the API responds successfully', async () => {
    // Request 1 is always successful (rate limit fires on request 3)
    const result = await fetchMediaBatch({
      creatorId: 'creator-001',
      afterCursor: null,
      limit: 10,
    });

    assert.ok(Array.isArray(result.posts), 'posts should be an array');
    assert.strictEqual(result.posts.length, 10, 'should return exactly the requested limit');
    assert.ok(result.nextCursor !== null, 'should return a cursor for the next page');
    assert.strictEqual(result.hasMore, true, '200 posts exist so there is always a next page');

    // Shape check — mirrors Instagram's media fields
    const first = result.posts[0];
    assert.ok(first.id, 'post should have id');
    assert.ok(first.timestamp, 'post should have timestamp');
    assert.ok(first.media_type, 'post should have media_type');
  });

  // ── BEHAVIOR 2 ────────────────────────────────────────────────────────────
  it('throws an error with status 429 when rate limited', async () => {
    // Requests 1 and 2 succeed; request 3 is rate-limited.
    await fetchMediaBatch({ creatorId: 'creator-001', afterCursor: null, limit: 10 }); // req 1
    await fetchMediaBatch({ creatorId: 'creator-001', afterCursor: null, limit: 10 }); // req 2

    // Request 3 → 429
    await assert.rejects(
      () => fetchMediaBatch({ creatorId: 'creator-001', afterCursor: null, limit: 10 }),
      (err: any) => {
        assert.strictEqual(err.response?.status, 429, 'error should carry HTTP 429 status');
        return true;
      }
    );
  });

  // ── BEHAVIOR 3 ────────────────────────────────────────────────────────────
  it('throws TokenExpiredError when the API returns 401', async () => {
    await assert.rejects(
      () =>
        fetchMediaBatch({
          creatorId: 'creator-001',
          afterCursor: null,
          limit: 10,
          simulateError: 'token_expired',
        }),
      (err: unknown) => {
        assert.ok(err instanceof TokenExpiredError, 'should be a TokenExpiredError');
        return true;
      }
    );
  });
});
