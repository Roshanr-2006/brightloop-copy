'use strict';

// Shape validation for subscription payloads (business rules live in the service).

const { isValidDate } = require('../../utils/dates');

const isId = (v) => Number.isInteger(Number(v)) && Number(v) > 0 && v !== '' && v !== null && v !== true;
const optId = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function validateSubscription(body = {}) {
  const errors = {};
  const value = {};

  if (!isId(body.customer_id)) errors.customer_id = 'Customer is required';
  else value.customer_id = Number(body.customer_id);

  value.template_id = optId(body.template_id);
  if (value.template_id !== null && !isId(value.template_id)) errors.template_id = 'Invalid template';

  value.plan_id = optId(body.plan_id);
  if (value.plan_id === null && value.template_id === null) errors.plan_id = 'Plan is required';
  else if (value.plan_id !== null && !isId(value.plan_id)) errors.plan_id = 'Invalid plan';

  value.payment_term_id = optId(body.payment_term_id);
  if (value.payment_term_id !== null && !isId(value.payment_term_id)) errors.payment_term_id = 'Invalid payment term';

  if (!isValidDate(body.start_date)) errors.start_date = 'Start date is required (YYYY-MM-DD)';
  else value.start_date = body.start_date;

  if (body.expiry_date === undefined || body.expiry_date === null || body.expiry_date === '') {
    value.expiry_date = null;
  } else if (!isValidDate(body.expiry_date)) {
    errors.expiry_date = 'Invalid date (YYYY-MM-DD)';
  } else {
    value.expiry_date = body.expiry_date;
    if (value.start_date && value.expiry_date < value.start_date) {
      errors.expiry_date = 'Expiry date must be on or after the start date';
    }
  }

  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    errors.notes = 'Notes must be text';
  } else {
    value.notes = body.notes ? String(body.notes).trim().slice(0, 2000) || null : null;
  }

  const lines = body.lines;
  if (lines !== undefined && lines !== null && !Array.isArray(lines)) {
    errors.lines = 'Lines must be a list';
  } else if ((!lines || lines.length === 0) && value.template_id === null) {
    errors.lines = 'Add at least one product line';
  } else if (lines && lines.length > 200) {
    errors.lines = 'Too many lines (max 200)';
  } else {
    value.lines = (lines || []).map((l, i) => {
      const line = l && typeof l === 'object' ? l : {};
      const out = {};
      if (!isId(line.product_id)) errors[`lines.${i}.product_id`] = 'Product is required';
      else out.product_id = Number(line.product_id);
      out.variant_id = optId(line.variant_id);
      if (out.variant_id !== null && !isId(out.variant_id)) errors[`lines.${i}.variant_id`] = 'Invalid variant';
      const qty = Number(line.quantity ?? 1);
      if (!Number.isInteger(qty) || qty < 1) errors[`lines.${i}.quantity`] = 'Quantity must be a whole number of at least 1';
      else out.quantity = qty;
      if (line.unit_price === undefined || line.unit_price === null || line.unit_price === '') {
        out.unit_price = null;
      } else {
        const price = Number(line.unit_price);
        if (!Number.isFinite(price) || price < 0) errors[`lines.${i}.unit_price`] = 'Unit price must be 0 or more';
        else out.unit_price = price;
      }
      if (line.tax_ids === undefined || line.tax_ids === null) {
        out.tax_ids = null;
      } else if (!Array.isArray(line.tax_ids) || !line.tax_ids.every(isId)) {
        errors[`lines.${i}.tax_ids`] = 'Invalid taxes';
      } else {
        out.tax_ids = [...new Set(line.tax_ids.map(Number))];
      }
      out.description = line.description ? String(line.description).trim().slice(0, 500) || null : null;
      return out;
    });
  }

  return { errors, value };
}

function validateAction(body = {}) {
  const errors = {};
  const value = {};
  for (const key of ['note', 'reason']) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') errors[key] = 'Must be text';
    else value[key] = body[key] ? String(body[key]).trim().slice(0, 500) || null : null;
  }
  return { errors, value };
}

module.exports = { validateSubscription, validateAction };
