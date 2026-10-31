'use strict';

// HTTP layer for subscriptions (no SQL here).

const service = require('./subscriptions.service');
const billing = require('../billing/billing.service');
const { parsePagination } = require('../../utils/pagination');
const { notFound } = require('../../utils/httpError');

function filtersFrom(query) {
  return {
    search: query.search,
    status: query.status,
    customerId: query.customer_id,
    planId: query.plan_id,
    expiringBefore: query.expiring_before,
    sort: query.sort,
  };
}

function list(req, res) {
  const filters = filtersFrom(req.query);
  const result = service.listSubscriptions(filters, parsePagination(req.query));
  if (req.query.counts !== '0') result.counts = service.statusCounts(filters);
  res.json(result);
}

function get(req, res) {
  const sub = service.getSubscription(req.params.id);
  if (!sub) throw notFound('Subscription not found');
  res.json(sub);
}

function fromTemplate(req, res) {
  res.json(service.draftFromTemplate(req.params.templateId));
}

function create(req, res) {
  res.status(201).json(service.createSubscription(req.body, req.user.id));
}

function update(req, res) {
  res.json(service.updateSubscription(req.params.id, req.body, req.user.id));
}

function remove(req, res) {
  service.deleteSubscription(req.params.id);
  res.status(204).end();
}

function action(req, res) {
  res.json(service.applyAction(req.params.id, req.params.action, req.user.id, req.body || {}));
}

function invoiceNow(req, res) {
  const invoice = billing.billSubscriptionNow(req.params.id, {
    userId: req.user.id,
    autoConfirm: req.body && req.body.auto_confirm === true,
  });
  res.status(201).json(invoice);
}

module.exports = { list, get, fromTemplate, create, update, remove, action, invoiceNow };
