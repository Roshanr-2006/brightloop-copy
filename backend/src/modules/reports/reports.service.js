'use strict';

// Finance reports. Every number is aggregated in SQL (one query per figure group, no N+1),
// filtered on indexed columns so the dashboard stays fast with thousands of rows.

const { db } = require('../../db');
const { round2 } = require('../../utils/money');
const { today, isValidDate, addMonths } = require('../../utils/dates');
const { likePattern } = require('../../utils/pagination');

// Composite / covering indexes for the report queries (schema.sql is shared, so they live here).
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_rpt_invoices_status_date ON invoices(status, invoice_date, total_amount, amount_paid);
  CREATE INDEX IF NOT EXISTS idx_rpt_invoices_status_due  ON invoices(status, due_date, total_amount, amount_paid);
  CREATE INDEX IF NOT EXISTS idx_rpt_invoices_customer    ON invoices(customer_id, status, invoice_date);
  CREATE INDEX IF NOT EXISTS idx_rpt_payments_date_method ON payments(payment_date, method, amount);
  CREATE INDEX IF NOT EXISTS idx_rpt_subs_status_plan     ON subscriptions(status, plan_id, customer_id);
`);

const MONTHLY_FACTOR_SQL = `(CASE p.billing_period
    WHEN 'daily' THEN 30.0
    WHEN 'weekly' THEN 52.0 / 12
    WHEN 'monthly' THEN 1.0
    WHEN 'yearly' THEN 1.0 / 12
    ELSE 1.0 END / p.billing_interval)`;

const SUB_STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];
const INVOICE_STATUSES = ['draft', 'confirmed', 'paid', 'cancelled'];
const METHODS = ['bank_transfer', 'upi', 'cash', 'card', 'cheque', 'other'];

const toId = (v) => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isInteger(n) && n > 0 ? n : null;
};

/** Normalise query filters: { from, to, planId, customerId }. Invalid values are ignored. */
function parseFilters(query = {}) {
  return {
    from: isValidDate(query.from) ? query.from : null,
    to: isValidDate(query.to) ? query.to : null,
    planId: toId(query.plan_id),
    customerId: toId(query.customer_id),
  };
}

/**
 * WHERE fragments for an invoices table alias. Plan filter goes through the subscription.
 * dateColumn: which date the from/to range applies to (null = no range).
 */
function invoiceWhere(f, alias = 'i', dateColumn = 'invoice_date') {
  const where = [];
  const params = [];
  if (dateColumn && f.from) { where.push(`${alias}.${dateColumn} >= ?`); params.push(f.from); }
  if (dateColumn && f.to) { where.push(`${alias}.${dateColumn} <= ?`); params.push(f.to); }
  if (f.customerId) { where.push(`${alias}.customer_id = ?`); params.push(f.customerId); }
  if (f.planId) {
    where.push(`${alias}.subscription_id IN (SELECT id FROM subscriptions WHERE plan_id = ?)`);
    params.push(f.planId);
  }
  return { where, params };
}

function paymentWhere(f, alias = 'pm') {
  const where = [];
  const params = [];
  if (f.from) { where.push(`${alias}.payment_date >= ?`); params.push(f.from); }
  if (f.to) { where.push(`${alias}.payment_date <= ?`); params.push(f.to); }
  if (f.customerId) { where.push(`${alias}.customer_id = ?`); params.push(f.customerId); }
  if (f.planId) {
    where.push(`${alias}.invoice_id IN (SELECT i2.id FROM invoices i2 JOIN subscriptions s2 ON s2.id = i2.subscription_id WHERE s2.plan_id = ?)`);
    params.push(f.planId);
  }
  return { where, params };
}

function subscriptionWhere(f, alias = 's') {
  const where = [];
  const params = [];
  if (f.planId) { where.push(`${alias}.plan_id = ?`); params.push(f.planId); }
  if (f.customerId) { where.push(`${alias}.customer_id = ?`); params.push(f.customerId); }
  return { where, params };
}

const and = (parts) => (parts.length ? ` AND ${parts.join(' AND ')}` : '');
const whereSql = (parts) => (parts.length ? `WHERE ${parts.join(' AND ')}` : '');

function timed(fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ...result, generated_ms: Math.round(ms * 10) / 10 };
}

/* ---------------------------------------------------------------- summary */

function subscriptionCounts(f) {
  const sw = subscriptionWhere(f);
  const rows = db.prepare(`SELECT s.status, COUNT(*) AS n FROM subscriptions s ${whereSql(sw.where)} GROUP BY s.status`)
    .all(...sw.params);
  const counts = Object.fromEntries(SUB_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const r of rows) { counts[r.status] = r.n; total += r.n; }
  return { ...counts, total };
}

function mrr(f) {
  const sw = subscriptionWhere(f);
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.amount * ${MONTHLY_FACTOR_SQL}), 0) AS mrr
    FROM subscriptions s
    JOIN recurring_plans p ON p.id = s.plan_id
    JOIN subscription_lines l ON l.subscription_id = s.id
    WHERE s.status = 'active'${and(sw.where)}`).get(...sw.params);
  return round2(row.mrr);
}

