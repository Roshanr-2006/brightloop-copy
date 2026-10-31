'use strict';

const h = require('../catalog.helpers');

const BILLING_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];

/**
 * Recurring plan: { name, price, billing_period, billing_interval >= 1, min_quantity >= 1,
 *   start_date, end_date (end >= start), auto_close, closable, pausable, renewable, is_active }
 */
function validatePlan(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 2, max: 80, label: 'Name' }),
    price: h.number(body, 'price', errors, { required: true, min: 0, label: 'Price' }),
    billing_period: h.oneOf(body, 'billing_period', errors, BILLING_PERIODS, { label: 'Billing period' }),
    billing_interval: h.number(body, 'billing_interval', errors, { min: 1, max: 365, integer: true, label: 'Interval', fallback: 1 }),
    min_quantity: h.number(body, 'min_quantity', errors, { min: 1, max: 100000, integer: true, label: 'Minimum quantity', fallback: 1 }),
    start_date: h.date(body, 'start_date', errors, { label: 'Start date' }),
    end_date: h.date(body, 'end_date', errors, { label: 'End date' }),
    auto_close: h.flag(body, 'auto_close', 0),
    closable: h.flag(body, 'closable', 1),
    pausable: h.flag(body, 'pausable', 0),
    renewable: h.flag(body, 'renewable', 1),
    is_active: h.flag(body, 'is_active'),
  };
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    errors.end_date = 'End date cannot be before the start date';
  }
  return { errors, value };
}

module.exports = { validatePlan, BILLING_PERIODS };
