'use strict';

const { Router } = require('express');
const { CREATORS } = require('../seed/data');

const router = Router();

// Per-creator request counter for deterministic rate limiting.
// Exposed via /debug/reset so tests can reset between runs.
const requestCounts = {};

router.get('/debug/reset', (req, res) => {
  Object.keys(requestCounts).forEach((k) => delete requestCounts[k]);
  res.json({ ok: true });
});

/**
 * GET /v1/:creatorId/media
 *
 * Mirrors the Instagram Graph API media edge:
 *   https://developers.facebook.com/docs/instagram-api/reference/ig-user/media
 *
 * Query params:
 *   limit  (number, default 10)  — page size
 *   after  (string, optional)    — cursor from previous response
 *   simulate_error               — 'token_expired' | 'rate_limit'
 *
 * Deterministic failures:
 *   - Every 3rd request per creator → 429 (unless simulate_error overrides)
 *   - simulate_error=token_expired   → 401
 *   - simulate_error=rate_limit      → 429 immediately
 */
router.get('/:creatorId/media', (req, res) => {
  const { creatorId } = req.params;
  const { limit = '10', after, simulate_error } = req.query;

  // ── Simulated token expiry ───────────────────────────────────────────────
  if (simulate_error === 'token_expired') {
    return res.status(401).json({
      error: {
        message: 'Error validating access token: Session has expired',
        type: 'OAuthException',
        code: 190,
        error_subcode: 463,
        fbtrace_id: 'demo-trace-id',
      },
    });
  }

  // ── Deterministic rate limiting: every 3rd request ───────────────────────
  requestCounts[creatorId] = (requestCounts[creatorId] || 0) + 1;

  if (simulate_error === 'rate_limit' || requestCounts[creatorId] % 3 === 0) {
    return res.status(429).json({
      error: {
        message: 'Application request limit reached',
        type: 'OAuthException',
        code: 4,
        error_subcode: 2207051,
        fbtrace_id: 'demo-trace-id',
      },
    });
  }

  // ── Creator not found ────────────────────────────────────────────────────
  const creator = CREATORS[creatorId];
  if (!creator) {
    return res.status(404).json({ error: { message: 'Creator not found', code: 100 } });
  }

  // ── Cursor-based pagination ──────────────────────────────────────────────
  // Instagram cursors are opaque strings. In this demo we use the post ID as
  // the cursor for simplicity. Production cursors are base64-encoded metadata.
  const posts = creator.posts;
  const pageSize = Math.min(parseInt(limit, 10), 100);

  let startIdx = 0;
  if (after) {
    const found = posts.findIndex((p) => p.id === after);
    // If cursor has expired or is unknown, fall back to beginning.
    // In production you'd return a 400 — we fall back to demonstrate the
    // timestamp-fallback path in ETLCheckpoint.
    startIdx = found >= 0 ? found + 1 : 0;
  }

  const page = posts.slice(startIdx, startIdx + pageSize);
  const hasMore = startIdx + pageSize < posts.length;
  const lastPost = page[page.length - 1];

  const paging = {
    cursors: {
      before: page[0]?.id ?? null,
      after: lastPost?.id ?? null,
    },
  };

  if (hasMore && lastPost) {
    // next is informational — callers should use paging.cursors.after
    paging.next = `http://localhost:${process.env.PORT || 3001}/v1/${creatorId}/media?after=${lastPost.id}&limit=${pageSize}`;
  }

  res.json({ data: page, paging });
});

module.exports = router;
