'use strict';

// /api/catalog/taxes  (GET: admin + staff, writes: admin)
const { crudRouter } = require('../catalog.crud');
const ctrl = require('./taxes.controller');
const { validateTax } = require('./taxes.validators');

module.exports = crudRouter(ctrl, validateTax);
