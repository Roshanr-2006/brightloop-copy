'use strict';

const service = require('./payments.service');
const { parsePagination, paged } = require('../../utils/pagination');
const { notFound } = require('../../utils/httpError');

function list(req, res) {
  const pagination = parsePagination(req.query);
  const q = req.query;
  const { items, total, total_amount } = service.listPayments({
    search: q.search,
    method: q.method,
    customerId: q.customer_id,
    invoiceId: q.invoice_id,
    from: q.from,
    to: q.to,
  }, pagination);
  res.json({ ...paged(items, total, pagination), total_amount });
}

function get(req, res) {
  const payment = service.getPayment(Number(req.params.id));
  if (!payment) throw notFound('Payment not found');
  res.json(payment);
}

function create(req, res) {
  const payment = service.recordPayment(req.body, req.user.id);
  res.status(201).json(payment);
}

function remove(req, res) {
  res.json(service.reversePayment(Number(req.params.id)));
}

module.exports = { list, get, create, remove };
