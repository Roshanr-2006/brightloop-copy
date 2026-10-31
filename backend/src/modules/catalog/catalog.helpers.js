'use strict';

// Small helpers shared by the catalog sub-modules (validation + list queries).
// Validators collect messages into an `errors` object keyed by field name
// so the frontend can highlight the exact field (422 { error, fields }).

const { db } = require('../../db');
const { round2 } = require('../../utils/money');
const { isValidDate } = require('../../utils/dates');
const { parsePagination, paged, likePattern, sortBy } = require('../../utils/pagination');
const { conflict, notFound } = require('../../utils/httpError');

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Trimmed string. Returns null for blank optional values. */
function text(body, key, errors, { required = false, min = 0, max = 200, label = 'This field' } = {}) {
  const raw = body[key];
  if (isBlank(raw)) {
    if (required) errors[key] = `${label} is required`;
    return null;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    errors[key] = `${label} must be text`;
    return null;
  }
  const value = String(raw).trim();
  if (value.length < min) errors[key] = `${label} must be at least ${min} characters`;
  else if (value.length > max) errors[key] = `${label} must be at most ${max} characters`;
  return value;
}

/** Number with bounds. Money values are rounded to 2 decimals unless integer:true. */
function number(body, key, errors, {
  required = false, min, max, integer = false, label = 'This field', fallback = null, gt,
} = {}) {
  const raw = body[key];
  if (isBlank(raw)) {
    if (required) errors[key] = `${label} is required`;
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    errors[key] = `${label} must be a number`;
    return fallback;
  }
  if (integer && !Number.isInteger(n)) {
    errors[key] = `${label} must be a whole number`;
    return fallback;
  }
  if (gt !== undefined && !(n > gt)) errors[key] = `${label} must be greater than ${gt}`;
  else if (min !== undefined && n < min) errors[key] = `${label} must be at least ${min}`;
  else if (max !== undefined && n > max) errors[key] = `${label} must be at most ${max}`;
  return integer ? n : round2(n);
}

/** Boolean-ish (true/false/1/0/'1'/'0'/'true'/'false') -> 1/0. Undefined when absent. */
function flag(body, key, fallback) {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
}

/** Optional YYYY-MM-DD date. */
function date(body, key, errors, { required = false, label = 'Date' } = {}) {
  const raw = body[key];
  if (isBlank(raw)) {
    if (required) errors[key] = `${label} is required`;
    return null;
  }
  if (!isValidDate(String(raw))) {
    errors[key] = `${label} must be a valid date (YYYY-MM-DD)`;
    return null;
  }
  return String(raw);
}

/** One of a fixed set of values. */
function oneOf(body, key, errors, allowed, { required = true, label = 'This field', fallback = null } = {}) {
  const raw = body[key];
  if (isBlank(raw)) {
    if (required && fallback === null) errors[key] = `${label} is required`;
    return fallback;
  }
  if (!allowed.includes(raw)) {
    errors[key] = `${label} must be one of: ${allowed.join(', ')}`;
    return fallback;
  }
  return raw;
}

/** Array of positive integer ids (deduplicated). */
function idList(body, key, errors, { label = 'Selection' } = {}) {
  const raw = body[key];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[key] = `${label} must be a list`;
    return [];
  }
  const ids = raw.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) {
    errors[key] = `${label} contains an invalid id`;
    return [];
  }
  return [...new Set(ids)];
}

/** Optional positive integer id. */
function optionalId(body, key, errors, { required = false, label = 'This field' } = {}) {
  const raw = body[key];
  if (isBlank(raw)) {
    if (required) errors[key] = `${label} is required`;
    return null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    errors[key] = `${label} is invalid`;
    return null;
  }
  return n;
}

/** Returns ids from `ids` that do not exist in `table`. */
function missingIds(table, ids) {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

/** 409 if another row in `table` already uses this name (case-insensitive). */
function assertUniqueName(table, name, exceptId = null, label = 'record') {
  const row = db.prepare(`SELECT id FROM ${table} WHERE lower(name) = lower(?) AND id IS NOT ?`).get(name, exceptId);
  if (row) throw conflict(`A ${label} named "${name}" already exists`, { name: 'This name is already in use' });
}

/** Fetch a row or throw 404. */
function findOr404(table, id, label = 'Record') {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
  if (!row) throw notFound(`${label} not found`);
  return { ...row };
}

/** Count rows referencing an id, e.g. usage([['subscriptions', 'plan_id']], 3). */
function usage(refs, id) {
  const out = {};
  let total = 0;
  for (const [table, column] of refs) {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id);
    out[table] = n;
    total += n;
  }
  return { total, ...out };
}

/** Build the 409 message used when a referenced row is deleted. */
function inUseConflict(label, refs) {
  const parts = Object.entries(refs)
    .filter(([k, n]) => k !== 'total' && n > 0)
    .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`);
  return conflict(`This ${label} is used by ${parts.join(', ')} and cannot be deleted. Archive it instead so history stays intact.`);
}

/** ?active=1|0|all -> SQL condition on `column` (default: all). */
function activeCondition(query, column, where, params) {
  const a = String(query.active ?? 'all');
  if (a === '1' || a === 'true') { where.push(`${column} = 1`); }
  else if (a === '0' || a === 'false') { where.push(`${column} = 0`); }
  void params;
}

/** Add a LIKE search over several columns. */
function searchCondition(query, columns, where, params) {
  const s = String(query.search || '').trim();
  if (!s) return;
  where.push(`(${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
  for (let i = 0; i < columns.length; i += 1) params.push(likePattern(s));
}

/**
 * Run a paged list query.
 *   listQuery({ select, from, where, params, sort, sortable, defaultSort, query, map })
 */
function listQuery({ select, from, where = [], params = [], query = {}, sortable, defaultSort, map = (r) => r }) {
  const p = parsePagination(query);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${whereSql}`).get(...params);
  const order = sortBy(query.sort, sortable, defaultSort);
  const rows = db.prepare(`SELECT ${select} FROM ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, p.limit, p.offset);
  return paged(rows.map((r) => map({ ...r })), n, p);
}

module.exports = {
  isBlank, text, number, flag, date, oneOf, idList, optionalId,
  missingIds, assertUniqueName, findOr404, usage, inUseConflict,
  activeCondition, searchCondition, listQuery,
};
