'use strict';

const service = require('./reports.service');
const { parsePagination } = require('../../utils/pagination');
const { isValidDate } = require('../../utils/dates');
const { unprocessable } = require('../../utils/httpError');

/** Reject malformed date filters instead of silently ignoring them. */
function checkRange(query) {
  const fields = {};
  for (const key of ['from', 'to']) {
    if (query[key] !== undefined && query[key] !== '' && !isValidDate(query[key])) fields[key] = 'Use a valid date (YYYY-MM-DD)';
  }
  if (!fields.from && !fields.to && query.from && query.to && query.from > query.to) fields.to = 'End date must be after the start date';
  if (Object.keys(fields).length) throw unprocessable(fields);
}

const summary = (req, res) => { checkRange(req.query); res.json(service.summary(req.query)); };
const revenue = (req, res) => { checkRange(req.query); res.json(service.revenue(req.query)); };
const overdue = (req, res) => res.json(service.overdue(req.query, parsePagination(req.query)));
const paymentsByMethod = (req, res) => { checkRange(req.query); res.json(service.paymentsByMethod(req.query)); };
const subscriptionsByPlan = (req, res) => res.json(service.subscriptionsByPlan(req.query));
const topCustomers = (req, res) => { checkRange(req.query); res.json(service.topCustomers(req.query)); };

module.exports = { summary, revenue, overdue, paymentsByMethod, subscriptionsByPlan, topCustomers };
