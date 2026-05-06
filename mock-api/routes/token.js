'use strict';

const { Router } = require('express');
const { TOKENS } = require('../seed/data');

const router = Router();

/**
 * GET /v1/oauth/token/refresh
 *
 * Mirrors Instagram's long-lived token refresh endpoint:
 *   GET https://graph.instagram.com/refresh_access_token
 *     ?grant_type=ig_refresh_token
 *     &access_token={long-lived-token}
 *
 * The refreshed token is a new string (v2 suffix) so tests can assert
 * that the token actually changed after refresh.
 */
router.get('/oauth/token/refresh', (req, res) => {
  const { grant_type, access_token } = req.query;

  if (grant_type !== 'ig_refresh_token') {
    return res.status(400).json({
      error: {
        message: 'Invalid grant_type. Expected ig_refresh_token.',
        type: 'OAuthException',
        code: 100,
      },
    });
  }

  if (!access_token) {
    return res.status(400).json({
      error: { message: 'access_token is required', type: 'OAuthException', code: 100 },
    });
  }

  // Find the creator whose token matches — or issue a generic refreshed token
  const creatorEntry = Object.entries(TOKENS).find(
    ([, t]) => t.access_token === access_token || access_token.startsWith('token_')
  );

  if (!creatorEntry) {
    return res.status(401).json({
      error: {
        message: 'Error validating access token',
        type: 'OAuthException',
        code: 190,
        error_subcode: 463,
      },
    });
  }

  // Return a new token — append _refreshed so callers can verify it changed
  const refreshedToken = access_token.replace(/_v\d+$/, '') + '_v' + Date.now();

  res.json({
    access_token: refreshedToken,
    token_type: 'bearer',
    expires_in: 5184000, // 60 days in seconds
  });
});

module.exports = router;
