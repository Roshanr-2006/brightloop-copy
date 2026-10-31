'use strict';

// =====================================================================
// Catalog shared contract (owner: Roshan, module B)
// ---------------------------------------------------------------------
// Used by subscriptions / invoices / billing (Swathy). Keep the function
// names and return shapes stable; tell the team before changing them.
//
//   const catalog = require('../catalog/catalog.service');
//   catalog.getPrice(productId, variantId)          -> 1760
//   catalog.getProductTaxes(productId)              -> [{ id, name, computation, amount }]
//   catalog.getPlan(planId)                         -> plan row | null
//   catalog.getTemplate(templateId)                 -> template with priced lines | null
//   catalog.getPaymentTerm(id)                      -> { id, name, due_days } | null
//   catalog.getApplicableDiscounts({ subscriptionId, lines, date })
//   catalog.recordDiscountUsage(discountId, invoiceId, amount) -> true | false
// =====================================================================

const { db, transaction } = require('../../db');
const { round2 } = require('../../utils/money');
const { today } = require('../../utils/dates');
const { notFound, unprocessable } = require('../../utils/httpError');

const plain = (row) => (row ? { ...row } : null);
const toId = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Unit price of a product, optionally with a variant.
 * Price = products.sales_price + product_variants.extra_price.
 * Example: Brightloop CRM (1200) with Brand = Odoo (+560) -> 1760.
 *
 * @param {number} productId
 * @param {number|null} [variantId] variant of that product (optional)
 * @returns {number} price rounded to 2 decimals
 * @throws {HttpError} 404 if the product does not exist,
 *                     422 if the variant does not exist or belongs to another product
 */
function getPrice(productId, variantId) {
  const product = db.prepare('SELECT id, sales_price FROM products WHERE id = ?').get(toId(productId));
  if (!product) throw notFound('Product not found');
  let extra = 0;
  const vId = toId(variantId);
  if (vId) {
    const variant = db.prepare('SELECT product_id, extra_price FROM product_variants WHERE id = ?').get(vId);
    if (!variant || variant.product_id !== product.id) {
      throw unprocessable({ variant_id: 'This variant does not belong to the selected product' });
    }
    extra = Number(variant.extra_price);
  }
  return round2(Number(product.sales_price) + extra);
}

/**
 * Default taxes of a product (only active taxes), ordered by name.
 *
 * @param {number} productId
 * @returns {Array<{id:number, name:string, computation:'percent'|'fixed', amount:number}>}
 */
function getProductTaxes(productId) {
  return db.prepare(`
    SELECT t.id, t.name, t.computation, t.amount
    FROM product_taxes pt
    JOIN taxes t ON t.id = pt.tax_id
    WHERE pt.product_id = ? AND t.is_active = 1
    ORDER BY t.name`).all(toId(productId)).map(plain);
}

/**
 * A recurring plan row (all columns, including the lifecycle flags
 * auto_close / closable / pausable / renewable as 0/1 and is_active).
 *
 * @param {number} planId
 * @returns {object|null}
 */
function getPlan(planId) {
  return plain(db.prepare('SELECT * FROM recurring_plans WHERE id = ?').get(toId(planId)));
}

/**
 * Payment term by id.
 *
 * @param {number} id
 * @returns {{id:number, name:string, due_days:number}|null}
 */
function getPaymentTerm(id) {
  return plain(db.prepare('SELECT id, name, due_days FROM payment_terms WHERE id = ?').get(toId(id)));
}

/** Human-readable variant label, e.g. "Brand: Odoo". */
function variantLabel(attributeName, valueName) {
  if (!valueName) return null;
  return attributeName ? `${attributeName}: ${valueName}` : valueName;
}

/**
 * Quotation template with its plan and priced lines (ready to copy onto a subscription).
 *
 * @param {number} templateId
 * @returns {{
 *   id:number, name:string, validity_days:number, plan_id:number, plan:object|null,
 *   payment_term_id:number|null, notes:string|null, is_active:number,
 *   lines: Array<{ id:number, product_id:number, variant_id:number|null, description:string|null,
 *                  quantity:number, unit_price:number, product_name:string, variant_name:string|null,
 *                  taxes:Array<{id,name,computation,amount}> }>
 * }|null}
 */
function getTemplate(templateId) {
  const tpl = db.prepare(`
    SELECT id, name, validity_days, plan_id, payment_term_id, notes, is_active
    FROM quotation_templates WHERE id = ?`).get(toId(templateId));
  if (!tpl) return null;
  const rows = db.prepare(`
    SELECT l.id, l.product_id, l.variant_id, l.description, l.quantity,
           p.name AS product_name, p.sales_price,
           v.extra_price, av.name AS value_name, a.name AS attribute_name
    FROM quotation_template_lines l
    JOIN products p ON p.id = l.product_id
    LEFT JOIN product_variants v ON v.id = l.variant_id
    LEFT JOIN product_attribute_values av ON av.id = v.attribute_value_id
    LEFT JOIN product_attributes a ON a.id = av.attribute_id
    WHERE l.template_id = ?
    ORDER BY l.id`).all(tpl.id);
  const lines = rows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    variant_id: r.variant_id,
    description: r.description,
    quantity: r.quantity,
    unit_price: round2(Number(r.sales_price) + Number(r.extra_price || 0)),
    product_name: r.product_name,
    variant_name: variantLabel(r.attribute_name, r.value_name),
    taxes: getProductTaxes(r.product_id),
  }));
  return { ...plain(tpl), plan: getPlan(tpl.plan_id), lines };
}

