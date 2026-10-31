'use strict';

// /api/catalog/plans  (GET: admin + staff, writes: admin)
//   GET /?search=&period=&active=&available=1&sort=name|price|period|subscriptions[:desc]
//       items include `available` (active + today within dates) and subscription counts
//   GET /options   active plans (with `available`) for pickers
//   GET /:id, POST /, PUT /:id, PATCH /:id/archive|restore, DELETE /:id (409 when referenced)

const { crudRouter } = require('../catalog.crud');
const ctrl = require('./plans.controller');
const { validatePlan } = require('./plans.validators');

module.exports = crudRouter(ctrl, validatePlan, {
  extend: (router) => router.get('/options', ctrl.options),
});
