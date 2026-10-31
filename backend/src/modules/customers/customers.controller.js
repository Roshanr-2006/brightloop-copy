'use strict';

const service = require('./customers.service');
const { parsePagination } = require('../../utils/pagination');
const { notFound, badRequest } = require('../../utils/httpError');

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid id');
  return id;
}

function list(req, res) {
  res.json(service.listCustomers(req.query, parsePagination(req.query)));
}

function get(req, res) {
  const customer = service.getCustomer(parseId(req.params.id));
  if (!customer) throw notFound('Customer not found');
  res.json(customer);
}

function create(req, res) {
  res.status(201).json(service.createCustomer(req.body));
}

function update(req, res) {
  res.json(service.updateCustomer(parseId(req.params.id), req.body));
}

function remove(req, res) {
  service.deleteCustomer(parseId(req.params.id));
  res.status(204).end();
}

async function portalAccess(req, res) {
  const result = await service.grantPortalAccess(parseId(req.params.id), req.body, req.user.id);
  const body = {
    customer: result.customer,
    user: result.user,
    inviteSent: result.inviteSent,
    message: result.inviteSent
      ? `An invitation email was sent to ${result.user.email}`
      : 'Portal access created. Share the password with the customer securely.',
  };
  if (result.inviteUrl && process.env.NODE_ENV !== 'production') body.devInviteUrl = result.inviteUrl;
  res.status(201).json(body);
}

module.exports = { list, get, create, update, remove, portalAccess };
