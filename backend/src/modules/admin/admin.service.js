'use strict';

// Admin tools. All SQL and rules live here (no req/res).

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../../config');
const { db, transaction } = require('../../db');
const { HttpError, badRequest, conflict } = require('../../utils/httpError');
const { isEmail, normalizeEmail, cleanName, nameError } = require('../auth/auth.validators');

const DEMO_DOMAIN = 'demo.brightloop.test';
const MAX_IMPORT_ROWS = 5000;

const TABLES = [
  ['users', 'Users'],
  ['customers', 'Customers'],
  ['products', 'Products'],
  ['recurring_plans', 'Plans'],
  ['subscriptions', 'Subscriptions'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
];

function count(table, where = '', ...args) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...args).n;
  } catch {
    return null; // table not present in this build
  }
}

function overview() {
  const counts = TABLES.map(([table, label]) => ({ table, label, count: count(table) }));
  const roles = db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all();
  let dbSize = 0;
  if (config.dbFile !== ':memory:') {
    for (const suffix of ['', '-wal']) {
      try { dbSize += fs.statSync(config.dbFile + suffix).size; } catch { /* file missing */ }
    }
  }
  const demoCustomers = count('customers', 'WHERE email LIKE ?', `%@${DEMO_DOMAIN}`);
  return {
    counts,
    roles: Object.fromEntries(roles.map((r) => [r.role, r.n])),
    database: { file: config.dbFile === ':memory:' ? ':memory:' : path.basename(config.dbFile), sizeBytes: dbSize },
    demo: { loaded: demoCustomers > 0, customers: demoCustomers },
    server: { node: process.version, uptimeSeconds: Math.round(process.uptime()), env: config.isProduction ? 'production' : 'development' },
  };
}

/* ------------------------------------------------------------------ demo data (runs scripts/seed-demo.js) */
const job = { status: 'idle', force: false, startedAt: null, finishedAt: null, log: [], exitCode: null };

function demoStatus() {
  return { ...job, log: job.log.slice(-40) };
}

function startDemoLoad({ force = false } = {}) {
  if (job.status === 'running') throw conflict('Demo data is already loading');
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'seed-demo.js');
  Object.assign(job, { status: 'running', force, startedAt: new Date().toISOString(), finishedAt: null, log: [], exitCode: null });
  const child = spawn(process.execPath, force ? [script, '--force'] : [script], {
    cwd: path.join(__dirname, '..', '..', '..'),
    env: process.env,
  });
  const push = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) job.log.push(line.slice(0, 300));
    if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (err) => {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    push(`Could not start the loader: ${err.message}`);
  });
  child.on('close', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
  });
  return demoStatus();
}

/* ------------------------------------------------------------------ CSV import: customers */

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const CUSTOMER_COLUMNS = ['name', 'email', 'company_name', 'phone', 'billing_address', 'city', 'state', 'country', 'tax_id'];

function importCustomers(csv, { dryRun = false } = {}) {
  if (typeof csv !== 'string' || !csv.trim()) throw badRequest('Choose a CSV file first', { csv: 'CSV is empty' });
  const rows = parseCsv(csv);
  const header = rows.shift().map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = ['name', 'email'].filter((c) => !header.includes(c));
  if (missing.length) throw new HttpError(422, `Missing required column: ${missing.join(', ')}`, { csv: `Header must include ${missing.join(', ')}` });
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(413, `Too many rows (max ${MAX_IMPORT_ROWS} per import)`);

  const idx = Object.fromEntries(CUSTOMER_COLUMNS.map((c) => [c, header.indexOf(c)]));
  const exists = db.prepare('SELECT 1 FROM customers WHERE email = ? COLLATE NOCASE');
  const insert = db.prepare(`INSERT INTO customers (name, email, company_name, phone, billing_address, city, state, country, tax_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'India'), ?)`);
  const seen = new Set();
  const valid = [];
  const errors = [];
  let skipped = 0;

  rows.forEach((cells, i) => {
    const line = i + 2; // header is line 1
    const get = (c) => (idx[c] >= 0 ? String(cells[idx[c]] ?? '').trim() : '');
    const name = cleanName(get('name'));
    const email = normalizeEmail(get('email'));
    const problem = nameError(name) || (!isEmail(email) ? 'Invalid email address' : null);
    if (problem) { errors.push({ line, email: email || null, message: problem }); return; }
    if (seen.has(email) || exists.get(email)) { skipped += 1; return; }
    seen.add(email);
    valid.push([name, email, ...CUSTOMER_COLUMNS.slice(2).map((c) => get(c) || null)]);
  });

  if (!dryRun && valid.length) transaction(() => { for (const v of valid) insert.run(...v); });
  return { dryRun, total: rows.length, inserted: dryRun ? 0 : valid.length, wouldInsert: valid.length, skipped, errors: errors.slice(0, 50), errorCount: errors.length };
}

module.exports = { overview, demoStatus, startDemoLoad, importCustomers, parseCsv };
