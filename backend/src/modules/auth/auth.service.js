'use strict';

// Auth business logic (owner: Sachin). No req/res here.

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db, transaction } = require('../../db');
const { HttpError, conflict, unauthorized, badRequest } = require('../../utils/httpError');
const { sendMail } = require('../../utils/mailer');

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // portal invites last 3 days

const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const hashPassword = (pw) => bcrypt.hashSync(pw, BCRYPT_ROUNDS);

const selectUserByEmail = 'SELECT * FROM users WHERE email = ? COLLATE NOCASE';

/** Public shape of a user: { id, name, email, role, customerId } */
function publicUser(userId) {
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, c.id AS customer_id
    FROM users u LEFT JOIN customers c ON c.user_id = u.id
    WHERE u.id = ?`).get(userId);
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, customerId: row.customer_id ?? null };
}

function emailTaken(email) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email));
}

/**
 * Public signup: creates a customer-role user and its customers row in one transaction.
 * If staff already created a customers row with this email (and it has no login yet),
 * the new login is linked to that existing customer instead of failing.
 */
function signup({ name, email, password }) {
  const passwordHash = hashPassword(password);
  const userId = transaction(() => {
    if (emailTaken(email)) {
      throw conflict('An account with this email already exists', { email: 'This email is already registered' });
    }
    const existingCustomer = db.prepare('SELECT id, user_id FROM customers WHERE email = ? COLLATE NOCASE').get(email);
    if (existingCustomer && existingCustomer.user_id) {
      throw conflict('An account with this email already exists', { email: 'This email is already registered' });
    }
    const id = Number(db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'customer')",
    ).run(name, email, passwordHash).lastInsertRowid);
    if (existingCustomer) {
      db.prepare('UPDATE customers SET user_id = ?, updated_at = ? WHERE id = ?').run(id, nowIso(), existingCustomer.id);
    } else {
      db.prepare('INSERT INTO customers (user_id, name, email) VALUES (?, ?, ?)').run(id, name, email);
    }
    return id;
  });
  return publicUser(userId);
}

// Dummy hash so login takes the same time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

function login({ email, password }) {
  const row = db.prepare(selectUserByEmail).get(email);
  const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw unauthorized('Invalid email or password');
  if (!row.is_active) throw unauthorized('This account has been deactivated. Please contact the administrator.');
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
  return publicUser(row.id);
}

/** Creates a single-use token for the user; only its sha256 is stored. Returns the raw token. */
function createResetToken(userId, ttlMs = RESET_TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, sha256(token), new Date(Date.now() + ttlMs).toISOString());
  return token;
}

const resetUrlFor = (token) => `${appUrl()}/reset-password?token=${token}`;

/** Always resolves with the same message; returns { resetUrl } only when a mail was sent. */
async function forgotPassword({ email }) {
  const row = db.prepare(selectUserByEmail).get(email);
  if (!row || !row.is_active) return { resetUrl: null };
  const token = createResetToken(row.id);
  const url = resetUrlFor(token);
  await sendMail({
    to: row.email,
    subject: 'Reset your Brightloop password',
    text: `Hi ${row.name},\n\nWe received a request to reset your Brightloop password.\n`
      + `Open this link within 1 hour to choose a new password:\n\n${url}\n\n`
      + 'If you did not ask for this, you can ignore this email.\n',
    html: `<p>Hi ${escapeHtml(row.name)},</p><p>We received a request to reset your Brightloop password.</p>`
      + `<p><a href="${url}">Choose a new password</a> (valid for 1 hour)</p>`
      + '<p>If you did not ask for this, you can ignore this email.</p>',
  });
  return { resetUrl: url };
}

/** Sends a portal invitation (set-your-password link) to an existing user. */
async function sendInvite(userId) {
  const row = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
  const token = createResetToken(row.id, INVITE_TTL_MS);
  const url = resetUrlFor(token);
  await sendMail({
    to: row.email,
    subject: 'Your Brightloop customer portal access',
    text: `Hi ${row.name},\n\nA Brightloop customer portal account has been created for you.\n`
      + `Open this link to set your password (valid for 3 days):\n\n${url}\n\n`
      + 'In the portal you can see your subscriptions, invoices and payments.\n',
    html: `<p>Hi ${escapeHtml(row.name)},</p><p>A Brightloop customer portal account has been created for you.</p>`
      + `<p><a href="${url}">Set your password</a> (valid for 3 days)</p>`,
  });
  return url;
}

function resetPassword({ token, password }) {
  const hash = sha256(token);
  transaction(() => {
    const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(hash);
    if (!row || row.used_at || row.expires_at <= nowIso()) {
      throw badRequest('This reset link is invalid or has expired. Please request a new one.', {
        token: 'Invalid or expired link',
      });
    }
    const now = nowIso();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(password), now, row.user_id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
    // Any other outstanding links for this user stop working too.
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, row.user_id);
  });
}

function changePassword(userId, { current_password: current, new_password: next }) {
  const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
  if (!row || !bcrypt.compareSync(current, row.password_hash)) {
    throw new HttpError(422, 'Current password is incorrect', { current_password: 'Current password is incorrect' });
  }
  const now = nowIso();
  transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(next), now, userId);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, userId);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = {
  publicUser,
  emailTaken,
  hashPassword,
  signup,
  login,
  createResetToken,
  forgotPassword,
  sendInvite,
  resetPassword,
  changePassword,
};
