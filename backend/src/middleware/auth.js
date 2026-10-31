'use strict';

// Authentication middleware (owner: Sachin).
// Login (Sachin's auth module) calls signToken(user) and sets the cookie with setAuthCookie(res, token).
// Every protected route uses requireAuth, which sets:
//   req.user = { id, name, email, role, customerId }

const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { unauthorized } = require('../utils/httpError');

const COOKIE_NAME = 'bl_token';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies ? req.cookies[COOKIE_NAME] : undefined;
}

const findUser = db.prepare(`
  SELECT u.id, u.name, u.email, u.role, u.is_active, c.id AS customer_id
  FROM users u LEFT JOIN customers c ON c.user_id = u.id
  WHERE u.id = ?`);

function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next(unauthorized());
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(unauthorized('Your session has expired, please log in again'));
  }
  const user = findUser.get(payload.sub);
  if (!user || !user.is_active) return next(unauthorized('Account not found or disabled'));
  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    customerId: user.customer_id ?? null,
  };
  return next();
}

module.exports = { requireAuth, signToken, setAuthCookie, clearAuthCookie, COOKIE_NAME };
