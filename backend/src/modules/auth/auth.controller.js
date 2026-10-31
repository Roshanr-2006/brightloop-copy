'use strict';

const service = require('./auth.service');
const { signToken, setAuthCookie, clearAuthCookie } = require('../../middleware/auth');

const FORGOT_MESSAGE = 'If an account exists for this email, a password reset link has been sent.';

function startSession(res, user) {
  setAuthCookie(res, signToken(user));
}

function signup(req, res) {
  const user = service.signup(req.body);
  startSession(res, user);
  res.status(201).json({ user });
}

function login(req, res) {
  const user = service.login(req.body);
  startSession(res, user);
  res.json({ user });
}

function logout(req, res) {
  clearAuthCookie(res);
  res.json({ ok: true });
}

function me(req, res) {
  res.json({ user: req.user });
}

async function forgotPassword(req, res) {
  const { resetUrl } = await service.forgotPassword(req.body);
  const body = { message: FORGOT_MESSAGE };
  // Demo convenience: without SMTP the link is shown on screen (never in production).
  if (process.env.NODE_ENV !== 'production' && resetUrl) body.devResetUrl = resetUrl;
  res.json(body);
}

function resetPassword(req, res) {
  service.resetPassword(req.body);
  clearAuthCookie(res);
  res.json({ message: 'Your password has been reset. You can now log in.' });
}

function changePassword(req, res) {
  service.changePassword(req.user.id, req.body);
  res.json({ message: 'Password changed' });
}

module.exports = { signup, login, logout, me, forgotPassword, resetPassword, changePassword };
