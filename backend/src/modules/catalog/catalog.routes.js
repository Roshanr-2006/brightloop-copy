'use strict';

// /api/catalog  (owner: Roshan, module B)
// Everything here needs a logged-in internal user (admin or staff); customers get 403.
// Reads are open to admin + staff, every write is admin only (enforced in each sub-router).
// Discounts are admin only for reads too.

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal } = require('../../middleware/roles');

const router = express.Router();

router.use(requireAuth, requireInternal);

router.use('/products', require('./products/products.routes'));
router.use('/attributes', require('./products/attributes.routes'));
router.use('/plans', require('./plans/plans.routes'));
router.use('/templates', require('./templates/templates.routes'));
router.use('/taxes', require('./taxes/taxes.routes'));
router.use('/payment-terms', require('./payment-terms/payment-terms.routes'));

module.exports = router;
