'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal } = require('../../middleware/roles');
const asyncHandler = require('../../utils/asyncHandler');
const ctrl = require('./reports.controller');

const router = express.Router();

router.use(requireAuth, requireInternal);

router.get('/summary', asyncHandler(ctrl.summary));
router.get('/revenue', asyncHandler(ctrl.revenue));
router.get('/overdue', asyncHandler(ctrl.overdue));
router.get('/payments-by-method', asyncHandler(ctrl.paymentsByMethod));
router.get('/subscriptions-by-plan', asyncHandler(ctrl.subscriptionsByPlan));
router.get('/top-customers', asyncHandler(ctrl.topCustomers));

module.exports = router;
