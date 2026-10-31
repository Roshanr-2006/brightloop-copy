'use strict';

const h = require('../catalog.helpers');

/** Tax: { name, computation: percent|fixed, amount (percent <= 100), is_active } */
function validateTax(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 2, max: 60, label: 'Name' }),
    computation: h.oneOf(body, 'computation', errors, ['percent', 'fixed'], { label: 'Computation', fallback: 'percent' }),
    amount: null,
    is_active: h.flag(body, 'is_active'),
  };
  value.amount = h.number(body, 'amount', errors, {
    required: true, min: 0, max: value.computation === 'percent' ? 100 : undefined, label: 'Amount',
  });
  if (value.computation === 'percent' && errors.amount === undefined && value.amount > 100) {
    errors.amount = 'A percentage tax cannot be more than 100';
  }
  return { errors, value };
}

module.exports = { validateTax };
