import { strict as assert } from 'assert';
import { describe, it, before, after, beforeEach } from 'mocha';
import { pool } from '../db/client';
import { storeMediaBatch, persistCheckpoint, getCheckpoint } from './db.activity';
import type { MediaPost, MediaInsights, ETLCheckpoint } from '../shared/types';

// ── test fixtures ─────────────────────────────────────────────────────────────

const TEST_CREATOR_ID = 'test-creator-idempotency';

const POST: MediaPost = {
  id: 'test_post_001',
  timestamp: '2024-01-15T10:00:00Z',
  media_type: 'IMAGE',
  caption: 'Test post',
};

const INSIGHTS: MediaInsights = {
  impressions: 1000,
  reach: 800,
  likes: 50,
  comments: 5,
  saves: 10,
  shares: 3,
};

// ── setup / teardown ──────────────────────────────────────────────────────────

before(async () => {
  // Create test creator row so FK constraints are satisfied
  await pool.query(`
    INSERT INTO creators (id, instagram_user_id, display_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO NOTHING
  `, [TEST_CREATOR_ID, `ig_${TEST_CREATOR_ID}`, 'Test Creator']);
});

beforeEach(async () => {
  // Clean slate before each test — delete child rows first (FK order)
  await pool.query(`DELETE FROM media_insights WHERE media_id = $1`, [POST.id]);
  await pool.query(`DELETE FROM media_posts WHERE id = $1`, [POST.id]);
  await pool.query(`DELETE FROM etl_cursors WHERE creator_id = $1`, [TEST_CREATOR_ID]);
});

after(async () => {
  await pool.query(`DELETE FROM creators WHERE id = $1`, [TEST_CREATOR_ID]);
  await pool.end();
});

// ── BEHAVIOR 4: idempotency ───────────────────────────────────────────────────

describe('storeMediaBatch', () => {
  it('stores posts and insights on first call', async () => {
    await storeMediaBatch({
      creatorId: TEST_CREATOR_ID,
      posts: [POST],
      insightsMap: { [POST.id]: INSIGHTS },
    });

    const { rows } = await pool.query(
      `SELECT * FROM media_posts WHERE id = $1`, [POST.id]
    );
    assert.strictEqual(rows.length, 1, 'should have stored exactly one post');
    assert.strictEqual(rows[0].media_type, POST.media_type);
  });

  it('is idempotent — calling twice with the same data stores exactly one row', async () => {
    await storeMediaBatch({
      creatorId: TEST_CREATOR_ID,
      posts: [POST],
      insightsMap: { [POST.id]: INSIGHTS },
    });

    // Second call with identical data — simulates a Temporal activity retry
    await storeMediaBatch({
      creatorId: TEST_CREATOR_ID,
      posts: [POST],
      insightsMap: { [POST.id]: INSIGHTS },
    });

    const posts = await pool.query(`SELECT * FROM media_posts WHERE id = $1`, [POST.id]);
    assert.strictEqual(posts.rows.length, 1, 'duplicate store must not create two rows');

    const insights = await pool.query(
      `SELECT * FROM media_insights WHERE media_id = $1`, [POST.id]
    );
    assert.strictEqual(insights.rows.length, 1, 'duplicate insights store must not create two rows');
  });

  it('updates existing insights when called again (metrics can change over time)', async () => {
    await storeMediaBatch({
      creatorId: TEST_CREATOR_ID,
      posts: [POST],
      insightsMap: { [POST.id]: INSIGHTS },
    });

    const updatedInsights = { ...INSIGHTS, impressions: 9999 };
    await storeMediaBatch({
      creatorId: TEST_CREATOR_ID,
      posts: [POST],
      insightsMap: { [POST.id]: updatedInsights },
    });

    const { rows } = await pool.query(
      `SELECT impressions FROM media_insights WHERE media_id = $1`, [POST.id]
    );
    assert.strictEqual(rows[0].impressions, 9999, 'updated metrics should overwrite old ones');
  });
});

// ── checkpoint persistence ────────────────────────────────────────────────────

describe('persistCheckpoint / getCheckpoint', () => {
  it('round-trips a checkpoint through the database', async () => {
    const checkpoint: ETLCheckpoint = {
      creatorId: TEST_CREATOR_ID,
      afterCursor: 'cursor_abc123',
      processedUntil: '2024-01-15T10:00:00.000Z',
      totalProcessed: 42,
      batchSize: 10,
    };

    await persistCheckpoint(checkpoint);

    const loaded = await getCheckpoint(TEST_CREATOR_ID);
    assert.ok(loaded !== null, 'should find persisted checkpoint');
    assert.strictEqual(loaded!.afterCursor, checkpoint.afterCursor);
    assert.strictEqual(loaded!.totalProcessed, checkpoint.totalProcessed);
  });

  it('returns null when no checkpoint exists', async () => {
    const loaded = await getCheckpoint('non-existent-creator');
    assert.strictEqual(loaded, null);
  });
});
