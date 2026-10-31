'use strict';

const { isEmail, normalizeEmail, passwordError, cleanName, nameError } = require('../auth/auth.validators');

const INTERNAL_ROLES = ['admin', 'staff'];

function validateCreateUser(body) {
  const errors = {};
  const name = cleanName(body.name);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === undefined || body.role === null || body.role === '' ? 'staff' : body.role;
  const nErr = nameError(name);
  if (nErr) errors.name = nErr;
  if (!email) errors.email = 'Email is required';
  else if (!isEmail(email)) errors.email = 'Enter a valid email address';
  const pErr = passwordError(password);
  if (pErr) errors.password = pErr;
  if (!INTERNAL_ROLES.includes(role)) errors.role = 'Role must be staff or admin';
  return { errors, value: { name, email, password, role } };
}

function validateUpdateUser(body) {
  const errors = {};
  const value = {};
  if (body.name !== undefined) {
    value.name = cleanName(body.name);
    const nErr = nameError(value.name);
    if (nErr) errors.name = nErr;
  }
  if (body.is_active !== undefined) {
    if (![true, false, 0, 1].includes(body.is_active)) errors.is_active = 'Must be true or false';
    else value.is_active = body.is_active ? 1 : 0;
  }
  if (body.role !== undefined) {
    if (!INTERNAL_ROLES.includes(body.role)) errors.role = 'Role must be staff or admin';
    else value.role = body.role;
  }
  if (!Object.keys(errors).length && !Object.keys(value).length) errors.name = 'Nothing to update';
  return { errors, value };
}

module.exports = { validateCreateUser, validateUpdateUser, INTERNAL_ROLES };
