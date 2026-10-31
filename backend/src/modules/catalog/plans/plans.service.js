'use strict';

// Recurring plans. `available` = active and today inside start_date/end_date.

const { db } = require('../../../db');
const { today } = require('../../../utils/dates');
const { parsePagination, paged, sortBy } = require('../../../utils/pagination');
const h = require('../catalog.helpers');

const REFS = [['subscriptions', 'plan_id'], ['quotation_templates', 'plan_id']];

const AVAILABLE_SQL = `(rp.is_active = 1 AND (rp.start_date IS NULL OR rp.start_date <= :today)
  AND (rp.end_date IS NULL OR rp.end_date >= :today))`;

const SELECT = `rp.*,
  CASE WHEN ${AVAILABLE_SQL.replace(/:today/g, '?')} THEN 1 ELSE 0 END AS available,
  (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = rp.id) AS subscription_count,
  (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = rp.id AND s.status IN ('active', 'paused')) AS active_subscription_count`;

const shape = (r) => ({ ...r, available: !!r.available });

function list(query) {
  const now = today();
  const where = [];
  const whereParams = [];
  h.activeCondition(query, 'rp.is_active', where, whereParams);
  h.searchCondition(query, ['rp.name'], where, whereParams);
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(query.period)) {
    where.push('rp.billing_period = ?');
    whereParams.push(query.period);
  }
  if (query.available === '1' || query.available === 'true') {
    where.push(AVAILABLE_SQL.replace(/:today/g, '?'));
    whereParams.push(now, now);
  }
  // The SELECT list has its own two `today` placeholders (the `available` flag).
  const selectParams = [now, now];
  const p = parsePagination(query);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM recurring_plans rp ${whereSql}`).get(...whereParams);
  const order = sortBy(query.sort, {
    name: 'rp.name', price: 'rp.price', period: 'rp.billing_period', created: 'rp.created_at',
    subscriptions: 'subscription_count',
  }, 'rp.name');
  const rows = db.prepare(`SELECT ${SELECT} FROM recurring_plans rp ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...selectParams, ...whereParams, p.limit, p.offset);
  return paged(rows.map(shape), n, p);
}

/** Active, currently available plans for pickers (subscriptions / templates). */
function options() {
  const now = today();
  return db.prepare(`SELECT ${SELECT} FROM recurring_plans rp WHERE rp.is_active = 1 ORDER BY rp.name`)
    .all(now, now).map(shape);
}

function get(id) {
  const now = today();
  const row = db.prepare(`SELECT ${SELECT} FROM recurring_plans rp WHERE rp.id = ?`).get(now, now, Number(id));
  if (!row) h.findOr404('recurring_plans', id, 'Plan');
  const plan = shape(row);
  plan.usage = h.usage(REFS, plan.id);
  return plan;
}

const COLS = ['name', 'price', 'billing_period', 'billing_interval', 'min_quantity', 'start_date', 'end_date',
  'auto_close', 'closable', 'pausable', 'renewable', 'is_active'];

function create(v) {
  h.assertUniqueName('recurring_plans', v.name, null, 'plan');
  const values = COLS.map((c) => (c === 'is_active' ? v.is_active ?? 1 : v[c]));
  const info = db.prepare(`INSERT INTO recurring_plans (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`)
    .run(...values);
  return get(Number(info.lastInsertRowid));
}

function update(id, v) {
  const plan = h.findOr404('recurring_plans', id, 'Plan');
  h.assertUniqueName('recurring_plans', v.name, plan.id, 'plan');
  const values = COLS.map((c) => (c === 'is_active' ? v.is_active ?? plan.is_active : v[c]));
  db.prepare(`UPDATE recurring_plans SET ${COLS.map((c) => `${c} = ?`).join(', ')},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(...values, plan.id);
  return get(plan.id);
}

function setActive(id, active) {
  const plan = h.findOr404('recurring_plans', id, 'Plan');
  db.prepare(`UPDATE recurring_plans SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(active ? 1 : 0, plan.id);
  return get(plan.id);
}

function remove(id) {
  const plan = h.findOr404('recurring_plans', id, 'Plan');
  const used = h.usage(REFS, plan.id);
  if (used.total > 0) throw h.inUseConflict('plan', used);
  db.prepare('DELETE FROM recurring_plans WHERE id = ?').run(plan.id);
}

module.exports = { list, options, get, create, update, setActive, remove };
