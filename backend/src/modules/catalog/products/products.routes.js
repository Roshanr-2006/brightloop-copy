'use strict';

// /api/catalog/products  (GET: admin + staff, writes: admin)
//   GET /?search=&type=&active=1|0|all&sort=name|price|type|created[:desc]&with=variants
//   GET /options      active products + active variants + active taxes (for pickers)
//   GET /:id          product with taxes and variants (final price = sales + extra)
//   POST / , PUT /:id  { ...product, tax_ids: [], variants: [] } saved in one transaction
//   PATCH /:id/archive | /:id/restore, DELETE /:id (409 when referenced)

const { crudRouter } = require('../catalog.crud');
const ctrl = require('./products.controller');
const { validateProduct } = require('./products.validators');

module.exports = crudRouter(ctrl, validateProduct, {
  extend: (router) => router.get('/options', ctrl.options),
});
