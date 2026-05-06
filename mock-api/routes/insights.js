'use strict';

const { Router } = require('express');
const { INSIGHTS } = require('../seed/data');

const router = Router();

/**
 * GET /v1/:mediaId/insights
 *
 * Mirrors the Instagram Graph API insights edge:
 *   https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights
 *
 * Returns metrics for a single media post.
 * Real Instagram returns a `data` array where each item is one metric.
 * We mirror that shape exactly.
 */
router.get('/:mediaId/insights', (req, res) => {
  const { mediaId } = req.params;

  const metrics = INSIGHTS[mediaId];
  if (!metrics) {
    return res.status(404).json({ error: { message: 'Media not found', code: 100 } });
  }

  // Instagram's actual response shape — each metric is an object in the array
  const data = Object.entries(metrics).map(([name, value]) => ({
    id: `${mediaId}_${name}`,
    name,
    period: 'lifetime',
    values: [{ value, end_time: new Date().toISOString() }],
    title: name,
    description: `${name} for media ${mediaId}`,
  }));

  res.json({ data, id: mediaId });
});

module.exports = router;
