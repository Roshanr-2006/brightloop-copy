'use strict';

// /api/catalog/discounts  (ADMIN ONLY for every endpoint, including reads)
//   GET /?search=&status=active|scheduled|expired|exhausted|inactive&scope=&active=&sort=
//   GET /:id   discount + products + subscriptions + usages (invoice numbers)
//   POST / , PUT /:id, PATCH /:id/archive|restore, DELETE /:id (409 once used on an invoice)

const { requireAdmin } = require('../../../middleware/roles');
const { crudRouter } = require('../catalog.crud');
const ctrl = require('./discounts.controller');
const { validateDiscount } = require('./discounts.validators');

module.exports = crudRouter(ctrl, validateDiscount, { readRole: requireAdmin });
