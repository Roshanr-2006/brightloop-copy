'use strict';

// Invoices (owner: Swathy, module C).
// Shared contract (portal, payments, reports):
//   listInvoices(filters, pagination), getInvoice(id)
// Payments (module D) is the only writer of amount_paid / paid_at / 'paid'.

const { db, transaction } = require('../../db');
const { round2 } = require('../../utils/money');
const { today } = require('../../utils/dates');
const { sendMail } = require('../../utils/mailer');
const { likePattern, sortBy } = require('../../utils/pagination');
const { notFound, conflict } = require('../../utils/httpError');

const STATUSES = ['draft', 'confirmed', 'paid', 'cancelled'];
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';

const stmt = {
  detail: db.prepare(`
    SELECT i.*, s.number AS subscription_number, p.name AS plan_name,
           c.name AS customer_name, u.name AS created_by_name
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    LEFT JOIN subscriptions s ON s.id = i.subscription_id
    LEFT JOIN recurring_plans p ON p.id = s.plan_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.id = ?`),
  row: db.prepare('SELECT * FROM invoices WHERE id = ?'),
  customer: db.prepare(`
    SELECT id, name, company_name, email, phone, billing_address, city, state, country, tax_id
    FROM customers WHERE id = ?`),
  lines: db.prepare(`
    SELECT l.*, pr.name AS product_name
    FROM invoice_lines l LEFT JOIN products pr ON pr.id = l.product_id
    WHERE l.invoice_id = ? ORDER BY l.id`),
  lineTaxes: db.prepare(`
    SELECT lt.line_id, lt.tax_id, lt.tax_name, lt.rate, lt.amount
    FROM invoice_line_taxes lt JOIN invoice_lines l ON l.id = lt.line_id
    WHERE l.invoice_id = ? ORDER BY lt.tax_name`),
  discounts: db.prepare(`
    SELECT du.id, du.discount_id, d.name, d.discount_type, d.value, d.scope, du.amount
    FROM discount_usages du JOIN discounts d ON d.id = du.discount_id
    WHERE du.invoice_id = ? ORDER BY du.id`),
  payments: db.prepare(`
    SELECT pm.id, pm.method, pm.amount, pm.payment_date, pm.reference, pm.note, pm.created_at,
           pm.recorded_by, u.name AS recorded_by_name
    FROM payments pm LEFT JOIN users u ON u.id = pm.recorded_by
    WHERE pm.invoice_id = ? ORDER BY pm.payment_date, pm.id`),
  paymentCount: db.prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?'),
  confirm: db.prepare(`
    UPDATE invoices SET status = 'confirmed', confirmed_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND status = 'draft'`),
  cancel: db.prepare(`
    UPDATE invoices SET status = 'cancelled', cancelled_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND status IN ('draft', 'confirmed') AND amount_paid = 0`),
  usages: db.prepare('SELECT discount_id FROM discount_usages WHERE invoice_id = ?'),
  releaseUsage: db.prepare('UPDATE discounts SET usage_count = usage_count - 1 WHERE id = ? AND usage_count > 0'),
  deleteUsages: db.prepare('DELETE FROM discount_usages WHERE invoice_id = ?'),
  rewind: db.prepare(`
    UPDATE subscriptions SET next_invoice_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND (next_invoice_date IS NULL OR next_invoice_date > ?)`),
  sent: db.prepare(`
    UPDATE invoices SET sent_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
const LIST_SORT = {
  number: 'i.number',
  customer: 'c.name',
  invoice_date: 'i.invoice_date',
  due_date: 'i.due_date',
  total: 'i.total_amount',
  status: 'i.status',
};

function buildWhere(filters = {}, now, { skipStatus = false } = {}) {
  const where = [];
  const params = [];
  const overdue = filters.overdue === true || filters.overdue === 1 || filters.overdue === '1' || filters.overdue === 'true';
  if (!skipStatus) {
    if (overdue || filters.status === 'overdue') {
      where.push("i.status = 'confirmed' AND i.due_date < ?");
      params.push(now);
    } else if (filters.status && STATUSES.includes(filters.status)) {
      where.push('i.status = ?');
      params.push(filters.status);
    }
  }
  const customerId = filters.customerId ?? filters.customer_id;
  if (customerId) { where.push('i.customer_id = ?'); params.push(Number(customerId)); }
  const subscriptionId = filters.subscriptionId ?? filters.subscription_id;
  if (subscriptionId) { where.push('i.subscription_id = ?'); params.push(Number(subscriptionId)); }
  if (filters.from) { where.push('i.invoice_date >= ?'); params.push(String(filters.from)); }
  if (filters.to) { where.push('i.invoice_date <= ?'); params.push(String(filters.to)); }
  if (filters.search && String(filters.search).trim()) {
    const pattern = likePattern(String(filters.search).trim());
    where.push("(i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.company_name LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Paged invoices with balance_due and is_overdue.
 * filters: { search, status ('overdue' allowed), customerId, subscriptionId, overdue, from, to, sort }
 */
function listInvoices(filters = {}, { page = 1, limit = 20, offset } = {}) {
  const now = today();
  const off = offset ?? (page - 1) * limit;
  const { sql, params } = buildWhere(filters, now);
  const order = filters.sort ? sortBy(filters.sort, LIST_SORT, 'i.id') : 'i.invoice_date DESC';
  const rows = db.prepare(`
    SELECT i.id, i.number, i.status, i.subscription_id, i.customer_id, i.invoice_date, i.due_date,
           i.period_start, i.period_end, i.untaxed_amount, i.discount_amount, i.tax_amount,
           i.total_amount, i.amount_paid, i.sent_at, i.confirmed_at, i.paid_at, i.cancelled_at,
           c.name AS customer_name, s.number AS subscription_number,
           ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
           CASE WHEN i.status = 'confirmed' AND i.due_date < ? THEN 1 ELSE 0 END AS is_overdue
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    LEFT JOIN subscriptions s ON s.id = i.subscription_id
    ${sql}
    ORDER BY ${order}, i.id DESC
    LIMIT ? OFFSET ?`).all(now, ...params, limit, off);
  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM invoices i JOIN customers c ON c.id = i.customer_id ${sql}`).get(...params);
  return { items: rows.map((r) => ({ ...r })), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Counts per status (+ overdue) for the same filters, for the status tabs. */
function statusCounts(filters = {}) {
  const now = today();
  const { sql, params } = buildWhere(filters, now, { skipStatus: true });
  const row = db.prepare(`
    SELECT COUNT(*) AS all_count,
           SUM(i.status = 'draft') AS draft, SUM(i.status = 'confirmed') AS confirmed,
           SUM(i.status = 'paid') AS paid, SUM(i.status = 'cancelled') AS cancelled,
           SUM(i.status = 'confirmed' AND i.due_date < ?) AS overdue
    FROM invoices i JOIN customers c ON c.id = i.customer_id ${sql}`).get(now, ...params);
  return {
    all: row.all_count || 0,
    draft: row.draft || 0,
    confirmed: row.confirmed || 0,
    paid: row.paid || 0,
    cancelled: row.cancelled || 0,
    overdue: row.overdue || 0,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
function getInvoice(id) {
  const row = stmt.detail.get(Number(id));
  if (!row) return null;
  const now = today();
  const taxesByLine = new Map();
  const breakdown = new Map();
  for (const t of stmt.lineTaxes.all(row.id)) {
    const tax = { tax_id: t.tax_id, name: t.tax_name, rate: Number(t.rate), amount: Number(t.amount) };
    if (!taxesByLine.has(t.line_id)) taxesByLine.set(t.line_id, []);
    taxesByLine.get(t.line_id).push(tax);
    const b = breakdown.get(t.tax_name) || { name: t.tax_name, rate: Number(t.rate), base: 0, amount: 0 };
    b.amount = round2(b.amount + Number(t.amount));
    breakdown.set(t.tax_name, b);
  }
  const lines = stmt.lines.all(row.id).map((l) => {
    const taxes = taxesByLine.get(l.id) || [];
    for (const t of taxes) {
      const b = breakdown.get(t.name);
      b.base = round2(b.base + Number(l.subtotal));
    }
    return { ...l, taxes };
  });
  const balance = round2(row.total_amount - row.amount_paid);
  const isOverdue = row.status === 'confirmed' && row.due_date < now ? 1 : 0;
  const daysOverdue = isOverdue
    ? Math.round((new Date(`${now}T00:00:00Z`) - new Date(`${row.due_date}T00:00:00Z`)) / 86400000)
    : 0;
  return {
    ...row,
    balance_due: balance,
    is_overdue: isOverdue,
    days_overdue: daysOverdue,
    customer: { ...stmt.customer.get(row.customer_id) },
    lines,
    tax_breakdown: [...breakdown.values()],
    discounts: stmt.discounts.all(row.id).map((d) => ({ ...d })),
    payments: stmt.payments.all(row.id).map((p) => ({ ...p })),
  };
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------
function load(id) {
  const inv = stmt.row.get(Number(id));
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

function confirmInvoice(id) {
  const inv = load(id);
  if (inv.status !== 'draft') throw conflict(`Only draft invoices can be confirmed (current status: ${inv.status})`);
  stmt.confirm.run(new Date().toISOString(), inv.id);
  return getInvoice(inv.id);
}

/**
 * Cancel a draft/confirmed invoice with nothing paid. Frees the period (unique index ignores
 * cancelled rows) and releases the discount usages it consumed.
 * options.rebill = true rewinds the subscription's next_invoice_date so the next run bills it again.
 */
function cancelInvoice(id, { rebill = false } = {}) {
  const inv = load(id);
  if (!['draft', 'confirmed'].includes(inv.status)) {
    throw conflict(`A ${inv.status} invoice cannot be cancelled`);
  }
  if (Number(inv.amount_paid) > 0 || stmt.paymentCount.get(inv.id).n > 0) {
    throw conflict('This invoice has payments recorded; reverse them before cancelling');
  }
  transaction(() => {
    const info = stmt.cancel.run(new Date().toISOString(), inv.id);
    if (Number(info.changes) !== 1) throw conflict('The invoice changed meanwhile, please reload');
    for (const u of stmt.usages.all(inv.id)) stmt.releaseUsage.run(u.discount_id);
    stmt.deleteUsages.run(inv.id);
    if (rebill && inv.subscription_id && inv.period_start) {
      stmt.rewind.run(inv.period_start, inv.subscription_id, inv.period_start);
    }
  });
  return getInvoice(inv.id);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toFixed(2);

function invoiceMail(inv) {
  const link = `${appUrl()}/portal/invoices/${inv.id}`;
  const lines = inv.lines.map((l) => `  - ${l.description} x${l.quantity} @ ${money(l.unit_price)}${Number(l.discount_amount) ? ` (-${money(l.discount_amount)})` : ''} = ${money(l.subtotal)}`);
  const text = [
    `Dear ${inv.customer.name},`,
    '',
    `Please find your invoice ${inv.number} dated ${inv.invoice_date}${inv.period_start ? ` for the period ${inv.period_start} to ${inv.period_end}` : ''}.`,
    '',
    ...lines,
    '',
    `Untaxed:  INR ${money(inv.untaxed_amount)}`,
    Number(inv.discount_amount) ? `Discount: INR ${money(inv.discount_amount)}` : null,
    `Taxes:    INR ${money(inv.tax_amount)}`,
    `Total:    INR ${money(inv.total_amount)}`,
    `Balance due: INR ${money(inv.balance_due)} by ${inv.due_date}`,
    '',
    `View and print it online: ${link}`,
    '',
    'Regards,',
    'Brightloop Software',
  ].filter((x) => x !== null).join('\n');
  const html = `<p>Dear ${esc(inv.customer.name)},</p>
<p>Please find your invoice <strong>${esc(inv.number)}</strong> dated ${esc(inv.invoice_date)}${inv.period_start ? ` for the period ${esc(inv.period_start)} to ${esc(inv.period_end)}` : ''}.</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Subtotal</th><th>Tax</th><th>Total</th></tr>
${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${l.quantity}</td><td>${money(l.unit_price)}</td><td>${money(l.discount_amount)}</td><td>${money(l.subtotal)}</td><td>${money(l.tax_amount)}</td><td>${money(l.total)}</td></tr>`).join('\n')}
</table>
<p>Untaxed: INR ${money(inv.untaxed_amount)}<br>Taxes: INR ${money(inv.tax_amount)}<br><strong>Total: INR ${money(inv.total_amount)}</strong><br>Balance due: INR ${money(inv.balance_due)} by ${esc(inv.due_date)}</p>
<p><a href="${esc(link)}">View and print your invoice</a></p><p>Regards,<br>Brightloop Software</p>`;
  return { to: inv.customer.email, subject: `Invoice ${inv.number} from Brightloop`, text, html };
}

/** Email the invoice to the customer (confirmed or paid invoices only) and stamp sent_at. */
async function sendInvoice(id) {
  const inv = load(id);
  if (!['confirmed', 'paid'].includes(inv.status)) {
    throw conflict('Confirm the invoice before sending it');
  }
  const detail = getInvoice(inv.id);
  if (!detail.customer.email) throw conflict('The customer has no email address');
  await sendMail(invoiceMail(detail));
  stmt.sent.run(new Date().toISOString(), inv.id);
  return getInvoice(inv.id);
}

module.exports = {
  STATUSES,
  listInvoices,
  statusCounts,
  getInvoice,
  confirmInvoice,
  cancelInvoice,
  sendInvoice,
};
