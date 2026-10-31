'use strict';

// /api/catalog/payment-terms  (GET: admin + staff, writes: admin)
const { crudRouter } = require('../catalog.crud');
const ctrl = require('./payment-terms.controller');
const { validatePaymentTerm } = require('./payment-terms.validators');

module.exports = crudRouter(ctrl, validatePaymentTerm);
