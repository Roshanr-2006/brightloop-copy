'use strict';

const h = require('../catalog.helpers');

/** Payment term: { name, due_days >= 0, is_active } */
function validatePaymentTerm(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 2, max: 60, label: 'Name' }),
    due_days: h.number(body, 'due_days', errors, { required: true, min: 0, max: 3650, integer: true, label: 'Due days' }),
    is_active: h.flag(body, 'is_active'),
  };
  return { errors, value };
}

module.exports = { validatePaymentTerm };
