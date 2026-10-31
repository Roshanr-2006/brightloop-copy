'use strict';

const { isEmail, normalizeEmail, passwordError, cleanName, nameError } = require('../auth/auth.validators');

// Optional text fields and their max length.
const PROFILE_FIELDS = {
  company_name: 120,
  phone: 30,
  billing_address: 500,
  city: 80,
  state: 80,
  country: 80,
  tax_id: 30,
};

const PHONE_RE = /^[0-9+()\-.\s]{6,30}$/;

function cleanOptional(body, errors, value, fields = PROFILE_FIELDS) {
  for (const [key, max] of Object.entries(fields)) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') {
      errors[key] = 'Must be text';
      continue;
    }
    const v = body[key] === null ? '' : body[key].trim();
    if (v.length > max) errors[key] = `Must be at most ${max} characters`;
    value[key] = v || null;
  }
  if (value.phone && !PHONE_RE.test(value.phone)) errors.phone = 'Enter a valid phone number';
}

/** Full customer record (create / PUT). */
function validateCustomer(body) {
  const errors = {};
  const value = {};
  value.name = cleanName(body.name);
  const nErr = nameError(value.name);
  if (nErr) errors.name = nErr;
  value.email = normalizeEmail(body.email);
  if (!value.email) errors.email = 'Email is required';
  else if (!isEmail(value.email)) errors.email = 'Enter a valid email address';
  cleanOptional(body, errors, value);
  if (value.country === undefined) value.country = 'India';
  return { errors, value };
}

/** Portal profile edit: same fields but never the email. */
function validateProfile(body) {
  const errors = {};
  const value = {};
  if (body.email !== undefined) errors.email = 'Email cannot be changed here. Please contact support.';
  if (body.name !== undefined) {
    value.name = cleanName(body.name);
    const nErr = nameError(value.name);
    if (nErr) errors.name = nErr;
  }
  cleanOptional(body, errors, value);
  return { errors, value };
}

function validatePortalAccess(body) {
  const errors = {};
  const password = body.password === undefined || body.password === null || body.password === '' ? null : body.password;
  if (password !== null) {
    const pErr = typeof password === 'string' ? passwordError(password) : 'Password must be text';
    if (pErr) errors.password = pErr;
  }
  return { errors, value: { password } };
}

module.exports = { validateCustomer, validateProfile, validatePortalAccess, PROFILE_FIELDS };