function summary(query) {
  return timed(() => {
    const f = parseFilters(query);
    const asOf = today();

    const inv = invoiceWhere(f);
    const invoiced = db.prepare(`
      SELECT COALESCE(SUM(i.total_amount), 0) AS amount, COUNT(*) AS n
      FROM invoices i WHERE i.status IN ('confirmed', 'paid')${and(inv.where)}`).get(...inv.params);

    const pw = paymentWhere(f);
    const collected = db.prepare(`
      SELECT COALESCE(SUM(pm.amount), 0) AS amount, COUNT(*) AS n
      FROM payments pm ${whereSql(pw.where)}`).get(...pw.params);

    // Outstanding / overdue are "as of today" snapshots (not limited by the date range).
    const open = invoiceWhere(f, 'i', null);
    const balances = db.prepare(`
      SELECT COALESCE(SUM(i.total_amount - i.amount_paid), 0) AS outstanding,
             COUNT(*) AS outstanding_count,
             COALESCE(SUM(CASE WHEN i.due_date < ? THEN i.total_amount - i.amount_paid ELSE 0 END), 0) AS overdue_amount,
             COALESCE(SUM(CASE WHEN i.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count
      FROM invoices i WHERE i.status = 'confirmed'${and(open.where)}`).get(asOf, asOf, ...open.params);

    const statusRows = db.prepare(`
      SELECT i.status, COUNT(*) AS n, COALESCE(SUM(i.total_amount), 0) AS amount
      FROM invoices i ${whereSql(inv.where)} GROUP BY i.status`).all(...inv.params);
    const invoices = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, 0]));
    const invoiceAmounts = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, 0]));
    for (const r of statusRows) { invoices[r.status] = r.n; invoiceAmounts[r.status] = round2(r.amount); }

    return {
      as_of: asOf,
      filters: { from: f.from, to: f.to, plan_id: f.planId, customer_id: f.customerId },
      subscriptions: subscriptionCounts(f),
      mrr: mrr(f),
      revenue: {
        invoiced: round2(invoiced.amount),
        invoiced_count: invoiced.n,
        collected: round2(collected.amount),
        payments_count: collected.n,
        outstanding: round2(balances.outstanding),
        outstanding_count: balances.outstanding_count,
        overdue_amount: round2(balances.overdue_amount),
        overdue_count: balances.overdue_count,
      },
      invoices,
      invoice_amounts: invoiceAmounts,
    };
  });
}

/* ---------------------------------------------------------------- revenue by month */

function monthList(fromMonth, toMonth) {
  const months = [];
  let cur = `${fromMonth}-01`;
  const end = `${toMonth}-01`;
  while (cur <= end && months.length < 120) {
    months.push(cur.slice(0, 7));
    cur = addMonths(cur, 1);
  }
  return months;
}

