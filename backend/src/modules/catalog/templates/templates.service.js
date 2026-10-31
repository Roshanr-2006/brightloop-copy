'use strict';

// Quotation templates: a plan + product lines, valid for N days once sent.

const { db, transaction } = require('../../../db');
const { computeLine, round2 } = require('../../../utils/money');
const { unprocessable } = require('../../../utils/httpError');
const h = require('../catalog.helpers');
const catalog = require('../catalog.service');

const REFS = [['subscriptions', 'template_id']];

function list(query) {
  const where = [];
  const params = [];
  h.activeCondition(query, 'qt.is_active', where, params);
  h.searchCondition(query, ['qt.name', 'rp.name'], where, params);
  if (query.plan_id && Number(query.plan_id) > 0) {
    where.push('qt.plan_id = ?');
    params.push(Number(query.plan_id));
  }
  return h.listQuery({
    select: `qt.*, rp.name AS plan_name, rp.billing_period, rp.billing_interval, rp.is_active AS plan_active,
      pt.name AS payment_term_name,
      (SELECT COUNT(*) FROM quotation_template_lines l WHERE l.template_id = qt.id) AS line_count,
      (SELECT COALESCE(SUM(l.quantity * (p.sales_price + COALESCE(v.extra_price, 0))), 0)
         FROM quotation_template_lines l JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id
        WHERE l.template_id = qt.id) AS untaxed_amount,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.template_id = qt.id) AS subscription_count`,
    from: `quotation_templates qt
      JOIN recurring_plans rp ON rp.id = qt.plan_id
      LEFT JOIN payment_terms pt ON pt.id = qt.payment_term_id`,
    where,
    params,
    query,
    sortable: { name: 'qt.name', plan: 'rp.name', validity: 'qt.validity_days', created: 'qt.created_at' },
    defaultSort: 'qt.name',
    map: (r) => ({ ...r, untaxed_amount: round2(r.untaxed_amount) }),
  });
}

/** Template with priced lines (via catalog.getTemplate), per-line totals and a totals preview. */
function get(id) {
  const tpl = catalog.getTemplate(id);
  if (!tpl) h.findOr404('quotation_templates', id, 'Quotation template');
  const lines = tpl.lines.map((l) => {
    const c = computeLine({ quantity: l.quantity, unit_price: l.unit_price, taxes: l.taxes });
    return { ...l, subtotal: c.subtotal, tax_amount: c.tax_amount, total: c.total, tax_lines: c.taxes };
  });
  const term = tpl.payment_term_id ? catalog.getPaymentTerm(tpl.payment_term_id) : null;
  return {
    ...tpl,
    plan_name: tpl.plan ? tpl.plan.name : null,
    payment_term: term,
    payment_term_name: term ? term.name : null,
    lines,
    totals: {
      untaxed: round2(lines.reduce((s, l) => s + l.subtotal, 0)),
      tax: round2(lines.reduce((s, l) => s + l.tax_amount, 0)),
      total: round2(lines.reduce((s, l) => s + l.total, 0)),
    },
    usage: h.usage(REFS, tpl.id),
  };
}

/** Check plan / payment term / products / variants. `existing` = current template when updating. */
function checkRefs(v, existing = null) {
  const errors = {};
  const plan = catalog.getPlan(v.plan_id);
  if (!plan) errors.plan_id = 'Plan not found';
  else if (!plan.is_active && (!existing || existing.plan_id !== plan.id)) errors.plan_id = 'This plan is archived; choose an active plan';
  if (v.payment_term_id && !catalog.getPaymentTerm(v.payment_term_id)) errors.payment_term_id = 'Payment term not found';

  const currentProducts = new Set(existing
    ? db.prepare('SELECT product_id FROM quotation_template_lines WHERE template_id = ?').all(existing.id).map((r) => r.product_id)
    : []);
  const productStmt = db.prepare('SELECT id, is_active FROM products WHERE id = ?');
  const variantStmt = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?');
  v.lines.forEach((l, i) => {
    const p = productStmt.get(l.product_id);
    if (!p) errors[`lines.${i}.product_id`] = 'Product not found';
    else if (!p.is_active && !currentProducts.has(p.id)) errors[`lines.${i}.product_id`] = 'This product is archived';
    if (l.variant_id) {
      const variant = variantStmt.get(l.variant_id);
      if (!variant || variant.product_id !== l.product_id) errors[`lines.${i}.variant_id`] = 'This variant does not belong to the selected product';
    }
  });
  if (Object.keys(errors).length) throw unprocessable(errors);
}

function saveLines(templateId, lines) {
  db.prepare('DELETE FROM quotation_template_lines WHERE template_id = ?').run(templateId);
  const ins = db.prepare(`INSERT INTO quotation_template_lines (template_id, product_id, variant_id, description, quantity)
    VALUES (?, ?, ?, ?, ?)`);
  for (const l of lines) ins.run(templateId, l.product_id, l.variant_id, l.description, l.quantity);
}

function create(v) {
  checkRefs(v);
  h.assertUniqueName('quotation_templates', v.name, null, 'template');
  const id = transaction(() => {
    const info = db.prepare(`INSERT INTO quotation_templates (name, validity_days, plan_id, payment_term_id, notes, is_active)
      VALUES (?, ?, ?, ?, ?, ?)`).run(v.name, v.validity_days, v.plan_id, v.payment_term_id, v.notes, v.is_active ?? 1);
    const tplId = Number(info.lastInsertRowid);
    saveLines(tplId, v.lines);
    return tplId;
  });
  return get(id);
}

function update(id, v) {
  const tpl = h.findOr404('quotation_templates', id, 'Quotation template');
  checkRefs(v, tpl);
  h.assertUniqueName('quotation_templates', v.name, tpl.id, 'template');
  transaction(() => {
    db.prepare(`UPDATE quotation_templates SET name = ?, validity_days = ?, plan_id = ?, payment_term_id = ?, notes = ?,
      is_active = ? WHERE id = ?`).run(v.name, v.validity_days, v.plan_id, v.payment_term_id, v.notes,
      v.is_active ?? tpl.is_active, tpl.id);
    saveLines(tpl.id, v.lines);
  });
  return get(tpl.id);
}

function setActive(id, active) {
  const tpl = h.findOr404('quotation_templates', id, 'Quotation template');
  db.prepare('UPDATE quotation_templates SET is_active = ? WHERE id = ?').run(active ? 1 : 0, tpl.id);
  return get(tpl.id);
}

function remove(id) {
  const tpl = h.findOr404('quotation_templates', id, 'Quotation template');
  const used = h.usage(REFS, tpl.id);
  if (used.total > 0) throw h.inUseConflict('template', used);
  db.prepare('DELETE FROM quotation_templates WHERE id = ?').run(tpl.id);
}

module.exports = { list, get, create, update, setActive, remove };
