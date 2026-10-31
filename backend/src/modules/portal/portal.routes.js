'use strict';

// /api/portal (owner: Sachin). Customers only; every row is scoped to req.user.customerId.

const express = require('express');
const ctrl = require('./portal.controller');
const { validateProfile } = require('../customers/customers.validators');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/roles');

const router = express.Router();

router.use(requireAuth, requireRole('customer'));

router.get('/subscriptions', ctrl.listSubscriptions);
router.get('/subscriptions/:id', ctrl.getSubscription);
router.post('/subscriptions/:id/:action(pause|resume|close|renew)', ctrl.subscriptionAction);
router.get('/invoices', ctrl.listInvoices);
router.get('/invoices/:id', ctrl.getInvoice);
router.get('/payments', ctrl.listPayments);
router.get('/profile', ctrl.getProfile);
router.put('/profile', validate(validateProfile), ctrl.updateProfile);

module.exports = router;
