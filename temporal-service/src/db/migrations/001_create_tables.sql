-- ── creators ────────────────────────────────────────────────────────────────
-- One row per connected Instagram creator (the tenant).
CREATE TABLE IF NOT EXISTS creators (
  id                  VARCHAR(255) PRIMARY KEY,
  instagram_user_id   VARCHAR(255) UNIQUE NOT NULL,
  display_name        VARCHAR(255),
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  connected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── token_store ───────────────────────────────────────────────────────────────
-- Separate from creators so token rotation doesn't require updating the
-- creators row (avoids lock contention on a hot row).
CREATE TABLE IF NOT EXISTS token_store (
  creator_id    VARCHAR(255) PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  access_token  TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── media_posts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_posts (
  id                  VARCHAR(255) PRIMARY KEY,  -- our internal id (same as instagram_media_id for simplicity)
  creator_id          VARCHAR(255) NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  instagram_media_id  VARCHAR(255) UNIQUE NOT NULL,
  media_type          VARCHAR(50),
  caption             TEXT,
  posted_at           TIMESTAMPTZ,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_posts_creator_posted
  ON media_posts (creator_id, posted_at DESC);

-- ── media_insights ────────────────────────────────────────────────────────────
-- Separate from media_posts because metrics update over time.
-- Re-fetching a post's insights should update these numbers, not the post row.
CREATE TABLE IF NOT EXISTS media_insights (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id     VARCHAR(255) NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  impressions  INTEGER,
  reach        INTEGER,
  likes        INTEGER,
  comments     INTEGER,
  saves        INTEGER,
  shares       INTEGER,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One insights snapshot per (post, day) — re-running the ETL on the same
  -- day updates the row instead of inserting a duplicate.
  UNIQUE (media_id, DATE(fetched_at))
);

-- ── etl_cursors ───────────────────────────────────────────────────────────────
-- Persists the ETL checkpoint to the database after every successful batch.
-- Purpose: if the Temporal server itself is wiped (full reset, not just worker
-- crash), the workflow can restart and resume from the last known position
-- rather than reprocessing everything from scratch.
CREATE TABLE IF NOT EXISTS etl_cursors (
  creator_id        VARCHAR(255) PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  after_cursor      TEXT,              -- last Instagram pagination cursor
  processed_until   TIMESTAMPTZ,       -- timestamp fallback if cursor expires
  total_processed   INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
