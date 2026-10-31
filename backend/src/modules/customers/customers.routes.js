'use strict';

// /api/customers (owner: Sachin). Internal users only (admin + staff).

const express = require('express');
const ctrl = require('./customers.controller');
const { validateCustomer, validatePortalAccess } = require('./customers.validators');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireInternal } = require('../../middleware/roles');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth, requireInternal);

router.get('/', ctrl.list);
router.post('/', validate(validateCustomer), ctrl.create);
router.get('/:id', ctrl.get);
router.put('/:id', validate(validateCustomer), ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/portal-access', validate(validatePortalAccess), asyncHandler(ctrl.portalAccess));

module.exports = router;
