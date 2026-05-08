import { pool } from '../db/client';
import type { MediaPost, MediaInsights, ETLCheckpoint } from '../shared/types';

// ── storeMediaBatch ───────────────────────────────────────────────────────────
//
// UPSERT not INSERT — this is what makes Temporal's at-least-once execution
// model safe. If the activity is retried after a crash (post stored, insights
// not yet stored, worker dies), re-running it hits the ON CONFLICT path and
// is a no-op for the already-stored row. Without the upsert, a retry would
// throw a unique-constraint violation or insert duplicates.

export interface StoreBatchParams {
  creatorId: string;
  posts: MediaPost[];
  insightsMap: Record<string, MediaInsights>;
}

export async function storeMediaBatch(params: StoreBatchParams): Promise<void> {
  const { creatorId, posts, insightsMap } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const post of posts) {
      // Upsert the post row
      await client.query(
        `INSERT INTO media_posts
           (id, creator_id, instagram_media_id, media_type, caption, posted_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (instagram_media_id)
         DO UPDATE SET
           media_type = EXCLUDED.media_type,
           caption    = EXCLUDED.caption,
           fetched_at = NOW()`,
        [post.id, creatorId, post.id, post.media_type, post.caption ?? null, post.timestamp]
      );

      const insights = insightsMap[post.id];
      if (insights) {
        // One insights snapshot per (post, calendar day) — re-running on the
        // same day updates numbers; running again the next day inserts a new row.
        await client.query(
          `INSERT INTO media_insights
             (media_id, impressions, reach, likes, comments, saves, shares)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (media_id, DATE(fetched_at))
           DO UPDATE SET
             impressions = EXCLUDED.impressions,
             reach       = EXCLUDED.reach,
             likes       = EXCLUDED.likes,
             comments    = EXCLUDED.comments,
             saves       = EXCLUDED.saves,
             shares      = EXCLUDED.shares,
             fetched_at  = NOW()`,
          [
            post.id,
            insights.impressions,
            insights.reach,
            insights.likes,
            insights.comments,
            insights.saves,
            insights.shares,
          ]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── persistCheckpoint ─────────────────────────────────────────────────────────
//
// Writes the ETL cursor to the database after every successful batch.
// If the Temporal server is completely wiped (not just a worker crash —
// a full server reset), the workflow can restart and call getCheckpoint()
// to resume from here instead of reprocessing everything from scratch.

export async function persistCheckpoint(checkpoint: ETLCheckpoint): Promise<void> {
  await pool.query(
    `INSERT INTO etl_cursors
       (creator_id, after_cursor, processed_until, total_processed, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (creator_id)
     DO UPDATE SET
       after_cursor    = EXCLUDED.after_cursor,
       processed_until = EXCLUDED.processed_until,
       total_processed = EXCLUDED.total_processed,
       updated_at      = NOW()`,
    [
      checkpoint.creatorId,
      checkpoint.afterCursor,
      checkpoint.processedUntil,
      checkpoint.totalProcessed,
    ]
  );
}

// ── getCheckpoint ─────────────────────────────────────────────────────────────

export async function getCheckpoint(
  creatorId: string
): Promise<ETLCheckpoint | null> {
  const { rows } = await pool.query(
    `SELECT * FROM etl_cursors WHERE creator_id = $1`,
    [creatorId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    creatorId: row.creator_id,
    afterCursor: row.after_cursor ?? null,
    processedUntil: row.processed_until
      ? new Date(row.processed_until).toISOString()
      : new Date(0).toISOString(),
    totalProcessed: row.total_processed,
    batchSize: 10,
  };
}

// ── storeRefreshedToken ───────────────────────────────────────────────────────

export async function storeRefreshedToken(
  creatorId: string,
  accessToken: string,
  expiresInSeconds: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  await pool.query(
    `INSERT INTO token_store (creator_id, access_token, expires_at, refreshed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (creator_id)
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       expires_at   = EXCLUDED.expires_at,
       refreshed_at = NOW()`,
    [creatorId, accessToken, expiresAt]
  );
}

// ── getStoredMediaIds ─────────────────────────────────────────────────────────
// Used by the dataValidation workflow to find what we already have stored.

export async function getStoredMediaIds(
  creatorId: string,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT instagram_media_id
     FROM media_posts
     WHERE creator_id = $1
       AND posted_at >= $2
       AND posted_at <= $3`,
    [creatorId, fromDate, toDate]
  );

  return rows.map((r) => r.instagram_media_id as string);
}
