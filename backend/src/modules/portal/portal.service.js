'use strict';

// Customer portal (owner: Sachin). Every query is scoped to the logged-in customer's id.
// Lists are plain scoped SQL (fast, and they work even before the subscriptions/invoices
// modules exist). Details and actions delegate to those modules' service contracts after
// ownership has been verified here.

const { db } = require('../../db');
const { HttpError, notFound } = require('../../utils/httpError');
const { paged, likePattern } = require('../../utils/pagination');
const { today } = require('../../utils/dates');
const { round2 } = require('../../utils/money');
const customers = require('../customers/customers.service');

// Internal drafts are not shown to customers: quotations onwards / issued invoices only.
const VISIBLE_SUB = "s.status <> 'draft'";
const VISIBLE_INV = "i.status <> 'draft'";
const PORTAL_ACTIONS = ['pause', 'resume', 'close', 'renew'];

function lazyService(path, label) {
  try {
    return require(path);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(path.split('/').pop())) {
      throw new HttpError(503, `The ${label} module is not available yet. Please try again later.`);
    }
    throw err;
  }
}
const subscriptionsService = () => lazyService('../subscriptions/subscriptions.service', 'subscriptions');
const invoicesService = () => lazyService('../invoices/invoices.service', 'invoices');

function requireCustomer(customerId) {
  if (!customerId) throw notFound('No customer profile is linked to this login');
  return customerId;
}

// ------------------------------------------------------------------ subscriptions

const SUB_STATUSES = ['quotation', 'confirmed', 'active', 'paused', 'closed'];

