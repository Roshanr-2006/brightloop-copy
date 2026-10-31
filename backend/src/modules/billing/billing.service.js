'use strict';

// Billing run (owner: Swathy, module C).
//   runBilling({ date, userId, autoConfirm }) -> { date, created, skipped, closed, errors, invoices }
//   billSubscriptionNow(subscriptionId, { userId, autoConfirm }) -> invoice summary
// Rules:
//   * one transaction per subscription (a bad row never blocks the others)
//   * one invoice per period, catching up every missed period up to the run date
//   * never double-bill: pre-check + the unique index uq_invoices_subscription_period
//   * discounts from the catalog applied before taxes; usage recorded in the same transaction

const { db, transaction } = require('../../db');
const catalog = require('../catalog/catalog.service');
const { round2, computeLine } = require('../../utils/money');
const { today, addDays, addPeriod, isValidDate } = require('../../utils/dates');
const { nextNumber } = require('../../utils/sequence');
const { notFound, conflict, unprocessable } = require('../../utils/httpError');

const MAX_PERIODS_PER_RUN = 1000; // safety stop for a daily plan years behind

const stmt = {
  due: db.prepare(`
    SELECT s.id, s.number, s.customer_id, s.status, s.start_date, s.expiry_date, s.next_invoice_date,
           s.payment_term_id, c.name AS customer_name, p.name AS plan_name,
           p.billing_period, p.billing_interval, p.auto_close, COALESCE(pt.due_days, 0) AS due_days
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN recurring_plans p ON p.id = s.plan_id
    LEFT JOIN payment_terms pt ON pt.id = s.payment_term_id
    WHERE s.status = 'active' AND s.next_invoice_date IS NOT NULL AND s.next_invoice_date <= ?
    ORDER BY s.next_invoice_date, s.id`),
  one: db.prepare(`
    SELECT s.id, s.number, s.customer_id, s.status, s.start_date, s.expiry_date, s.next_invoice_date,
           s.payment_term_id, c.name AS customer_name, p.name AS plan_name,
           p.billing_period, p.billing_interval, p.auto_close, COALESCE(pt.due_days, 0) AS due_days
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN recurring_plans p ON p.id = s.plan_id
    LEFT JOIN payment_terms pt ON pt.id = s.payment_term_id
    WHERE s.id = ?`),
  lines: db.prepare(`
    SELECT l.id, l.product_id, l.variant_id, l.description, l.quantity, l.unit_price,
           pr.name AS product_name, av.name AS value_name, a.name AS attribute_name
    FROM subscription_lines l
    JOIN products pr ON pr.id = l.product_id
    LEFT JOIN product_variants v ON v.id = l.variant_id
    LEFT JOIN product_attribute_values av ON av.id = v.attribute_value_id
    LEFT JOIN product_attributes a ON a.id = av.attribute_id
    WHERE l.subscription_id = ?
    ORDER BY l.id`),
  lineTaxes: db.prepare(`
    SELECT lt.line_id, t.id, t.name, t.computation, t.amount
    FROM subscription_line_taxes lt
    JOIN subscription_lines l ON l.id = lt.line_id
    JOIN taxes t ON t.id = lt.tax_id
    WHERE l.subscription_id = ? AND t.is_active = 1
    ORDER BY t.name`),
  existing: db.prepare(`
    SELECT id FROM invoices WHERE subscription_id = ? AND period_start = ? AND status <> 'cancelled'`),
  insertInvoice: db.prepare(`
    INSERT INTO invoices (number, subscription_id, customer_id, status, invoice_date, due_date,
                          period_start, period_end, confirmed_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insertLine: db.prepare(`
    INSERT INTO invoice_lines (invoice_id, product_id, variant_id, description, quantity, unit_price,
                               discount_amount, tax_amount, subtotal, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insertLineTax: db.prepare(`
    INSERT INTO invoice_line_taxes (line_id, tax_id, tax_name, rate, amount) VALUES (?, ?, ?, ?, ?)`),
  totals: db.prepare(`
    UPDATE invoices SET untaxed_amount = ?, discount_amount = ?, tax_amount = ?, total_amount = ? WHERE id = ?`),
  advance: db.prepare(`
    UPDATE subscriptions SET next_invoice_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
  autoCloseCandidates: db.prepare(`
    SELECT s.id, s.number, s.expiry_date
    FROM subscriptions s JOIN recurring_plans p ON p.id = s.plan_id
    WHERE s.status = 'active' AND p.auto_close = 1 AND s.expiry_date IS NOT NULL AND s.expiry_date < ?`),
  close: db.prepare(`
    UPDATE subscriptions SET status = 'closed', closed_at = ?, close_reason = 'Expired (auto-close)',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND status = 'active'`),
  history: db.prepare(`
    INSERT INTO subscription_status_history (subscription_id, from_status, to_status, changed_by, note)
    VALUES (?, ?, ?, ?, ?)`),
};

/**
 * Start of the period after `current`, anchored on the subscription start date so month-end
 * subscriptions don't drift (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
 */
function nextPeriodStart(sub, current) {
  const { billing_period: period, billing_interval: interval } = sub;
  const anchor = sub.start_date;
  if ((period === 'monthly' || period === 'yearly') && anchor && anchor <= current) {
    const months = (Number(current.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12
      + (Number(current.slice(5, 7)) - Number(anchor.slice(5, 7)));
    const step = (period === 'yearly' ? 12 : 1) * (Number(interval) || 1);
    if (months % step === 0) {
      const k = months / step;
      if (addPeriod(anchor, period, interval * k) === current) return addPeriod(anchor, period, interval * (k + 1));
    }
  }
  return addPeriod(current, period, interval);
}

const periodEnd = (start, sub) => addDays(nextPeriodStart(sub, start), -1);

/** Subscription lines with their taxes, shaped for invoicing. */
function loadLines(subscriptionId) {
  const taxes = new Map();
  for (const t of stmt.lineTaxes.all(subscriptionId)) {
    if (!taxes.has(t.line_id)) taxes.set(t.line_id, []);
    taxes.get(t.line_id).push({ id: t.id, name: t.name, computation: t.computation, amount: Number(t.amount) });
  }
  return stmt.lines.all(subscriptionId).map((l) => {
    const variant = l.value_name ? (l.attribute_name ? `${l.attribute_name}: ${l.value_name}` : l.value_name) : null;
    const quantity = Number(l.quantity);
    const unitPrice = round2(l.unit_price);
    return {
      product_id: l.product_id,
      variant_id: l.variant_id,
      description: l.description || (variant ? `${l.product_name} (${variant})` : l.product_name),
      quantity,
      unit_price: unitPrice,
      gross: round2(quantity * unitPrice),
      taxes: taxes.get(l.id) || [],
    };
  });
}

/**
 * Discount amounts per line for one discount, given what earlier discounts already took.
 * Returns an array of amounts (same order as lines).
 */
function allocateDiscount(discount, lines, taken) {
  const remaining = lines.map((l, i) => round2(l.gross - taken[i]));
  const out = lines.map(() => 0);
  const value = Number(discount.value);
  if (discount.scope === 'product') {
    const ids = new Set((discount.productIds || []).map(Number));
    lines.forEach((l, i) => {
      if (!ids.has(Number(l.product_id)) || remaining[i] <= 0) return;
      const amt = discount.discount_type === 'percent' ? round2((l.gross * value) / 100) : value;
      out[i] = round2(Math.min(amt, remaining[i]));
    });
    return out;
  }
  // Subscription scope: percent of the (remaining) subtotal or a fixed amount, spread proportionally.
  const base = round2(remaining.reduce((s, r) => s + Math.max(0, r), 0));
  if (base <= 0) return out;
  const total = round2(Math.min(discount.discount_type === 'percent' ? (base * value) / 100 : value, base));
  let allocated = 0;
  let lastIdx = -1;
  remaining.forEach((r, i) => { if (r > 0) lastIdx = i; });
  remaining.forEach((r, i) => {
    if (r <= 0) return;
    const share = i === lastIdx ? round2(total - allocated) : round2((total * r) / base);
    out[i] = round2(Math.min(Math.max(0, share), r));
    allocated = round2(allocated + out[i]);
  });
  return out;
}

/** Create the invoice for one period. Must run inside a transaction. Returns { id, number, total_amount }. */
function createPeriodInvoice(sub, lines, start, { userId, autoConfirm }) {
  const end = periodEnd(start, sub);
  const invoiceDate = start;
  const dueDate = addDays(invoiceDate, Number(sub.due_days) || 0);
  const number = nextNumber('invoice', Number(invoiceDate.slice(0, 4)));
  const status = autoConfirm ? 'confirmed' : 'draft';
  const info = stmt.insertInvoice.run(
    number, sub.id, sub.customer_id, status, invoiceDate, dueDate, start, end,
    autoConfirm ? new Date().toISOString() : null, userId ?? null,
  );
  const invoiceId = Number(info.lastInsertRowid);

  // Discounts: product scope first, then subscription scope (applied to what remains).
  const discounts = catalog.getApplicableDiscounts({
    subscriptionId: sub.id,
    lines: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, amount: l.gross })),
    date: invoiceDate,
  }).sort((a, b) => (a.scope === b.scope ? a.id - b.id : a.scope === 'product' ? -1 : 1));
  const taken = lines.map(() => 0);
  for (const d of discounts) {
    const amounts = allocateDiscount(d, lines, taken);
    const amount = round2(amounts.reduce((s, a) => s + a, 0));
    if (amount <= 0) continue;
    if (!catalog.recordDiscountUsage(d.id, invoiceId, amount)) continue; // limit reached meanwhile
    amounts.forEach((a, i) => { taken[i] = round2(taken[i] + a); });
  }

  let untaxed = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  lines.forEach((l, i) => {
    const calc = computeLine({ quantity: l.quantity, unit_price: l.unit_price, discount_amount: taken[i], taxes: l.taxes });
    const lineInfo = stmt.insertLine.run(
      invoiceId, l.product_id, l.variant_id, l.description, l.quantity, calc.unit_price,
      calc.discount_amount, calc.tax_amount, calc.subtotal, calc.total,
    );
    const lineId = Number(lineInfo.lastInsertRowid);
    for (const t of calc.taxes) stmt.insertLineTax.run(lineId, t.id, t.name, t.rate, t.amount);
    untaxed += calc.subtotal;
    discountTotal += calc.discount_amount;
    taxTotal += calc.tax_amount;
  });
  untaxed = round2(untaxed);
  taxTotal = round2(taxTotal);
  const total = round2(untaxed + taxTotal);
  stmt.totals.run(untaxed, round2(discountTotal), taxTotal, total, invoiceId);
  return { id: invoiceId, number, total_amount: total, period_start: start, period_end: end, status };
}

const isPeriodConflict = (err) => /invoices\.subscription_id, invoices\.period_start/.test(String(err && err.message));

/**
 * Bill one subscription (caller decides the limits). One transaction for the whole catch-up.
 *   until: last allowed period start (inclusive); maxPeriods: stop after N periods.
 * Returns { invoices, skipped }.
 */
function billSubscription(sub, { until, maxPeriods = MAX_PERIODS_PER_RUN, userId = null, autoConfirm = false }) {
  return transaction(() => {
    const lines = loadLines(sub.id);
    const created = [];
    let skipped = 0;
    let next = sub.next_invoice_date || sub.start_date;
    let periods = 0;
    while ((until === null || next <= until) && periods < maxPeriods) {
      if (sub.expiry_date && next > sub.expiry_date) break; // nothing to bill after expiry
      periods += 1;
      const following = nextPeriodStart(sub, next);
      if (lines.length === 0 || stmt.existing.get(sub.id, next)) {
        skipped += 1;
      } else {
        try {
          const inv = createPeriodInvoice(sub, lines, next, { userId, autoConfirm });
          created.push({ ...inv, subscription_id: sub.id, subscription_number: sub.number, customer_name: sub.customer_name });
        } catch (err) {
          if (!isPeriodConflict(err)) throw err;
          skipped += 1;
        }
      }
      next = following;
    }
    if (periods > 0) stmt.advance.run(next, sub.id);
    return { invoices: created, skipped };
  });
}

/**
 * The billing run. Bills every active subscription due on or before `date`,
 * then closes expired subscriptions whose plan has auto_close.
 */
function runBilling({ date, userId = null, autoConfirm = false } = {}) {
  const runDate = date || today();
  if (!isValidDate(runDate)) throw unprocessable({ date: 'Invalid date (YYYY-MM-DD)' });
  const result = { date: runDate, created: 0, skipped: 0, closed: 0, errors: [], invoices: [], closed_subscriptions: [] };
  const failed = new Set();

  for (const sub of stmt.due.all(runDate)) {
    try {
      const { invoices, skipped } = billSubscription(sub, { until: runDate, userId, autoConfirm });
      result.created += invoices.length;
      result.skipped += skipped;
      for (const inv of invoices) {
        result.invoices.push({
          id: inv.id, number: inv.number, customer_name: inv.customer_name, total_amount: inv.total_amount,
          subscription_id: inv.subscription_id, subscription_number: inv.subscription_number,
          period_start: inv.period_start, period_end: inv.period_end, status: inv.status,
        });
      }
    } catch (err) {
      failed.add(sub.id);
      result.errors.push({ subscription_id: sub.id, number: sub.number, error: err.message });
    }
  }

  // Auto-close after the last period has been billed above.
  const closedAt = new Date().toISOString();
  for (const sub of stmt.autoCloseCandidates.all(runDate)) {
    if (failed.has(sub.id)) continue;
    try {
      transaction(() => {
        const info = stmt.close.run(closedAt, sub.id);
        if (Number(info.changes) === 1) {
          stmt.history.run(sub.id, 'active', 'closed', userId, 'Expired (auto-close)');
          result.closed += 1;
          result.closed_subscriptions.push({ id: sub.id, number: sub.number, expiry_date: sub.expiry_date });
        }
      });
    } catch (err) {
      result.errors.push({ subscription_id: sub.id, number: sub.number, error: err.message });
    }
  }
  return result;
}

/** Generate the next invoice of one active subscription right now (same code path as the run). */
function billSubscriptionNow(subscriptionId, { userId = null, autoConfirm = false } = {}) {
  const sub = stmt.one.get(Number(subscriptionId));
  if (!sub) throw notFound('Subscription not found');
  if (sub.status !== 'active') throw conflict('Only active subscriptions can be invoiced');
  const next = sub.next_invoice_date || sub.start_date;
  if (sub.expiry_date && next > sub.expiry_date) {
    throw conflict(`Nothing left to bill: the subscription expired on ${sub.expiry_date}`);
  }
  const { invoices } = billSubscription(sub, { until: null, maxPeriods: 1, userId, autoConfirm });
  if (invoices.length === 0) throw conflict('An invoice already exists for this period');
  return invoices[0];
}

/** What a run on `date` would do (no writes). */
function previewBilling({ date } = {}) {
  const runDate = date || today();
  if (!isValidDate(runDate)) throw unprocessable({ date: 'Invalid date (YYYY-MM-DD)' });
  const amountOf = db.prepare('SELECT COALESCE(SUM(amount), 0) AS a FROM subscription_lines WHERE subscription_id = ?');
  const items = [];
  let totalPeriods = 0;
  for (const sub of stmt.due.all(runDate)) {
    let next = sub.next_invoice_date;
    let periods = 0;
    while (next <= runDate && periods < MAX_PERIODS_PER_RUN) {
      if (sub.expiry_date && next > sub.expiry_date) break;
      periods += 1;
      next = nextPeriodStart(sub, next);
    }
    totalPeriods += periods;
    const amount = round2(amountOf.get(sub.id).a);
    items.push({
      id: sub.id,
      number: sub.number,
      customer_name: sub.customer_name,
      plan_name: sub.plan_name,
      billing_period: sub.billing_period,
      next_invoice_date: sub.next_invoice_date,
      expiry_date: sub.expiry_date,
      periods,
      recurring_amount: amount,
      estimated_untaxed: round2(amount * periods),
    });
  }
  const toClose = stmt.autoCloseCandidates.all(runDate).map((r) => ({ ...r }));
  return {
    date: runDate,
    subscriptions: items.length,
    periods: totalPeriods,
    items,
    to_close: toClose,
  };
}

module.exports = { runBilling, billSubscriptionNow, previewBilling, allocateDiscount };