/**
 * Discounts that apply right now to a set of lines.
 *
 * Rules (all must hold):
 *  - discount is_active = 1 and `date` is inside start_date/end_date (open ends allowed)
 *  - usage not exhausted (usage_limit IS NULL OR usage_count < usage_limit)
 *  - scope 'subscription': if discount_subscriptions has rows, subscriptionId must be one of them;
 *    min_purchase is compared with the sum of ALL line amounts, min_quantity with the sum of ALL quantities
 *  - scope 'product': at least one line's product is in discount_products; min_purchase / min_quantity
 *    are compared with the sums over the MATCHING lines only
 *
 * @param {{ subscriptionId?:number|null, lines:Array<{product_id:number, quantity:number, amount:number}>, date?:string }} input
 *        date defaults to today (YYYY-MM-DD)
 * @returns {Array<{id:number, name:string, discount_type:'fixed'|'percent', value:number,
 *                  scope:'product'|'subscription', productIds:number[]}>}
 *          productIds = the discount's product ids for product scope, [] for subscription scope
 */
function getApplicableDiscounts({ subscriptionId = null, lines = [], date } = {}) {
  const on = date || today();
  const candidates = db.prepare(`
    SELECT id, name, discount_type, value, scope, min_purchase, min_quantity
    FROM discounts
    WHERE is_active = 1
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
      AND (usage_limit IS NULL OR usage_count < usage_limit)
    ORDER BY id`).all(on, on);
  if (candidates.length === 0) return [];

  const productsOf = db.prepare('SELECT product_id FROM discount_products WHERE discount_id = ? ORDER BY product_id');
  const subsOf = db.prepare('SELECT subscription_id FROM discount_subscriptions WHERE discount_id = ?');
  const totals = (rows) => ({
    amount: round2(rows.reduce((s, l) => s + (Number(l.amount) || 0), 0)),
    quantity: rows.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
  });
  const subId = toId(subscriptionId);

  const result = [];
  for (const d of candidates) {
    let productIds = [];
    let scoped = lines;
    if (d.scope === 'product') {
      productIds = productsOf.all(d.id).map((r) => r.product_id);
      const set = new Set(productIds);
      scoped = lines.filter((l) => set.has(Number(l.product_id)));
      if (scoped.length === 0) continue;
    } else {
      const allowed = subsOf.all(d.id).map((r) => r.subscription_id);
      if (allowed.length > 0 && (subId === null || !allowed.includes(subId))) continue;
    }
    const sum = totals(scoped);
    if (sum.amount < Number(d.min_purchase)) continue;
    if (sum.quantity < Number(d.min_quantity)) continue;
    result.push({
      id: d.id,
      name: d.name,
      discount_type: d.discount_type,
      value: Number(d.value),
      scope: d.scope,
      productIds,
    });
  }
  return result;
}

/**
 * Record that a discount was applied to an invoice. Atomic and limit-safe:
 * increments usage_count only while it is below usage_limit, and inserts the
 * discount_usages row only when that increment succeeded.
 * Call it inside the invoice transaction (nested transaction() calls reuse the outer one).
 *
 * @param {number} discountId
 * @param {number} invoiceId
 * @param {number} amount discount amount applied on that invoice (>= 0)
 * @returns {boolean} true if recorded; false if the limit was already reached,
 *                    the discount does not exist, or it was already recorded for this invoice
 */
function recordDiscountUsage(discountId, invoiceId, amount) {
  return transaction(() => {
    const dId = toId(discountId);
    const iId = toId(invoiceId);
    const already = db.prepare('SELECT 1 FROM discount_usages WHERE discount_id = ? AND invoice_id = ?').get(dId, iId);
    if (already) return false;
    const info = db.prepare(`
      UPDATE discounts SET usage_count = usage_count + 1
      WHERE id = ? AND (usage_limit IS NULL OR usage_count < usage_limit)`).run(dId);
    if (Number(info.changes) !== 1) return false;
    db.prepare('INSERT INTO discount_usages (discount_id, invoice_id, amount) VALUES (?, ?, ?)')
      .run(dId, iId, round2(Math.max(0, Number(amount) || 0)));
    return true;
  });
}

module.exports = {
  getPrice,
  getProductTaxes,
  getPlan,
  getTemplate,
  getPaymentTerm,
  getApplicableDiscounts,
  recordDiscountUsage,
  variantLabel,
};
