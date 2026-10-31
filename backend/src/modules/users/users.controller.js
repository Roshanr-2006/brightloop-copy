'use strict';

const service = require('./users.service');
const { parsePagination } = require('../../utils/pagination');
const { notFound, badRequest } = require('../../utils/httpError');

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid id');
  return id;
}

function list(req, res) {
  res.json(service.listUsers(req.query, parsePagination(req.query)));
}

function get(req, res) {
  const user = service.getUser(parseId(req.params.id));
  if (!user) throw notFound('User not found');
  res.json(user);
}

function create(req, res) {
  res.status(201).json(service.createUser(req.body, req.user.id));
}

function update(req, res) {
  res.json(service.updateUser(parseId(req.params.id), req.body, req.user.id));
}

module.exports = { list, get, create, update, parseId };
