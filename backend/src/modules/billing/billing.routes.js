'use strict';

// /api/billing: billing run (admin + staff).

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal } = require('../../middleware/roles');
const asyncHandler = require('../../utils/asyncHandler');
const ctrl = require('./billing.controller');

const router = express.Router();
router.use(requireAuth, requireInternal);

router.get('/preview', asyncHandler(ctrl.preview));
router.post('/run', asyncHandler(ctrl.run));

module.exports = router;
