'use strict';

// /api/admin: system overview, demo-data loader and CSV import. Admin only.

const express = require('express');
const ctrl = require('./admin.controller');
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/roles');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/overview', ctrl.overview);
router.get('/demo-data', ctrl.demoStatus);
router.post('/demo-data', ctrl.demoStart);
router.post('/import/customers', asyncHandler(ctrl.importCustomers));

module.exports = router;
