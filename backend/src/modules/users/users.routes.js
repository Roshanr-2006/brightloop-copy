'use strict';

// /api/users (owner: Sachin). Admin only: only an admin can add or change staff.

const express = require('express');
const ctrl = require('./users.controller');
const { validateCreateUser, validateUpdateUser } = require('./users.validators');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/roles');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', ctrl.list);
router.post('/', validate(validateCreateUser), ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', validate(validateUpdateUser), ctrl.update);

module.exports = router;
