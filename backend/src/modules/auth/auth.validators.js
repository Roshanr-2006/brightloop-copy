'use strict';

// Shared field rules for auth, users and customers.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/** Returns the list of unmet password rules (empty = strong enough). */
function passwordIssues(pw) {
  const s = typeof pw === 'string' ? pw : '';
  const issues = [];
  if (s.length <= 8) issues.push('be longer than 8 characters');
  if (!/[A-Z]/.test(s)) issues.push('contain an uppercase letter');
  if (!/[a-z]/.test(s)) issues.push('contain a lowercase letter');
  if (!/[^A-Za-z0-9]/.test(s)) issues.push('contain a special character');
  if (s.length > 128) issues.push('be at most 128 characters');
  return issues;
}

function passwordError(pw) {
  const issues = passwordIssues(pw);
  return issues.length ? `Password must ${issues.join(', ')}` : null;
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function nameError(name) {
  if (!name) return 'Name is required';
  if (name.length < 2) return 'Name must be at least 2 characters';
  if (name.length > 100) return 'Name must be at most 100 characters';
  return null;
}

function validateSignup(body) {
  const errors = {};
  const name = cleanName(body.name);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const nErr = nameError(name);
  if (nErr) errors.name = nErr;
  if (!email) errors.email = 'Email is required';
  else if (!isEmail(email)) errors.email = 'Enter a valid email address';
  const pErr = passwordError(password);
  if (pErr) errors.password = pErr;
  return { errors, value: { name, email, password } };
}

function validateLogin(body) {
  const errors = {};
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email) errors.email = 'Email is required';
  if (!password) errors.password = 'Password is required';
  return { errors, value: { email, password } };
}

function validateForgot(body) {
  const email = normalizeEmail(body.email);
  const errors = {};
  if (!email) errors.email = 'Email is required';
  else if (!isEmail(email)) errors.email = 'Enter a valid email address';
  return { errors, value: { email } };
}

function validateReset(body) {
  const errors = {};
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!token) errors.token = 'Reset token is missing';
  const pErr = passwordError(password);
  if (pErr) errors.password = pErr;
  return { errors, value: { token, password } };
}

function validateChangePassword(body) {
  const errors = {};
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const next = typeof body.new_password === 'string' ? body.new_password : '';
  if (!current) errors.current_password = 'Current password is required';
  const pErr = passwordError(next);
  if (pErr) errors.new_password = pErr;
  else if (current && current === next) errors.new_password = 'New password must be different from the current one';
  return { errors, value: { current_password: current, new_password: next } };
}

module.exports = {
  isEmail,
  normalizeEmail,
  passwordIssues,
  passwordError,
  cleanName,
  nameError,
  validateSignup,
  validateLogin,
  validateForgot,
  validateReset,
  validateChangePassword,
};
