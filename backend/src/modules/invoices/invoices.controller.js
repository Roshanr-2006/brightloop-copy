'use strict';

// HTTP layer for invoices (no SQL here).

const service = require('./invoices.service');
const { parsePagination } = require('../../utils/pagination');
const { notFound } = require('../../utils/httpError');

function filtersFrom(query) {
  return {
    search: query.search,
    status: query.status,
    customerId: query.customer_id,
    subscriptionId: query.subscription_id,
    overdue: query.overdue,
    from: query.from,
    to: query.to,
    sort: query.sort,
  };
}

function list(req, res) {
  const filters = filtersFrom(req.query);
  const result = service.listInvoices(filters, parsePagination(req.query));
  if (req.query.counts !== '0') result.counts = service.statusCounts(filters);
  res.json(result);
}

function get(req, res) {
  const inv = service.getInvoice(req.params.id);
  if (!inv) throw notFound('Invoice not found');
  res.json(inv);
}

function confirm(req, res) {
  res.json(service.confirmInvoice(req.params.id));
}

function cancel(req, res) {
  res.json(service.cancelInvoice(req.params.id, { rebill: Boolean(req.body && req.body.rebill === true) }));
}

async function send(req, res) {
  res.json(await service.sendInvoice(req.params.id));
}

module.exports = { list, get, confirm, cancel, send };
