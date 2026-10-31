'use strict';

// /api/invoices (admin + staff). Customers read their invoices through /api/portal.

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal } = require('../../middleware/roles');
const asyncHandler = require('../../utils/asyncHandler');
const ctrl = require('./invoices.controller');

const router = express.Router();
router.use(requireAuth, requireInternal);

router.get('/', asyncHandler(ctrl.list));
router.get('/:id(\\d+)', asyncHandler(ctrl.get));
router.post('/:id(\\d+)/confirm', asyncHandler(ctrl.confirm));
router.post('/:id(\\d+)/cancel', asyncHandler(ctrl.cancel));
router.post('/:id(\\d+)/send', asyncHandler(ctrl.send));

module.exports = router;
