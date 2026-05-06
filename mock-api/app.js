'use strict';

const express = require('express');
const mediaRouter = require('./routes/media');
const insightsRouter = require('./routes/insights');
const tokenRouter = require('./routes/token');

function createApp() {
  const app = express();
  app.use(express.json());

  // All routes live under /v1 — mirrors Meta's Graph API versioning
  app.use('/v1', mediaRouter);
  app.use('/v1', insightsRouter);
  app.use('/v1', tokenRouter);

  app.get('/health', (_, res) => res.json({ status: 'ok' }));

  return app;
}

module.exports = { createApp };