function listSubscriptions(customerId, { status, search } = {}, pagination) {
  requireCustomer(customerId);
  const where = ['s.customer_id = ?', VISIBLE_SUB];
  const params = [customerId];
  if (status && SUB_STATUSES.includes(status)) { where.push('s.status = ?'); params.push(status); }
  if (search) { where.push("(s.number LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')"); params.push(likePattern(search), likePattern(search)); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM subscriptions s JOIN recurring_plans p ON p.id = s.plan_id ${whereSql}`).get(...params);
  const items = db.prepare(`
    SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date, s.quotation_valid_until,
           p.id AS plan_id, p.name AS plan_name, p.billing_period, p.billing_interval,
           p.pausable, p.closable, p.renewable,
           COALESCE((SELECT ROUND(SUM(l.amount), 2) FROM subscription_lines l WHERE l.subscription_id = s.id), 0) AS recurring_amount
    FROM subscriptions s JOIN recurring_plans p ON p.id = s.plan_id
    ${whereSql}
    ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'confirmed' THEN 2 WHEN 'quotation' THEN 3 ELSE 4 END, s.id DESC
    LIMIT ? OFFSET ?`).all(...params, pagination.limit, pagination.offset)
    .map((r) => ({ ...r, pausable: Boolean(r.pausable), closable: Boolean(r.closable), renewable: Boolean(r.renewable) }));
  return paged(items, total, pagination);
}

function assertOwnSubscription(customerId, id) {
  requireCustomer(customerId);
  const row = db.prepare(`SELECT s.id FROM subscriptions s WHERE s.id = ? AND s.customer_id = ? AND ${VISIBLE_SUB}`).get(id, customerId);
  if (!row) throw notFound('Subscription not found');
}

function portalView(sub) {
  const { created_by: _c, salesperson_id: _s, ...rest } = sub;
  return {
    ...rest,
    invoices: (sub.invoices || []).filter((i) => i.status !== 'draft'),
    allowed_actions: (sub.allowed_actions || []).filter((a) => PORTAL_ACTIONS.includes(a)),
  };
}

function getSubscription(customerId, id) {
  assertOwnSubscription(customerId, id);
  const sub = subscriptionsService().getSubscription(id);
  if (!sub || (sub.customer_id != null && Number(sub.customer_id) !== customerId)) throw notFound('Subscription not found');
  return portalView(sub);
}

function applyAction(customerId, id, action, userId, note) {
  if (!PORTAL_ACTIONS.includes(action)) throw notFound('Unknown action');
  assertOwnSubscription(customerId, id);
  const sub = subscriptionsService().applyAction(id, action, userId, { note: note || `${action} requested from the customer portal`, reason: note || null });
  return portalView(sub);
}

// ------------------------------------------------------------------ invoices

const INV_STATUSES = ['confirmed', 'paid', 'cancelled'];

function listInvoices(customerId, { status, search } = {}, pagination) {
  requireCustomer(customerId);
  const t = today();
  const where = ['i.customer_id = ?', VISIBLE_INV];
  const params = [customerId];
  if (status === 'overdue') { where.push("i.status = 'confirmed' AND i.due_date < ?"); params.push(t); }
  else if (status === 'outstanding' || status === 'unpaid') where.push("i.status = 'confirmed'");
  else if (status && INV_STATUSES.includes(status)) { where.push('i.status = ?'); params.push(status); }
  if (search) { where.push("(i.number LIKE ? ESCAPE '\\' OR s.number LIKE ? ESCAPE '\\')"); params.push(likePattern(search), likePattern(search)); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const from = 'FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id';
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${from} ${whereSql}`).get(...params);
  const items = db.prepare(`
    SELECT i.id, i.number, i.status, i.invoice_date, i.due_date, i.period_start, i.period_end,
           i.untaxed_amount, i.discount_amount, i.tax_amount, i.total_amount, i.amount_paid, i.paid_at,
           ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
           CASE WHEN i.status = 'confirmed' AND i.due_date < ? THEN 1 ELSE 0 END AS is_overdue,
           i.subscription_id, s.number AS subscription_number
    ${from} ${whereSql}
    ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`).all(t, ...params, pagination.limit, pagination.offset)
    .map((r) => ({ ...r, is_overdue: Boolean(r.is_overdue) }));
  const sums = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN i.status = 'confirmed' THEN i.total_amount - i.amount_paid END), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN i.status = 'confirmed' AND i.due_date < ? THEN i.total_amount - i.amount_paid END), 0) AS overdue
    FROM invoices i WHERE i.customer_id = ?`).get(t, customerId);
  return { ...paged(items, total, pagination), summary: { outstanding: round2(sums.outstanding), overdue: round2(sums.overdue) } };
}

function getInvoice(customerId, id) {
  requireCustomer(customerId);
  const row = db.prepare(`SELECT i.id FROM invoices i WHERE i.id = ? AND i.customer_id = ? AND ${VISIBLE_INV}`).get(id, customerId);
  if (!row) throw notFound('Invoice not found');
  const inv = invoicesService().getInvoice(id);
  if (!inv || (inv.customer_id != null && Number(inv.customer_id) !== customerId)) throw notFound('Invoice not found');
  const { created_by: _c, ...rest } = inv;
  return rest;
}

// ------------------------------------------------------------------ payments

function listPayments(customerId, pagination) {
  requireCustomer(customerId);
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM payments WHERE customer_id = ?').get(customerId);
  const items = db.prepare(`
    SELECT p.id, p.invoice_id, i.number AS invoice_number, p.method, p.amount, p.payment_date, p.reference, p.created_at
    FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.customer_id = ? AND i.customer_id = ?
    ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`).all(customerId, customerId, pagination.limit, pagination.offset);
  const { paid } = db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE customer_id = ?').get(customerId);
  return { ...paged(items, total, pagination), summary: { total_paid: round2(paid) } };
}

// ------------------------------------------------------------------ profile

const PROFILE_FIELDS = ['name', 'company_name', 'phone', 'billing_address', 'city', 'state', 'country', 'tax_id'];

function getProfile(customerId) {
  requireCustomer(customerId);
  const c = customers.getCustomer(customerId);
  if (!c) throw notFound('Customer profile not found');
  const { subscriptions: _s, invoices: _i, portal_user: _p, ...profile } = c;
  return profile;
}

function updateProfile(customerId, data) {
  requireCustomer(customerId);
  customers.updateCustomer(customerId, data, PROFILE_FIELDS);
  return getProfile(customerId);
}

module.exports = {
  PORTAL_ACTIONS,
  listSubscriptions,
  getSubscription,
  applyAction,
  listInvoices,
  getInvoice,
  listPayments,
  getProfile,
  updateProfile,
};
