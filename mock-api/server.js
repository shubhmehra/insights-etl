'use strict';

const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = createApp();

app.listen(PORT, () => {
  console.log(`Mock Instagram API running on http://localhost:${PORT}`);
  console.log(`  Temporal UI: http://localhost:8080`);
});
