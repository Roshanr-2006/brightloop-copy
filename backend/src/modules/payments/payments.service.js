'use strict';

// Payments: the ONLY writer of invoices.amount_paid / paid_at and of the confirmed -> paid transition.

const { db, transaction } = require('../../db');
const { round2 } = require('../../utils/money');
const { isValidDate } = require('../../utils/dates');
const { notFound, conflict, unprocessable, HttpError } = require('../../utils/httpError');
const { likePattern } = require('../../utils/pagination');
const { PAYMENT_METHODS } = require('./payments.validators');

db.exec('CREATE INDEX IF NOT EXISTS idx_payments_date_method ON payments(payment_date, method)');

const SELECT_PAYMENT = `
  SELECT p.id, p.invoice_id, p.customer_id, p.method, p.amount, p.payment_date, p.reference, p.note,
         p.recorded_by, p.created_at,
         i.number AS invoice_number, i.status AS invoice_status, i.total_amount AS invoice_total,
         ROUND(i.total_amount - i.amount_paid, 2) AS invoice_balance,
         c.name AS customer_name, u.name AS recorded_by_name
  FROM payments p
  JOIN invoices i  ON i.id = p.invoice_id
  JOIN customers c ON c.id = p.customer_id
  LEFT JOIN users u ON u.id = p.recorded_by`;

function buildFilters(filters = {}) {
  const where = [];
  const params = [];
  if (filters.search) {
    const pattern = likePattern(String(filters.search).trim());
    where.push("(i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  if (filters.method && PAYMENT_METHODS.includes(filters.method)) {
    where.push('p.method = ?');
    params.push(filters.method);
  }
  const customerId = Number(filters.customerId);
  if (filters.customerId && Number.isInteger(customerId)) {
    where.push('p.customer_id = ?');
    params.push(customerId);
  }
  const invoiceId = Number(filters.invoiceId);
  if (filters.invoiceId && Number.isInteger(invoiceId)) {
    where.push('p.invoice_id = ?');
    params.push(invoiceId);
  }
  if (filters.from && isValidDate(filters.from)) {
    where.push('p.payment_date >= ?');
    params.push(filters.from);
  }
  if (filters.to && isValidDate(filters.to)) {
    where.push('p.payment_date <= ?');
    params.push(filters.to);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** Paged list. filters: search, method, customerId, invoiceId, from, to */
function listPayments(filters, { limit, offset }) {
  const { sql, params } = buildFilters(filters);
  const needsJoin = Boolean(filters && filters.search);
  const countSql = needsJoin
    ? `SELECT COUNT(*) AS total, COALESCE(SUM(p.amount), 0) AS amount FROM payments p
       JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = p.customer_id ${sql}`
    : `SELECT COUNT(*) AS total, COALESCE(SUM(p.amount), 0) AS amount FROM payments p ${sql}`;
  const { total, amount } = db.prepare(countSql).get(...params);
  const items = db
    .prepare(`${SELECT_PAYMENT} ${sql} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { items, total, total_amount: round2(amount) };
}

function getPayment(id) {
  return db.prepare(`${SELECT_PAYMENT} WHERE p.id = ?`).get(id) || null;
}

const nowIso = () => new Date().toISOString();

/** Record a payment against a confirmed invoice. Returns the created payment. */
function recordPayment(data, userId) {
  return transaction(() => {
    const invoice = db
      .prepare('SELECT id, customer_id, status, total_amount, amount_paid FROM invoices WHERE id = ?')
      .get(data.invoice_id);
    if (!invoice) throw new HttpError(404, 'Invoice not found', { invoice_id: 'Invoice not found' });
    if (invoice.status === 'draft') {
      throw new HttpError(422, 'Confirm the invoice before recording a payment', {
        invoice_id: 'Confirm the invoice before recording a payment',
      });
    }
    if (invoice.status === 'paid') throw conflict('This invoice is already fully paid');
    if (invoice.status === 'cancelled') throw conflict('Cannot record a payment on a cancelled invoice');

    const balance = round2(invoice.total_amount - invoice.amount_paid);
    const amount = round2(data.amount);
    if (amount > balance) {
      throw unprocessable({ amount: `Amount cannot exceed the balance due (${balance.toFixed(2)})` },
        'Payment is more than the balance due');
    }

    const info = db.prepare(`
      INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date, reference, note, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invoice.id, invoice.customer_id, data.method, amount, data.payment_date,
        data.reference ?? null, data.note ?? null, userId ?? null);

    const newPaid = round2(invoice.amount_paid + amount);
    const fullyPaid = round2(invoice.total_amount - newPaid) <= 0;
    const now = nowIso();
    db.prepare(`
      UPDATE invoices
      SET amount_paid = ?, status = ?, paid_at = ?, updated_at = ?
      WHERE id = ?`)
      .run(fullyPaid ? invoice.total_amount : newPaid, fullyPaid ? 'paid' : 'confirmed',
        fullyPaid ? now : null, now, invoice.id);

    return getPayment(Number(info.lastInsertRowid));
  });
}

/** Reverse (delete) a payment: restores the invoice balance; paid -> confirmed. */
function reversePayment(id) {
  return transaction(() => {
    const payment = db.prepare('SELECT id, invoice_id, amount FROM payments WHERE id = ?').get(id);
    if (!payment) throw notFound('Payment not found');
    const invoice = db.prepare('SELECT id, status, amount_paid FROM invoices WHERE id = ?').get(payment.invoice_id);
    if (invoice.status === 'cancelled') throw conflict('Cannot reverse a payment on a cancelled invoice');
    const newPaid = Math.max(0, round2(invoice.amount_paid - payment.amount));
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    db.prepare(`
      UPDATE invoices
      SET amount_paid = ?, status = CASE WHEN status = 'paid' THEN 'confirmed' ELSE status END,
          paid_at = NULL, updated_at = ?
      WHERE id = ?`).run(newPaid, nowIso(), invoice.id);
    const updated = db.prepare(`
      SELECT id, number, status, total_amount, amount_paid, ROUND(total_amount - amount_paid, 2) AS balance_due
      FROM invoices WHERE id = ?`).get(invoice.id);
    return { id: payment.id, reversed: true, invoice: updated };
  });
}

/** Payments of one invoice (used by invoice detail / portal if they want it). */
function listInvoicePayments(invoiceId) {
  return db.prepare(`${SELECT_PAYMENT} WHERE p.invoice_id = ? ORDER BY p.payment_date, p.id`).all(invoiceId);
}

module.exports = { listPayments, getPayment, recordPayment, reversePayment, listInvoicePayments, PAYMENT_METHODS };
