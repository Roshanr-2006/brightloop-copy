'use strict';

// Discounts (admin only). Status is computed:
//   inactive  -> is_active = 0
//   exhausted -> usage_count reached usage_limit
//   expired   -> end_date before today
//   scheduled -> start_date after today
//   active    -> otherwise (what getApplicableDiscounts can pick up)

const { db, transaction } = require('../../../db');
const { today } = require('../../../utils/dates');
const { unprocessable } = require('../../../utils/httpError');
const h = require('../catalog.helpers');

const STATUSES = ['active', 'scheduled', 'expired', 'exhausted', 'inactive'];

const STATUS_SQL = `CASE
    WHEN d.is_active = 0 THEN 'inactive'
    WHEN d.usage_limit IS NOT NULL AND d.usage_count >= d.usage_limit THEN 'exhausted'
    WHEN d.end_date IS NOT NULL AND d.end_date < ? THEN 'expired'
    WHEN d.start_date IS NOT NULL AND d.start_date > ? THEN 'scheduled'
    ELSE 'active' END`;

const FROM = `(SELECT d.*, ${STATUS_SQL} AS status FROM discounts d) d`;

function list(query) {
  const now = today();
  const where = [];
  const params = [now, now];
  h.activeCondition(query, 'd.is_active', where, params);
  h.searchCondition(query, ['d.name'], where, params);
  if (STATUSES.includes(query.status)) {
    where.push('d.status = ?');
    params.push(query.status);
  }
  if (query.scope === 'product' || query.scope === 'subscription') {
    where.push('d.scope = ?');
    params.push(query.scope);
  }
  return h.listQuery({
    select: `d.*,
      (SELECT group_concat(p.name, ', ') FROM discount_products dp JOIN products p ON p.id = dp.product_id
        WHERE dp.discount_id = d.id) AS product_names,
      (SELECT COUNT(*) FROM discount_products dp WHERE dp.discount_id = d.id) AS product_count,
      (SELECT COUNT(*) FROM discount_subscriptions ds WHERE ds.discount_id = d.id) AS subscription_count`,
    from: FROM,
    where,
    params,
    query,
    sortable: {
      name: 'd.name', value: 'd.value', start: 'd.start_date', end: 'd.end_date', usage: 'd.usage_count',
      status: 'd.status', created: 'd.created_at',
    },
    defaultSort: 'd.name',
  });
}

function get(id) {
  const now = today();
  const row = db.prepare(`SELECT * FROM ${FROM} WHERE d.id = ?`).get(now, now, Number(id));
  if (!row) h.findOr404('discounts', id, 'Discount');
  const d = { ...row };
  d.products = db.prepare(`SELECT p.id, p.name, p.is_active FROM discount_products dp
    JOIN products p ON p.id = dp.product_id WHERE dp.discount_id = ? ORDER BY p.name`).all(d.id).map((r) => ({ ...r }));
  d.product_ids = d.products.map((p) => p.id);
  d.subscriptions = db.prepare(`SELECT s.id, s.number, s.status, c.name AS customer_name FROM discount_subscriptions ds
    JOIN subscriptions s ON s.id = ds.subscription_id JOIN customers c ON c.id = s.customer_id
    WHERE ds.discount_id = ? ORDER BY s.number`).all(d.id).map((r) => ({ ...r }));
  d.subscription_ids = d.subscriptions.map((s) => s.id);
  d.usages = db.prepare(`SELECT du.id, du.invoice_id, du.amount, du.created_at,
      i.number AS invoice_number, i.status AS invoice_status, i.invoice_date, c.name AS customer_name
    FROM discount_usages du JOIN invoices i ON i.id = du.invoice_id JOIN customers c ON c.id = i.customer_id
    WHERE du.discount_id = ? ORDER BY du.created_at DESC, du.id DESC`).all(d.id).map((r) => ({ ...r }));
  d.remaining = d.usage_limit === null ? null : Math.max(0, d.usage_limit - d.usage_count);
  return d;
}

function checkRefs(v, existing = null) {
  const errors = {};
  const badProducts = h.missingIds('products', v.product_ids);
  if (badProducts.length) errors.product_ids = `Unknown product id(s): ${badProducts.join(', ')}`;
  const badSubs = h.missingIds('subscriptions', v.subscription_ids);
  if (badSubs.length) errors.subscription_ids = `Unknown subscription id(s): ${badSubs.join(', ')}`;
  if (existing && v.usage_limit !== null && v.usage_limit < existing.usage_count) {
    errors.usage_limit = `Already used ${existing.usage_count} times; the limit cannot be lower than that`;
  }
  if (Object.keys(errors).length) throw unprocessable(errors);
}

function saveLinks(discountId, v) {
  db.prepare('DELETE FROM discount_products WHERE discount_id = ?').run(discountId);
  db.prepare('DELETE FROM discount_subscriptions WHERE discount_id = ?').run(discountId);
  const insP = db.prepare('INSERT INTO discount_products (discount_id, product_id) VALUES (?, ?)');
  const insS = db.prepare('INSERT INTO discount_subscriptions (discount_id, subscription_id) VALUES (?, ?)');
  for (const pid of v.product_ids) insP.run(discountId, pid);
  for (const sid of v.subscription_ids) insS.run(discountId, sid);
}

const COLS = ['name', 'discount_type', 'value', 'scope', 'min_purchase', 'min_quantity', 'start_date', 'end_date',
  'usage_limit', 'is_active'];

function create(v, user) {
  checkRefs(v);
  h.assertUniqueName('discounts', v.name, null, 'discount');
  const id = transaction(() => {
    const values = COLS.map((c) => (c === 'is_active' ? v.is_active ?? 1 : v[c]));
    const info = db.prepare(`INSERT INTO discounts (${COLS.join(', ')}, created_by)
      VALUES (${COLS.map(() => '?').join(', ')}, ?)`).run(...values, user ? user.id : null);
    const discountId = Number(info.lastInsertRowid);
    saveLinks(discountId, v);
    return discountId;
  });
  return get(id);
}

function update(id, v) {
  const d = h.findOr404('discounts', id, 'Discount');
  checkRefs(v, d);
  h.assertUniqueName('discounts', v.name, d.id, 'discount');
  transaction(() => {
    const values = COLS.map((c) => (c === 'is_active' ? v.is_active ?? d.is_active : v[c]));
    db.prepare(`UPDATE discounts SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, d.id);
    saveLinks(d.id, v);
  });
  return get(d.id);
}

function setActive(id, active) {
  const d = h.findOr404('discounts', id, 'Discount');
  db.prepare('UPDATE discounts SET is_active = ? WHERE id = ?').run(active ? 1 : 0, d.id);
  return get(d.id);
}

function remove(id) {
  const d = h.findOr404('discounts', id, 'Discount');
  const used = h.usage([['discount_usages', 'discount_id']], d.id);
  if (used.total > 0) throw h.inUseConflict('discount', { total: used.total, invoices: used.discount_usages });
  db.prepare('DELETE FROM discounts WHERE id = ?').run(d.id);
}

module.exports = { list, get, create, update, setActive, remove, STATUSES };
