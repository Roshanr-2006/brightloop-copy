'use strict';

// /api/subscriptions (internal users: admin + staff). Customers use /api/portal.

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal } = require('../../middleware/roles');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { validateSubscription, validateAction } = require('./subscriptions.validators');
const ctrl = require('./subscriptions.controller');

const router = express.Router();
router.use(requireAuth, requireInternal);

router.get('/', asyncHandler(ctrl.list));
router.get('/from-template/:templateId(\\d+)', asyncHandler(ctrl.fromTemplate));
router.get('/:id(\\d+)', asyncHandler(ctrl.get));
router.post('/', validate(validateSubscription), asyncHandler(ctrl.create));
router.put('/:id(\\d+)', validate(validateSubscription), asyncHandler(ctrl.update));
router.delete('/:id(\\d+)', asyncHandler(ctrl.remove));
router.post('/:id(\\d+)/actions/:action', validate(validateAction), asyncHandler(ctrl.action));
router.post('/:id(\\d+)/invoice', asyncHandler(ctrl.invoiceNow));

module.exports = router;
