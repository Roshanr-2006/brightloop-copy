'use strict';

// Deletes the local SQLite database, recreates schema + seed data,
// and creates the first admin account from .env (ADMIN_EMAIL / ADMIN_PASSWORD).
// Usage: npm run db:reset

const fs = require('node:fs');
const config = require('../src/config');

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(config.dbFile + suffix, { force: true });
}

const bcrypt = require('bcryptjs');
const { db } = require('../src/db'); // opening the DB runs schema.sql + seed.sql

const hash = bcrypt.hashSync(config.admin.password, 10);
db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
  .run(config.admin.name, config.admin.email, hash);

console.log('Database reset complete.');
console.log(`Admin login: ${config.admin.email} / ${config.admin.password}`);
db.close();
