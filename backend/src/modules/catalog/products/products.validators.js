'use strict';

const h = require('../catalog.helpers');

const PRODUCT_TYPES = ['service', 'goods', 'addon'];

/**
 * Product: { name, type, sales_price, cost_price, notes, is_active,
 *            tax_ids: number[], variants: [{ id?, attribute_value_id, extra_price, is_active }] }
 * Variant errors are reported as `variants.<index>.<field>`.
 */
function validateProduct(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 2, max: 120, label: 'Name' }),
    type: h.oneOf(body, 'type', errors, PRODUCT_TYPES, { label: 'Type', fallback: 'service' }),
    sales_price: h.number(body, 'sales_price', errors, { required: true, min: 0, label: 'Sales price' }),
    cost_price: h.number(body, 'cost_price', errors, { min: 0, label: 'Cost price', fallback: 0 }),
    notes: h.text(body, 'notes', errors, { max: 2000, label: 'Notes' }),
    is_active: h.flag(body, 'is_active'),
    tax_ids: h.idList(body, 'tax_ids', errors, { label: 'Taxes' }),
    variants: [],
  };

  if (body.variants !== undefined && body.variants !== null) {
    if (!Array.isArray(body.variants)) {
      errors.variants = 'Variants must be a list';
    } else {
      const seen = new Set();
      body.variants.forEach((raw, i) => {
        const row = raw && typeof raw === 'object' ? raw : {};
        const e = {};
        const v = {
          id: h.optionalId(row, 'id', e, { label: 'Variant' }),
          attribute_value_id: h.optionalId(row, 'attribute_value_id', e, { required: true, label: 'Attribute value' }),
          extra_price: h.number(row, 'extra_price', e, { min: 0, label: 'Extra price', fallback: 0 }),
          is_active: h.flag(row, 'is_active', 1),
        };
        if (v.attribute_value_id && seen.has(v.attribute_value_id)) {
          e.attribute_value_id = 'This value is already used by another variant';
        }
        if (v.attribute_value_id) seen.add(v.attribute_value_id);
        for (const [k, msg] of Object.entries(e)) errors[`variants.${i}.${k}`] = msg;
        value.variants.push(v);
      });
    }
  }
  return { errors, value };
}

module.exports = { validateProduct, PRODUCT_TYPES };
