'use strict';

// /api/catalog/templates  (GET: admin + staff, writes: admin)
//   GET /?search=&active=&plan_id=&sort=name|plan|validity|created[:desc]
//   GET /:id   template + plan + lines (product/variant names, unit_price, taxes, line totals) + totals preview
//   POST / , PUT /:id  { name, validity_days, plan_id, payment_term_id, notes, lines: [...] } in one transaction
//   PATCH /:id/archive|restore, DELETE /:id (409 when used by subscriptions)

const { crudRouter } = require('../catalog.crud');
const ctrl = require('./templates.controller');
const { validateTemplate } = require('./templates.validators');

module.exports = crudRouter(ctrl, validateTemplate);
