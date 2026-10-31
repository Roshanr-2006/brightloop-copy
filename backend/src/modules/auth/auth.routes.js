'use strict';

// /api/auth (owner: Sachin)

const express = require('express');
const ctrl = require('./auth.controller');
const v = require('./auth.validators');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const rateLimit = require('./rateLimit');

const router = express.Router();

const loginLimit = rateLimit({ name: 'login', max: 10 });
const forgotLimit = rateLimit({ name: 'forgot', max: 10 });
const signupLimit = rateLimit({ name: 'signup', max: 20 });

router.post('/signup', signupLimit, validate(v.validateSignup), ctrl.signup);
router.post('/login', loginLimit, validate(v.validateLogin), ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', requireAuth, ctrl.me);
router.post('/forgot-password', forgotLimit, validate(v.validateForgot), asyncHandler(ctrl.forgotPassword));
router.post('/reset-password', forgotLimit, validate(v.validateReset), ctrl.resetPassword);
router.post('/change-password', requireAuth, validate(v.validateChangePassword), ctrl.changePassword);

module.exports = router;
