'use strict';

// Customers (billing contacts) and their portal logins (owner: Sachin).

const crypto = require('node:crypto');
const { db, transaction } = require('../../db');
const { conflict, notFound } = require('../../utils/httpError');
const { paged, likePattern, sortBy } = require('../../utils/pagination');
const { today } = require('../../utils/dates');
const { round2 } = require('../../utils/money');
const auth = require('../auth/auth.service');

const nowIso = () => new Date().toISOString();

// Per-row aggregates use the customer_id indexes, so a page of 20 stays fast with thousands of rows.
const AGGREGATES = `
  (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active') AS active_subscriptions,
  (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id = c.id) AS subscription_count,
  COALESCE((SELECT ROUND(SUM(i.total_amount - i.amount_paid), 2) FROM invoices i
            WHERE i.customer_id = c.id AND i.status = 'confirmed'), 0) AS outstanding_balance,
  (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'confirmed' AND i.due_date < @today) AS overdue_invoices`;

const SORTS = {
  name: 'c.name COLLATE NOCASE',
  email: 'c.email',
  company: 'c.company_name COLLATE NOCASE',
  city: 'c.city COLLATE NOCASE',
  created: 'c.created_at',
  balance: 'outstanding_balance',
  active: 'active_subscriptions',
};

function toCustomer(row) {
  if (!row) return null;
  const { portal_active: portalActive, portal_last_login: lastLogin, ...rest } = row;
  return {
    ...rest,
    has_portal_access: Boolean(row.user_id),
    portal_user: row.user_id ? { id: row.user_id, is_active: Boolean(portalActive), last_login_at: lastLogin } : null,
  };
}

function listCustomers({ search, sort, portal } = {}, pagination) {
  const where = [];
  const params = { today: today() };
  if (search) {
    where.push(`(c.name LIKE @q ESCAPE '\\' OR c.email LIKE @q ESCAPE '\\' OR c.company_name LIKE @q ESCAPE '\\'
      OR c.phone LIKE @q ESCAPE '\\')`);
    params.q = likePattern(String(search).trim());
  }
  if (portal === '1' || portal === 'true') where.push('c.user_id IS NOT NULL');
  if (portal === '0' || portal === 'false') where.push('c.user_id IS NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countParams = { ...params };
  delete countParams.today;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM customers c ${whereSql}`).get(countParams);
  const items = db.prepare(`
    SELECT c.*, u.is_active AS portal_active, u.last_login_at AS portal_last_login, ${AGGREGATES}
    FROM customers c LEFT JOIN users u ON u.id = c.user_id
    ${whereSql}
    ORDER BY ${sortBy(sort, SORTS, SORTS.name)}, c.id
    LIMIT @limit OFFSET @offset`).all({ ...params, limit: pagination.limit, offset: pagination.offset });
  return paged(items.map(toCustomer), total, pagination);
}

function getCustomerRow(id) {
  return toCustomer(db.prepare(`
    SELECT c.*, u.is_active AS portal_active, u.last_login_at AS portal_last_login, ${AGGREGATES}
    FROM customers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = @id`).get({ id, today: today() }));
}

/** Customer with a short summary of subscriptions, invoices and money totals. */
function getCustomer(id) {
  const customer = getCustomerRow(id);
  if (!customer) return null;
  const t = today();
  const subscriptions = db.prepare(`
    SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date,
           p.name AS plan_name, p.billing_period, p.billing_interval,
           COALESCE((SELECT ROUND(SUM(l.amount), 2) FROM subscription_lines l WHERE l.subscription_id = s.id), 0) AS recurring_amount
    FROM subscriptions s JOIN recurring_plans p ON p.id = s.plan_id
    WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 50`).all(id);
  const invoices = db.prepare(`
    SELECT i.id, i.number, i.status, i.invoice_date, i.due_date, i.total_amount, i.amount_paid,
           ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
           CASE WHEN i.status = 'confirmed' AND i.due_date < ? THEN 1 ELSE 0 END AS is_overdue,
           s.number AS subscription_number, i.subscription_id
    FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
    WHERE i.customer_id = ? ORDER BY i.invoice_date DESC, i.id DESC LIMIT 50`).all(t, id)
    .map((r) => ({ ...r, is_overdue: Boolean(r.is_overdue) }));
  const money = db.prepare(`
    SELECT COUNT(*) AS invoice_count,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'paid') THEN total_amount END), 0) AS invoiced,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'paid') THEN amount_paid END), 0) AS paid,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total_amount - amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN status = 'confirmed' AND due_date < ? THEN total_amount - amount_paid END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_invoices
    FROM invoices WHERE customer_id = ?`).get(t, id);
  const subCounts = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
      COALESCE(SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END), 0) AS paused,
      COALESCE(SUM(CASE WHEN status IN ('draft', 'quotation', 'confirmed') THEN 1 ELSE 0 END), 0) AS pending
    FROM subscriptions WHERE customer_id = ?`).get(id);
  const mrr = db.prepare(`
    SELECT COALESCE(ROUND(SUM(l.amount), 2), 0) AS amount FROM subscription_lines l
    JOIN subscriptions s ON s.id = l.subscription_id WHERE s.customer_id = ? AND s.status = 'active'`).get(id).amount;
  return {
    ...customer,
    subscriptions,
    invoices,
    totals: {
      subscriptions: subCounts.total,
      active_subscriptions: subCounts.active,
      paused_subscriptions: subCounts.paused,
      pending_subscriptions: subCounts.pending,
      recurring_amount: round2(mrr),
      invoices: money.invoice_count,
      draft_invoices: money.draft_invoices,
      invoiced: round2(money.invoiced),
      paid: round2(money.paid),
      outstanding: round2(money.outstanding),
      overdue: round2(money.overdue),
    },
  };
}