function revenue(query) {
  return timed(() => {
    const f = parseFilters(query);
    let from = f.from;
    let to = f.to;
    if (!from || !to) {
      const n = Math.min(Math.max(parseInt(query.months, 10) || 12, 1), 36);
      const endMonth = (to || today()).slice(0, 7);
      to = to || today();
      from = from || addMonths(`${endMonth}-01`, -(n - 1));
    }
    if (from > to) [from, to] = [to, from];
    const range = { ...f, from, to };

    const inv = invoiceWhere(range);
    const invRows = db.prepare(`
      SELECT substr(i.invoice_date, 1, 7) AS month, COALESCE(SUM(i.total_amount), 0) AS invoiced, COUNT(*) AS invoice_count
      FROM invoices i WHERE i.status IN ('confirmed', 'paid')${and(inv.where)}
      GROUP BY month`).all(...inv.params);
    const pw = paymentWhere(range);
    const payRows = db.prepare(`
      SELECT substr(pm.payment_date, 1, 7) AS month, COALESCE(SUM(pm.amount), 0) AS collected, COUNT(*) AS payment_count
      FROM payments pm ${whereSql(pw.where)}
      GROUP BY month`).all(...pw.params);

    const byMonth = new Map();
    for (const m of monthList(from.slice(0, 7), to.slice(0, 7))) {
      byMonth.set(m, { month: m, invoiced: 0, collected: 0, invoice_count: 0, payment_count: 0 });
    }
    for (const r of invRows) {
      const row = byMonth.get(r.month);
      if (row) { row.invoiced = round2(r.invoiced); row.invoice_count = r.invoice_count; }
    }
    for (const r of payRows) {
      const row = byMonth.get(r.month);
      if (row) { row.collected = round2(r.collected); row.payment_count = r.payment_count; }
    }
    const items = [...byMonth.values()];
    return {
      from,
      to,
      items,
      totals: {
        invoiced: round2(items.reduce((s, r) => s + r.invoiced, 0)),
        collected: round2(items.reduce((s, r) => s + r.collected, 0)),
      },
    };
  });
}

/* ---------------------------------------------------------------- overdue */

const OVERDUE_SORTS = {
  days: 'i.due_date ASC, i.id ASC',
  balance: 'balance DESC, i.id ASC',
  customer: 'c.name ASC, i.due_date ASC',
};

