'use strict';

const path = require('node:path');

// Load backend/.env if present (built into Node 22, no dotenv needed).
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env file: fall back to the defaults below.
}

const backendRoot = path.join(__dirname, '..');

const config = {
  port: Number(process.env.PORT) || 4000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dbFile: process.env.DB_FILE === ':memory:'
    ? ':memory:'
    : path.resolve(backendRoot, process.env.DB_FILE || './data/brightloop.db'),
  databaseDir: path.resolve(backendRoot, '..', 'database'),
  isProduction: process.env.NODE_ENV === 'production',
  admin: {
    name: process.env.ADMIN_NAME || 'Brightloop Admin',
    email: process.env.ADMIN_EMAIL || 'admin@brightloop.test',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  },
};

module.exports = config;
