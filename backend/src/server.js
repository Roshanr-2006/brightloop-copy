'use strict';

const config = require('./config');
const app = require('./app');
const { db } = require('./db');

const server = app.listen(config.port, () => {
  console.log(`Brightloop API running at http://localhost:${config.port}`);
  console.log(`Health check:            http://localhost:${config.port}/api/health`);
  console.log(`SQLite database:         ${config.dbFile}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