function overdue(query, { page, limit, offset }) {
  return timed(() => {
    const f = parseFilters(query);
    const asOf = today();
    const base = invoiceWhere(f, 'i', null);
    const where = ["i.status = 'confirmed'", 'i.due_date < ?', ...base.where];
    const params = [asOf, ...base.params];
    let joinCustomer = false;
    if (query.search && String(query.search).trim()) {
      const pattern = likePattern(String(query.search).trim());
      where.push("(i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
      joinCustomer = true;
    }
    const join = joinCustomer ? 'JOIN customers c ON c.id = i.customer_id' : '';
    const w = whereSql(where);

    const agg = db.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(i.total_amount - i.amount_paid), 0) AS amount,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) <= 30 THEN i.total_amount - i.amount_paid END), 0) AS b0,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) <= 30 THEN 1 END), 0) AS c0,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 31 AND 60 THEN i.total_amount - i.amount_paid END), 0) AS b1,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 31 AND 60 THEN 1 END), 0) AS c1,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 61 AND 90 THEN i.total_amount - i.amount_paid END), 0) AS b2,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 61 AND 90 THEN 1 END), 0) AS c2,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) > 90 THEN i.total_amount - i.amount_paid END), 0) AS b3,
        COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) > 90 THEN 1 END), 0) AS c3
      FROM invoices i ${join} ${w}`).get(...Array(8).fill(asOf), ...params);

    const sort = OVERDUE_SORTS[query.sort] || OVERDUE_SORTS.days;
    const items = db.prepare(`
      SELECT i.id, i.number, i.customer_id, c.name AS customer_name, c.email AS customer_email,
             i.subscription_id, s.number AS subscription_number,
             i.invoice_date, i.due_date, i.total_amount, i.amount_paid,
             ROUND(i.total_amount - i.amount_paid, 2) AS balance,
             CAST(julianday(?) - julianday(i.due_date) AS INTEGER) AS days_overdue
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      LEFT JOIN subscriptions s ON s.id = i.subscription_id
      ${w}
      ORDER BY ${sort}
      LIMIT ? OFFSET ?`).all(asOf, ...params, limit, offset);

    return {
      as_of: asOf,
      items,
      total: agg.total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(agg.total / limit)),
      total_balance: round2(agg.amount),
      buckets: [
        { key: '0-30', label: '1-30 days', amount: round2(agg.b0), count: agg.c0 },
        { key: '31-60', label: '31-60 days', amount: round2(agg.b1), count: agg.c1 },
        { key: '61-90', label: '61-90 days', amount: round2(agg.b2), count: agg.c2 },
        { key: '90+', label: '90+ days', amount: round2(agg.b3), count: agg.c3 },
      ],
    };
  });
}

/* ---------------------------------------------------------------- payments by method */

function paymentsByMethod(query) {
  return timed(() => {
    const f = parseFilters(query);
    const pw = paymentWhere(f);
    const rows = db.prepare(`
      SELECT pm.method, COUNT(*) AS count, COALESCE(SUM(pm.amount), 0) AS amount
      FROM payments pm ${whereSql(pw.where)} GROUP BY pm.method`).all(...pw.params);
    const map = new Map(rows.map((r) => [r.method, r]));
    const total = round2(rows.reduce((s, r) => s + r.amount, 0));
    const items = METHODS.map((m) => {
      const r = map.get(m) || { count: 0, amount: 0 };
      return {
        method: m,
        count: r.count,
        amount: round2(r.amount),
        share: total > 0 ? Math.round((r.amount / total) * 1000) / 10 : 0,
      };
    }).sort((a, b) => b.amount - a.amount);
    return { items, total, count: rows.reduce((s, r) => s + r.count, 0) };
  });
}

/* ---------------------------------------------------------------- subscriptions by plan */

function subscriptionsByPlan(query) {
  return timed(() => {
    const f = parseFilters(query);
    const sw = subscriptionWhere(f);
    const counts = db.prepare(`
      SELECT s.plan_id,
        COUNT(*) AS total,
        SUM(s.status = 'draft') AS draft, SUM(s.status = 'quotation') AS quotation,
        SUM(s.status = 'confirmed') AS confirmed, SUM(s.status = 'active') AS active,
        SUM(s.status = 'paused') AS paused, SUM(s.status = 'closed') AS closed
      FROM subscriptions s ${whereSql(sw.where)} GROUP BY s.plan_id`).all(...sw.params);
    const mrrRows = db.prepare(`
      SELECT s.plan_id, COALESCE(SUM(l.amount * ${MONTHLY_FACTOR_SQL}), 0) AS mrr
      FROM subscriptions s
      JOIN recurring_plans p ON p.id = s.plan_id
      JOIN subscription_lines l ON l.subscription_id = s.id
      WHERE s.status = 'active'${and(sw.where)}
      GROUP BY s.plan_id`).all(...sw.params);
    const plans = db.prepare(`
      SELECT id, name, billing_period, billing_interval, price, is_active FROM recurring_plans ORDER BY name`).all();

    const countMap = new Map(counts.map((r) => [r.plan_id, r]));
    const mrrMap = new Map(mrrRows.map((r) => [r.plan_id, r.mrr]));
    const items = plans
      .filter((p) => !f.planId || p.id === f.planId)
      .map((p) => {
        const c = countMap.get(p.id) || {};
        const row = { plan_id: p.id, plan_name: p.name, billing_period: p.billing_period, billing_interval: p.billing_interval, is_active: p.is_active };
        for (const s of SUB_STATUSES) row[s] = c[s] || 0;
        row.total = c.total || 0;
        row.mrr = round2(mrrMap.get(p.id) || 0);
        return row;
      })
      .sort((a, b) => b.total - a.total || a.plan_name.localeCompare(b.plan_name));
    const by_status = subscriptionCounts(f);
    return { items, by_status, mrr: round2(items.reduce((s, r) => s + r.mrr, 0)) };
  });
}

/* ---------------------------------------------------------------- top customers */

function topCustomers(query) {
  return timed(() => {
    const f = parseFilters(query);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 5, 1), 50);
    const inv = invoiceWhere(f);
    const items = db.prepare(`
      SELECT t.customer_id, c.name AS customer_name, c.company_name, c.email,
             t.invoice_count, t.revenue, t.collected, t.outstanding
      FROM (
        SELECT i.customer_id, COUNT(*) AS invoice_count,
               ROUND(SUM(i.total_amount), 2) AS revenue,
               ROUND(SUM(i.amount_paid), 2) AS collected,
               ROUND(SUM(CASE WHEN i.status = 'confirmed' THEN i.total_amount - i.amount_paid ELSE 0 END), 2) AS outstanding
        FROM invoices i
        WHERE i.status IN ('confirmed', 'paid')${and(inv.where)}
        GROUP BY i.customer_id
        ORDER BY revenue DESC
        LIMIT ?
      ) t
      JOIN customers c ON c.id = t.customer_id
      ORDER BY t.revenue DESC, c.name`).all(...inv.params, limit);
    return { items, limit };
  });
}

module.exports = {
  parseFilters, summary, revenue, overdue, paymentsByMethod, subscriptionsByPlan, topCustomers,
};
