'use strict';

// Single shared SQLite connection (Node's built-in node:sqlite, synchronous API).
// Usage in any service:
//   const { db, transaction } = require('../../db');
//   const rows = db.prepare('SELECT * FROM products WHERE is_active = ?').all(1);
//   transaction(() => { ...several writes that must succeed or fail together... });

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

function initSchema(db) {
  const hasTables = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (hasTables) return false;
  db.exec(fs.readFileSync(path.join(config.databaseDir, 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(config.databaseDir, 'seed.sql'), 'utf8'));
  return true;
}

function openDatabase(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const created = initSchema(db);
  if (created) console.log(`[db] created schema + seed data in ${file}`);
  return db;
}

const db = openDatabase();

/**
 * Run fn inside BEGIN/COMMIT; rolls back if fn throws.
 * Nested calls reuse the outer transaction.
 */
let depth = 0;
function transaction(fn) {
  if (depth > 0) return fn();
  depth += 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth -= 1;
  }
}

module.exports = { db, transaction, openDatabase };
