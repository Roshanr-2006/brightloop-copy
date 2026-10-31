'use strict';

const service = require('./portal.service');
const { parsePagination } = require('../../utils/pagination');
const { badRequest } = require('../../utils/httpError');

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid id');
  return id;
}

const cid = (req) => req.user.customerId;

function listSubscriptions(req, res) {
  res.json(service.listSubscriptions(cid(req), req.query, parsePagination(req.query)));
}

function getSubscription(req, res) {
  res.json(service.getSubscription(cid(req), parseId(req.params.id)));
}

function subscriptionAction(req, res) {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
  res.json(service.applyAction(cid(req), parseId(req.params.id), req.params.action, req.user.id, note || null));
}

function listInvoices(req, res) {
  res.json(service.listInvoices(cid(req), req.query, parsePagination(req.query)));
}

function getInvoice(req, res) {
  res.json(service.getInvoice(cid(req), parseId(req.params.id)));
}

function listPayments(req, res) {
  res.json(service.listPayments(cid(req), parsePagination(req.query)));
}

function getProfile(req, res) {
  res.json(service.getProfile(cid(req)));
}

function updateProfile(req, res) {
  res.json(service.updateProfile(cid(req), req.body));
}

module.exports = {
  listSubscriptions, getSubscription, subscriptionAction, listInvoices, getInvoice, listPayments, getProfile, updateProfile,
};
