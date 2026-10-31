'use strict';

const h = require('../catalog.helpers');

/**
 * Discount (admin only): { name, discount_type fixed|percent, value > 0 (percent <= 100),
 *   scope product|subscription, product_ids[] (required for product scope),
 *   subscription_ids[] (optional, subscription scope), min_purchase >= 0, min_quantity >= 0,
 *   start_date, end_date (end >= start), usage_limit (null = unlimited, else >= 1), is_active }
 * usage_count is read-only and ignored here.
 */
function validateDiscount(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 2, max: 80, label: 'Name' }),
    discount_type: h.oneOf(body, 'discount_type', errors, ['fixed', 'percent'], { label: 'Discount type' }),
    value: null,
    scope: h.oneOf(body, 'scope', errors, ['product', 'subscription'], { label: 'Scope', fallback: 'subscription' }),
    product_ids: h.idList(body, 'product_ids', errors, { label: 'Products' }),
    subscription_ids: h.idList(body, 'subscription_ids', errors, { label: 'Subscriptions' }),
    min_purchase: h.number(body, 'min_purchase', errors, { min: 0, label: 'Minimum purchase', fallback: 0 }),
    min_quantity: h.number(body, 'min_quantity', errors, { min: 0, max: 1000000, integer: true, label: 'Minimum quantity', fallback: 0 }),
    start_date: h.date(body, 'start_date', errors, { label: 'Start date' }),
    end_date: h.date(body, 'end_date', errors, { label: 'End date' }),
    usage_limit: h.number(body, 'usage_limit', errors, { min: 1, max: 100000000, integer: true, label: 'Usage limit', fallback: null }),
    is_active: h.flag(body, 'is_active'),
  };
  value.value = h.number(body, 'value', errors, { required: true, gt: 0, label: 'Value' });
  if (value.discount_type === 'percent' && errors.value === undefined && value.value > 100) {
    errors.value = 'A percentage discount cannot be more than 100';
  }
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    errors.end_date = 'End date cannot be before the start date';
  }
  if (value.scope === 'product') {
    if (!errors.product_ids && value.product_ids.length === 0) errors.product_ids = 'Choose at least one product';
    value.subscription_ids = [];
  } else {
    value.product_ids = [];
  }
  return { errors, value };
}

module.exports = { validateDiscount };
