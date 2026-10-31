'use strict';

const h = require('../catalog.helpers');

/**
 * Quotation template: { name, validity_days >= 1, plan_id, payment_term_id?, notes, is_active,
 *   lines: [{ product_id, variant_id?, description?, quantity >= 1 }] (at least one) }
 * Line errors are reported as `lines.<index>.<field>`.
 */
function validateTemplate(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 2, max: 120, label: 'Name' }),
    validity_days: h.number(body, 'validity_days', errors, { min: 1, max: 3650, integer: true, label: 'Validity', fallback: 30 }),
    plan_id: h.optionalId(body, 'plan_id', errors, { required: true, label: 'Plan' }),
    payment_term_id: h.optionalId(body, 'payment_term_id', errors, { label: 'Payment term' }),
    notes: h.text(body, 'notes', errors, { max: 2000, label: 'Notes' }),
    is_active: h.flag(body, 'is_active'),
    lines: [],
  };
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    errors.lines = 'Add at least one product line';
  } else {
    body.lines.forEach((raw, i) => {
      const row = raw && typeof raw === 'object' ? raw : {};
      const e = {};
      value.lines.push({
        product_id: h.optionalId(row, 'product_id', e, { required: true, label: 'Product' }),
        variant_id: h.optionalId(row, 'variant_id', e, { label: 'Variant' }),
        description: h.text(row, 'description', e, { max: 500, label: 'Description' }),
        quantity: h.number(row, 'quantity', e, { min: 1, max: 100000, integer: true, label: 'Quantity', fallback: 1 }),
      });
      for (const [k, msg] of Object.entries(e)) errors[`lines.${i}.${k}`] = msg;
    });
  }
  return { errors, value };
}

module.exports = { validateTemplate };
