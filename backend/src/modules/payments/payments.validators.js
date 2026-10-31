'use strict';

const { isValidDate, today } = require('../../utils/dates');
const { round2 } = require('../../utils/money');

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'upi', 'cheque', 'other'];

function optionalText(value, max) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return { error: 'Must be text' };
  const v = value.trim();
  if (v.length > max) return { error: `Must be at most ${max} characters` };
  return { value: v || null };
}

/** POST /api/payments body. */
function validatePayment(body) {
  const errors = {};
  const value = {};

  const invoiceId = Number(body.invoice_id);
  if (!Number.isInteger(invoiceId) || invoiceId < 1) errors.invoice_id = 'Choose an invoice';
  else value.invoice_id = invoiceId;

  if (!PAYMENT_METHODS.includes(body.method)) {
    errors.method = `Method must be one of: ${PAYMENT_METHODS.join(', ')}`;
  } else value.method = body.method;

  const amount = typeof body.amount === 'string' && body.amount.trim() !== '' ? Number(body.amount) : body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || round2(amount) <= 0) {
    errors.amount = 'Amount must be greater than 0';
  } else if (amount > 1e10) {
    errors.amount = 'Amount is too large';
  } else value.amount = round2(amount);

  if (!isValidDate(body.payment_date)) errors.payment_date = 'Payment date must be a valid date (YYYY-MM-DD)';
  else if (body.payment_date > today()) errors.payment_date = 'Payment date cannot be in the future';
  else value.payment_date = body.payment_date;

  const ref = optionalText(body.reference, 100);
  if (ref.error) errors.reference = ref.error; else value.reference = ref.value;
  const note = optionalText(body.note, 500);
  if (note.error) errors.note = note.error; else value.note = note.value;

  return { errors, value };
}

module.exports = { validatePayment, PAYMENT_METHODS };
