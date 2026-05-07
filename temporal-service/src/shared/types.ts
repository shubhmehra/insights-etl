// ── Media / Insights ─────────────────────────────────────────────────────────

export interface MediaPost {
  id: string;
  timestamp: string;       // ISO string — Instagram field name
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  caption?: string;
}

export interface MediaInsights {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}

// ── ETL Checkpoint ────────────────────────────────────────────────────────────
//
// This is the state carried through continueAsNew calls.
// Design rules:
//   1. Must be JSON-serializable — Temporal serializes it on every continueAsNew.
//      Use ISO strings, NOT Date objects (Date → string on serialize, stays string
//      on deserialize — you'd get silent type mismatches).
//   2. Keep it small — this state is written to Temporal's history on every call.
//   3. No actual records — only cursors and counters. Records live in the DB.

export interface ETLCheckpoint {
  creatorId: string;

  // Instagram pagination cursor (opaque string from paging.cursors.after).
  // null means start from the beginning.
  afterCursor: string | null;

  // Timestamp fallback: if afterCursor expires on Instagram's side,
  // we resume from this date instead. Always advance this alongside afterCursor.
  processedUntil: string; // ISO string

  totalProcessed: number;
  batchSize: number;      // how many posts to fetch per activity call
}

// ── Token Refresh Checkpoint ─────────────────────────────────────────────────

export interface TokenCheckpoint {
  creatorId: string;

  // When to fire the refresh. Passed as an arg so the workflow doesn't need
  // to access process.env (Temporal workflow sandbox has no Node.js globals).
  refreshIntervalMs: number;

  // ISO string — recorded after each successful refresh for observability
  lastRefreshedAt: string | null;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationParams {
  creatorId: string;
  fromDate: string;  // ISO string — validate posts after this date
  toDate: string;    // ISO string
}

export interface ValidationSummary {
  creatorId: string;
  totalFromApi: number;
  totalStored: number;
  missing: number;
  recovered: number;
  unrecovered: number;
}
