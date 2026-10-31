'use strict';

// Subscriptions (owner: Swathy, module C). All SQL and business rules live here.
// Shared contract (used by the portal and reports):
//   listSubscriptions(filters, pagination), getSubscription(id), applyAction(id, action, userId, { note })

const { db, transaction } = require('../../db');
const catalog = require('../catalog/catalog.service');
const { round2, computeLine } = require('../../utils/money');
const { today, addDays, addPeriod } = require('../../utils/dates');
const { nextNumber } = require('../../utils/sequence');
const { sendMail } = require('../../utils/mailer');
const { likePattern, sortBy } = require('../../utils/pagination');
const { HttpError, notFound, conflict, badRequest, unprocessable } = require('../../utils/httpError');

const STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];
const ACTIONS = ['send', 'confirm', 'activate', 'pause', 'resume', 'close', 'renew'];
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Prepared statements (reused)
// ---------------------------------------------------------------------------
const stmt = {
  detail: db.prepare(`
    SELECT s.*, c.name AS customer_name, c.email AS customer_email, c.company_name AS customer_company,
           p.name AS plan_name, pt.name AS payment_term_name, pt.due_days AS payment_term_due_days,
           qt.name AS template_name, u.name AS salesperson_name
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN recurring_plans p ON p.id = s.plan_id
    LEFT JOIN payment_terms pt ON pt.id = s.payment_term_id
    LEFT JOIN quotation_templates qt ON qt.id = s.template_id
    LEFT JOIN users u ON u.id = s.salesperson_id
    WHERE s.id = ?`),
  row: db.prepare('SELECT * FROM subscriptions WHERE id = ?'),
  lines: db.prepare(`
    SELECT l.*, pr.name AS product_name, pr.type AS product_type,
           av.name AS value_name, a.name AS attribute_name
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
    WHERE l.subscription_id = ?
    ORDER BY t.name`),
  history: db.prepare(`
    SELECT h.id, h.from_status, h.to_status, h.note, h.changed_at, h.changed_by, u.name AS changed_by_name
    FROM subscription_status_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.subscription_id = ?
    ORDER BY h.changed_at, h.id`),
  invoices: db.prepare(`
    SELECT id, number, status, invoice_date, due_date, period_start, period_end,
           untaxed_amount, tax_amount, total_amount, amount_paid,
           ROUND(total_amount - amount_paid, 2) AS balance_due,
           CASE WHEN status = 'confirmed' AND due_date < ? THEN 1 ELSE 0 END AS is_overdue
    FROM invoices WHERE subscription_id = ?
    ORDER BY period_start DESC, id DESC`),
  customer: db.prepare('SELECT id, name, email FROM customers WHERE id = ?'),
  product: db.prepare('SELECT id, name, type, is_active FROM products WHERE id = ?'),
  variant: db.prepare('SELECT id, product_id, is_active FROM product_variants WHERE id = ?'),
  tax: db.prepare('SELECT id, name, computation, amount, is_active FROM taxes WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO subscriptions
      (number, customer_id, plan_id, template_id, payment_term_id, salesperson_id, status,
       start_date, expiry_date, quotation_valid_until, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`),
  update: db.prepare(`
    UPDATE subscriptions SET customer_id = ?, plan_id = ?, template_id = ?, payment_term_id = ?,
      start_date = ?, expiry_date = ?, quotation_valid_until = ?, notes = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?`),
  deleteLines: db.prepare('DELETE FROM subscription_lines WHERE subscription_id = ?'),
  insertLine: db.prepare(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, description, quantity, unit_price, amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  insertLineTax: db.prepare('INSERT INTO subscription_line_taxes (line_id, tax_id) VALUES (?, ?)'),
  insertHistory: db.prepare(`
    INSERT INTO subscription_status_history (subscription_id, from_status, to_status, changed_by, note)
    VALUES (?, ?, ?, ?, ?)`),
  setStatus: db.prepare(`
    UPDATE subscriptions SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
  activate: db.prepare(`
    UPDATE subscriptions SET status = 'active', next_invoice_date = COALESCE(next_invoice_date, start_date),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
  close: db.prepare(`
    UPDATE subscriptions SET status = 'closed', closed_at = ?, close_reason = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
  renew: db.prepare(`
    UPDATE subscriptions SET expiry_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
  invoiceCount: db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE subscription_id = ?'),
  remove: db.prepare('DELETE FROM subscriptions WHERE id = ?'),
};

function variantLabel(attr, value) {
  if (!value) return null;
  return attr ? `${attr}: ${value}` : value;
}

function writeHistory(subscriptionId, from, to, userId, note) {
  stmt.insertHistory.run(subscriptionId, from, to, userId ?? null, note ?? null);
}

// ---------------------------------------------------------------------------
// Allowed actions for a subscription (used by the API and the UI buttons)
// ---------------------------------------------------------------------------
function allowedActions(sub, plan) {
  const out = [];
  const s = sub.status;
  if (s === 'draft') out.push('send');
  if (s === 'draft' || s === 'quotation') out.push('confirm');
  if (s === 'confirmed') out.push('activate');
  if (s === 'active' && plan.pausable) out.push('pause');
  if (s === 'paused' && plan.pausable) out.push('resume');
  if (['active', 'paused', 'confirmed'].includes(s) && plan.closable) out.push('close');
  if (s === 'active' && plan.renewable) out.push('renew');
  return out;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
const LIST_SORT = {
  number: 's.number',
  customer: 'c.name',
  plan: 'p.name',
  status: 's.status',
  start_date: 's.start_date',
  expiry_date: 's.expiry_date',
  next_invoice_date: 's.next_invoice_date',
  created: 's.id',
};

function buildWhere(filters = {}, { skipStatus = false } = {}) {
  const where = [];
  const params = [];
  if (!skipStatus && filters.status && STATUSES.includes(filters.status)) {
    where.push('s.status = ?');
    params.push(filters.status);
  }
  const customerId = filters.customerId ?? filters.customer_id;
  if (customerId) { where.push('s.customer_id = ?'); params.push(Number(customerId)); }
  const planId = filters.planId ?? filters.plan_id;
  if (planId) { where.push('s.plan_id = ?'); params.push(Number(planId)); }
  const expiring = filters.expiringBefore ?? filters.expiring_before;
  if (expiring) { where.push('s.expiry_date IS NOT NULL AND s.expiry_date <= ?'); params.push(String(expiring)); }
  if (filters.search && String(filters.search).trim()) {
    const pattern = likePattern(String(filters.search).trim());
    where.push("(s.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.company_name LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Paged subscriptions with customer/plan names and recurring totals.
 * filters: { search, status, customerId, planId, expiringBefore, sort }
 * pagination: { page, limit, offset }
 */
function listSubscriptions(filters = {}, { page = 1, limit = 20, offset } = {}) {
  const off = offset ?? (page - 1) * limit;
  const { sql, params } = buildWhere(filters);
  const order = filters.sort ? sortBy(filters.sort, LIST_SORT, 's.id') : 's.id DESC';
  const rows = db.prepare(`
    SELECT s.id, s.number, s.status, s.customer_id, s.plan_id, s.start_date, s.expiry_date,
           s.next_invoice_date, s.quotation_valid_until, s.created_at,
           c.name AS customer_name, p.name AS plan_name, p.billing_period, p.billing_interval,
           (SELECT COALESCE(SUM(l.amount), 0) FROM subscription_lines l WHERE l.subscription_id = s.id) AS recurring_amount,
           (SELECT COALESCE(SUM(CASE WHEN t.computation = 'percent' THEN l.amount * t.amount / 100.0
                                     ELSE t.amount * l.quantity END), 0)
              FROM subscription_lines l
              JOIN subscription_line_taxes lt ON lt.line_id = l.id
              JOIN taxes t ON t.id = lt.tax_id
             WHERE l.subscription_id = s.id) AS recurring_tax
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN recurring_plans p ON p.id = s.plan_id
    ${sql}
    ORDER BY ${order}, s.id DESC
    LIMIT ? OFFSET ?`).all(...params, limit, off);
  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM subscriptions s JOIN customers c ON c.id = s.customer_id ${sql}`).get(...params);
  const items = rows.map((r) => {
    const amount = round2(r.recurring_amount);
    const tax = round2(r.recurring_tax);
    return { ...r, recurring_amount: amount, recurring_tax: tax, recurring_total: round2(amount + tax) };
  });
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Counts per status for the same filters (status tabs). */
function statusCounts(filters = {}) {
  const { sql, params } = buildWhere(filters, { skipStatus: true });
  const rows = db.prepare(`
    SELECT s.status, COUNT(*) AS n FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    ${sql} GROUP BY s.status`).all(...params);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let all = 0;
  for (const r of rows) { counts[r.status] = r.n; all += r.n; }
  counts.all = all;
  return counts;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
function loadLines(subscriptionId) {
  const taxesByLine = new Map();
  for (const t of stmt.lineTaxes.all(subscriptionId)) {
    if (!taxesByLine.has(t.line_id)) taxesByLine.set(t.line_id, []);
    taxesByLine.get(t.line_id).push({ id: t.id, name: t.name, computation: t.computation, amount: Number(t.amount) });
  }
  return stmt.lines.all(subscriptionId).map((l) => {
    const taxes = taxesByLine.get(l.id) || [];
    const calc = computeLine({ quantity: l.quantity, unit_price: l.unit_price, taxes });
    return {
      id: l.id,
      product_id: l.product_id,
      variant_id: l.variant_id,
      description: l.description,
      quantity: l.quantity,
      unit_price: Number(l.unit_price),
      amount: Number(l.amount),
      product_name: l.product_name,
      product_type: l.product_type,
      variant_name: variantLabel(l.attribute_name, l.value_name),
      tax_ids: taxes.map((t) => t.id),
      taxes: calc.taxes,
      tax_amount: calc.tax_amount,
      total: calc.total,
    };
  });
}

/** Full subscription detail or null. */
function getSubscription(id) {
  const row = stmt.detail.get(Number(id));
  if (!row) return null;
  const plan = catalog.getPlan(row.plan_id);
  const lines = loadLines(row.id);
  const untaxed = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2(lines.reduce((s, l) => s + l.tax_amount, 0));
  const history = stmt.history.all(row.id).map((h) => ({ ...h }));
  const invoices = stmt.invoices.all(today(), row.id).map((i) => ({ ...i }));
  const sub = { ...row };
  return {
    ...sub,
    plan,
    lines,
    totals: { untaxed, tax, total: round2(untaxed + tax) },
    history,
    invoices,
    allowed_actions: allowedActions(sub, plan || {}),
  };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

/**
 * Resolve defaults (template, prices, taxes) and check business rules.
 * Returns { header, lines } ready to write, or throws 404/422.
 */
function prepare(input, { existing = null } = {}) {
  const fields = {};
  let template = null;
  const header = { ...input };
  let lines = input.lines || [];

  if (input.template_id) {
    template = catalog.getTemplate(input.template_id);
    if (!template || !template.is_active) {
      throw unprocessable({ template_id: 'Template not found or inactive' });
    }
    if (lines.length === 0) {
      lines = template.lines.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_ids: null,
      }));
      header.plan_id = header.plan_id || template.plan_id;
      header.payment_term_id = header.payment_term_id || template.payment_term_id;
      header.notes = header.notes || template.notes;
    }
    header.plan_id = header.plan_id || template.plan_id;
    const keepValidity = existing && existing.template_id === template.id && existing.quotation_valid_until;
    header.quotation_valid_until = keepValidity ? existing.quotation_valid_until : addDays(today(), template.validity_days);
  } else {
    header.quotation_valid_until = null;
  }
  if (lines.length === 0) fields.lines = 'Add at least one product line';

  if (!stmt.customer.get(header.customer_id)) fields.customer_id = 'Customer not found';

  const plan = header.plan_id ? catalog.getPlan(header.plan_id) : null;
  if (!plan) {
    fields.plan_id = 'Plan not found';
  } else if (!plan.is_active) {
    fields.plan_id = 'This plan is not active';
  } else if (header.start_date) {
    if (plan.start_date && header.start_date < plan.start_date) {
      fields.start_date = `Plan "${plan.name}" is only available from ${plan.start_date}`;
    } else if (plan.end_date && header.start_date > plan.end_date) {
      fields.start_date = `Plan "${plan.name}" was only available until ${plan.end_date}`;
    }
  }

  if (header.payment_term_id) {
    const term = catalog.getPaymentTerm(header.payment_term_id);
    if (!term) fields.payment_term_id = 'Payment term not found';
  }

  if (header.expiry_date && header.start_date && header.expiry_date < header.start_date) {
    fields.expiry_date = 'Expiry date must be on or after the start date';
  }

  const resolved = lines.map((l, i) => {
    const product = stmt.product.get(l.product_id);
    if (!product) { fields[`lines.${i}.product_id`] = 'Product not found'; return null; }
    if (!product.is_active) fields[`lines.${i}.product_id`] = `${product.name} is no longer sold`;
    if (l.variant_id) {
      const v = stmt.variant.get(l.variant_id);
      if (!v || v.product_id !== product.id) {
        fields[`lines.${i}.variant_id`] = 'This variant does not belong to the selected product';
        return null;
      }
    }
    // Add-ons (support, storage...) are exempt from the plan minimum; core products must meet it.
    if (plan && product.type !== 'addon' && l.quantity < plan.min_quantity) {
      fields[`lines.${i}.quantity`] = `Plan "${plan.name}" requires a minimum quantity of ${plan.min_quantity}`;
    }
    const unitPrice = l.unit_price === null || l.unit_price === undefined
      ? catalog.getPrice(product.id, l.variant_id)
      : round2(l.unit_price);
    let taxIds;
    if (l.tax_ids === null || l.tax_ids === undefined) {
      taxIds = catalog.getProductTaxes(product.id).map((t) => t.id);
    } else {
      taxIds = [];
      for (const tid of l.tax_ids) {
        const tax = stmt.tax.get(tid);
        if (!tax || !tax.is_active) fields[`lines.${i}.tax_ids`] = 'Unknown or inactive tax';
        else taxIds.push(tax.id);
      }
    }
    return {
      product_id: product.id,
      variant_id: l.variant_id || null,
      description: l.description || null,
      quantity: l.quantity,
      unit_price: unitPrice,
      amount: round2(l.quantity * unitPrice),
      tax_ids: taxIds,
    };
  });

  if (Object.keys(fields).length > 0) throw unprocessable(fields);
  return { header, lines: resolved, template, plan };
}

function writeLines(subscriptionId, lines) {
  for (const l of lines) {
    const info = stmt.insertLine.run(subscriptionId, l.product_id, l.variant_id, l.description, l.quantity, l.unit_price, l.amount);
    const lineId = Number(info.lastInsertRowid);
    for (const taxId of l.tax_ids) stmt.insertLineTax.run(lineId, taxId);
  }
}

/** Create a draft subscription. Returns the full detail. */
function createSubscription(input, userId) {
  const { header, lines, template } = prepare(input);
  const id = transaction(() => {
    const number = nextNumber('subscription');
    const info = stmt.insert.run(
      number, header.customer_id, header.plan_id, header.template_id || null, header.payment_term_id || null,
      userId ?? null, header.start_date, header.expiry_date || null, header.quotation_valid_until || null,
      header.notes || null, userId ?? null,
    );
    const subId = Number(info.lastInsertRowid);
    writeLines(subId, lines);
    writeHistory(subId, null, 'draft', userId, template ? `Created from template "${template.name}"` : 'Created');
    return subId;
  });
  return getSubscription(id);
}

/** Update header + replace lines (draft or quotation only). */
function updateSubscription(id, input, userId) {
  const existing = stmt.row.get(Number(id));
  if (!existing) throw notFound('Subscription not found');
  if (!['draft', 'quotation'].includes(existing.status)) {
    throw conflict(`A ${existing.status} subscription can no longer be edited`);
  }
  const { header, lines } = prepare(input, { existing });
  transaction(() => {
    stmt.update.run(
      header.customer_id, header.plan_id, header.template_id || null, header.payment_term_id || null,
      header.start_date, header.expiry_date || null, header.quotation_valid_until || null, header.notes || null,
      existing.id,
    );
    stmt.deleteLines.run(existing.id);
    writeLines(existing.id, lines);
    void userId;
  });
  return getSubscription(existing.id);
}

/** Delete a draft subscription. */
function deleteSubscription(id) {
  const existing = stmt.row.get(Number(id));
  if (!existing) throw notFound('Subscription not found');
  if (existing.status !== 'draft') throw conflict('Only draft subscriptions can be deleted');
  if (stmt.invoiceCount.get(existing.id).n > 0) throw conflict('This subscription has invoices and cannot be deleted');
  stmt.remove.run(existing.id);
}

/** Prefilled draft payload from a template (for the form). */
function draftFromTemplate(templateId) {
  const tpl = catalog.getTemplate(templateId);
  if (!tpl || !tpl.is_active) throw notFound('Template not found');
  const start = today();
  return {
    template_id: tpl.id,
    template_name: tpl.name,
    plan_id: tpl.plan_id,
    plan: tpl.plan,
    payment_term_id: tpl.payment_term_id,
    notes: tpl.notes,
    start_date: start,
    expiry_date: null,
    quotation_valid_until: addDays(start, tpl.validity_days),
    lines: tpl.lines.map((l) => {
      const calc = computeLine({ quantity: l.quantity, unit_price: l.unit_price, taxes: l.taxes });
      return {
        product_id: l.product_id,
        variant_id: l.variant_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        product_name: l.product_name,
        variant_name: l.variant_name,
        tax_ids: l.taxes.map((t) => t.id),
        taxes: calc.taxes,
        amount: calc.subtotal,
        tax_amount: calc.tax_amount,
        total: calc.total,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------
function quotationMail(sub) {
  const rows = sub.lines.map((l) => `  - ${l.product_name}${l.variant_name ? ` (${l.variant_name})` : ''} x${l.quantity} @ ${l.unit_price.toFixed(2)} = ${l.amount.toFixed(2)}`);
  const link = `${appUrl()}/portal/subscriptions/${sub.id}`;
  const text = [
    `Dear ${sub.customer_name},`,
    '',
    `Please find your quotation ${sub.number} for the plan "${sub.plan_name}".`,
    '',
    ...rows,
    '',
    `Untaxed: INR ${sub.totals.untaxed.toFixed(2)}`,
    `Taxes:   INR ${sub.totals.tax.toFixed(2)}`,
    `Total:   INR ${sub.totals.total.toFixed(2)} per billing period`,
    sub.quotation_valid_until ? `Valid until: ${sub.quotation_valid_until}` : '',
    '',
    `View it online: ${link}`,
    '',
    'Regards,',
    'Brightloop Software',
  ].join('\n');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<p>Dear ${esc(sub.customer_name)},</p>
<p>Please find your quotation <strong>${esc(sub.number)}</strong> for the plan "${esc(sub.plan_name)}".</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr>
${sub.lines.map((l) => `<tr><td>${esc(l.product_name)}${l.variant_name ? ` (${esc(l.variant_name)})` : ''}</td><td>${l.quantity}</td><td>${l.unit_price.toFixed(2)}</td><td>${l.amount.toFixed(2)}</td></tr>`).join('\n')}
</table>
<p>Untaxed: INR ${sub.totals.untaxed.toFixed(2)}<br>Taxes: INR ${sub.totals.tax.toFixed(2)}<br><strong>Total: INR ${sub.totals.total.toFixed(2)}</strong> per billing period</p>
${sub.quotation_valid_until ? `<p>Valid until ${esc(sub.quotation_valid_until)}</p>` : ''}
<p><a href="${esc(link)}">View your quotation</a></p><p>Regards,<br>Brightloop Software</p>`;
  return { to: sub.customer_email, subject: `Quotation ${sub.number} from Brightloop`, text, html };
}

/**
 * Apply a lifecycle action. Synchronous (emails are sent in the background).
 * Throws 400 for unknown actions, 404 when missing, 409 when the action is not allowed.
 * Returns the updated subscription detail.
 */
function applyAction(id, action, userId, { note = null, reason = null } = {}) {
  if (!ACTIONS.includes(action)) throw badRequest(`Unknown action "${action}"`);
  const sub = stmt.row.get(Number(id));
  if (!sub) throw notFound('Subscription not found');
  const plan = catalog.getPlan(sub.plan_id) || {};
  const from = sub.status;
  const deny = (msg) => { throw conflict(msg); };

  transaction(() => {
    switch (action) {
      case 'send':
        if (from !== 'draft') deny(`Only a draft can be sent as a quotation (current status: ${from})`);
        stmt.setStatus.run('quotation', sub.id);
        writeHistory(sub.id, from, 'quotation', userId, note || 'Quotation sent to customer');
        break;
      case 'confirm':
        if (!['draft', 'quotation'].includes(from)) deny(`A ${from} subscription cannot be confirmed`);
        if (sub.quotation_valid_until && sub.quotation_valid_until < today()) {
          deny(`The quotation expired on ${sub.quotation_valid_until}; update it before confirming`);
        }
        stmt.setStatus.run('confirmed', sub.id);
        writeHistory(sub.id, from, 'confirmed', userId, note);
        break;
      case 'activate':
        if (from !== 'confirmed') deny(`Only a confirmed subscription can be activated (current status: ${from})`);
        stmt.activate.run(sub.id);
        writeHistory(sub.id, from, 'active', userId, note);
        break;
      case 'pause':
        if (!plan.pausable) deny(`Plan "${plan.name}" does not allow pausing`);
        if (from !== 'active') deny(`Only an active subscription can be paused (current status: ${from})`);
        stmt.setStatus.run('paused', sub.id);
        writeHistory(sub.id, from, 'paused', userId, note || reason);
        break;
      case 'resume':
        if (!plan.pausable) deny(`Plan "${plan.name}" does not allow pausing`);
        if (from !== 'paused') deny(`Only a paused subscription can be resumed (current status: ${from})`);
        stmt.setStatus.run('active', sub.id);
        writeHistory(sub.id, from, 'active', userId, note || 'Resumed');
        break;
      case 'close':
        if (!plan.closable) deny(`Plan "${plan.name}" cannot be closed early`);
        if (!['active', 'paused', 'confirmed'].includes(from)) deny(`A ${from} subscription cannot be closed`);
        stmt.close.run(nowIso(), reason || note || null, sub.id);
        writeHistory(sub.id, from, 'closed', userId, reason || note || 'Closed');
        break;
      case 'renew': {
        if (!plan.renewable) deny(`Plan "${plan.name}" is not renewable`);
        if (from !== 'active') deny(`Only an active subscription can be renewed (current status: ${from})`);
        const base = sub.expiry_date || (sub.start_date > today() ? sub.start_date : today());
        const newExpiry = addPeriod(base, plan.billing_period, plan.billing_interval);
        stmt.renew.run(newExpiry, sub.id);
        writeHistory(sub.id, from, from, userId, note || `Renewed until ${newExpiry}`);
        break;
      }
      default:
        throw new HttpError(400, 'Unknown action');
    }
  });

  const detail = getSubscription(sub.id);
  if (action === 'send' && detail.customer_email) {
    sendMail(quotationMail(detail)).catch((err) => console.error('[mail] quotation failed', err.message));
  }
  return detail;
}

module.exports = {
  STATUSES,
  ACTIONS,
  allowedActions,
  listSubscriptions,
  statusCounts,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  draftFromTemplate,
  applyAction,
};