function assertEmailFree(email, exceptCustomerId = null) {
  const row = db.prepare('SELECT id FROM customers WHERE email = ? COLLATE NOCASE').get(email);
  if (row && row.id !== exceptCustomerId) {
    throw conflict('A customer with this email already exists', { email: 'Another customer already uses this email' });
  }
}

const FIELDS = ['name', 'email', 'company_name', 'phone', 'billing_address', 'city', 'state', 'country', 'tax_id'];

function createCustomer(data) {
  const id = transaction(() => {
    assertEmailFree(data.email);
    const values = FIELDS.map((f) => data[f] ?? null);
    return Number(db.prepare(`INSERT INTO customers (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`)
      .run(...values).lastInsertRowid);
  });
  return getCustomerRow(id);
}

/** PUT semantics for the fields sent; keeps the linked login's name/email in sync. */
function updateCustomer(id, data, fields = FIELDS) {
  transaction(() => {
    const current = db.prepare('SELECT id, user_id, email FROM customers WHERE id = ?').get(id);
    if (!current) throw notFound('Customer not found');
    const keys = fields.filter((f) => data[f] !== undefined);
    if (data.email !== undefined && data.email.toLowerCase() !== current.email.toLowerCase()) {
      assertEmailFree(data.email, id);
      if (current.user_id) {
        const taken = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?').get(data.email, current.user_id);
        if (taken) throw conflict('This email is used by another login', { email: 'This email is already registered' });
      }
    }
    if (!keys.length) return;
    const now = nowIso();
    db.prepare(`UPDATE customers SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => data[k]), now, id);
    if (current.user_id && (data.name !== undefined || data.email !== undefined)) {
      const userSets = [];
      const params = [];
      if (data.name !== undefined) { userSets.push('name = ?'); params.push(data.name); }
      if (data.email !== undefined) { userSets.push('email = ?'); params.push(data.email); }
      db.prepare(`UPDATE users SET ${userSets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, now, current.user_id);
    }
  });
  return getCustomerRow(id);
}

function deleteCustomer(id) {
  transaction(() => {
    const row = db.prepare('SELECT id, user_id FROM customers WHERE id = ?').get(id);
    if (!row) throw notFound('Customer not found');
    const used = db.prepare(`SELECT
      (SELECT COUNT(*) FROM subscriptions WHERE customer_id = ?) AS subs,
      (SELECT COUNT(*) FROM invoices WHERE customer_id = ?) AS invs,
      (SELECT COUNT(*) FROM payments WHERE customer_id = ?) AS pays`).get(id, id, id);
    if (used.subs || used.invs || used.pays) {
      throw conflict('This customer has subscriptions or invoices and cannot be deleted. Close their subscriptions instead.');
    }
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    // Their portal login has nothing left to show, remove it as well.
    if (row.user_id) db.prepare("DELETE FROM users WHERE id = ? AND role = 'customer'").run(row.user_id);
  });
}

/**
 * Give a customer a portal login. With a password the login works right away; without one
 * an invitation email with a set-your-password link is sent.
 */
async function grantPortalAccess(id, { password }, createdBy) {
  const userId = transaction(() => {
    const c = db.prepare('SELECT id, user_id, name, email FROM customers WHERE id = ?').get(id);
    if (!c) throw notFound('Customer not found');
    if (c.user_id) throw conflict('This customer already has portal access');
    if (auth.emailTaken(c.email)) {
      throw conflict('A login with this email already exists', { email: 'This email is already registered' });
    }
    // Without a password the account gets an unguessable one until the invite is used.
    const hash = auth.hashPassword(password || crypto.randomBytes(24).toString('hex'));
    const uid = Number(db.prepare(
      "INSERT INTO users (name, email, password_hash, role, created_by) VALUES (?, ?, ?, 'customer', ?)",
    ).run(c.name, c.email, hash, createdBy).lastInsertRowid);
    db.prepare('UPDATE customers SET user_id = ?, updated_at = ? WHERE id = ?').run(uid, nowIso(), id);
    return uid;
  });
  let inviteUrl = null;
  if (!password) inviteUrl = await auth.sendInvite(userId);
  return { customer: getCustomerRow(id), user: auth.publicUser(userId), inviteSent: Boolean(inviteUrl), inviteUrl };
}

module.exports = {
  listCustomers,
  getCustomer,
  getCustomerRow,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  grantPortalAccess,
  FIELDS,
};
