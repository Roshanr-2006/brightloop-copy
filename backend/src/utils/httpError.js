'use strict';

/**
 * Throw from any service/controller to send a clean JSON error:
 *   throw new HttpError(404, 'Plan not found');
 *   throw new HttpError(422, 'Please fix the highlighted fields', { name: 'Name is required' });
 */
class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const badRequest = (msg, fields) => new HttpError(400, msg, fields);
const unauthorized = (msg = 'Please log in') => new HttpError(401, msg);
const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const conflict = (msg, fields) => new HttpError(409, msg, fields);
const unprocessable = (fields, msg = 'Please fix the highlighted fields') => new HttpError(422, msg, fields);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
