'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal, requireAdmin } = require('../../middleware/roles');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const ctrl = require('./payments.controller');
const { validatePayment } = require('./payments.validators');

const router = express.Router();

router.use(requireAuth, requireInternal);

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate(validatePayment), asyncHandler(ctrl.create));
router.get('/:id(\\d+)', asyncHandler(ctrl.get));
router.delete('/:id(\\d+)', requireAdmin, asyncHandler(ctrl.remove));

module.exports = router;
