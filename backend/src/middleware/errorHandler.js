'use strict';

const { HttpError } = require('../utils/httpError');

// 404 for unknown /api routes.
function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

// Translate SQLite constraint errors into friendly API errors.
function fromSqlite(err) {
  const msg = String(err.message || '');
  if (!/constraint/i.test(msg)) return null;
  if (/invoices\.subscription_id, invoices\.period_start/.test(msg)) {
    return new HttpError(409, 'An invoice already exists for this subscription period');
  }
  const unique = msg.match(/UNIQUE constraint failed: \w+\.(\w+)/);
  if (unique) {
    return new HttpError(409, `This ${unique[1].replace(/_/g, ' ')} is already in use`, {
      [unique[1]]: 'Already exists',
    });
  }
  if (/FOREIGN KEY constraint failed/.test(msg)) {
    return new HttpError(409, 'This record is linked to other records and cannot be changed or deleted');
  }
  if (/CHECK constraint failed/.test(msg)) {
    return new HttpError(422, 'Some values are not allowed. Please check the form.');
  }
  return new HttpError(409, 'The data conflicts with existing records');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  const httpErr = err instanceof HttpError ? err : fromSqlite(err);
  if (httpErr) {
    const body = { error: httpErr.message };
    if (httpErr.fields) body.fields = httpErr.fields;
    return res.status(httpErr.status).json(body);
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({ error: 'Something went wrong on the server' });
}

module.exports = { notFoundHandler, errorHandler };
