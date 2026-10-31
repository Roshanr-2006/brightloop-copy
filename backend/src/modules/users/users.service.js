'use strict';

// Staff / admin accounts (owner: Sachin). Only admins reach these functions (enforced in routes).

const { db } = require('../../db');
const { conflict, notFound, unprocessable } = require('../../utils/httpError');
const { paged, likePattern, sortBy } = require('../../utils/pagination');
const { hashPassword, emailTaken } = require('../auth/auth.service');

const COLUMNS = `u.id, u.name, u.email, u.role, u.is_active, u.created_by, cb.name AS created_by_name,
  u.last_login_at, u.created_at, u.updated_at`;

const SORTS = { name: 'u.name', email: 'u.email', role: 'u.role', created: 'u.created_at', last_login: 'u.last_login_at' };

function listUsers({ search, role, active, sort } = {}, pagination) {
  const where = [];
  const params = [];
  if (role && ['admin', 'staff', 'customer'].includes(role)) {
    where.push('u.role = ?');
    params.push(role);
  } else if (role !== 'all') {
    where.push("u.role IN ('admin', 'staff')");
  }
  if (search) {
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    const p = likePattern(search);
    params.push(p, p);
  }
  if (active === '1' || active === '0' || active === 'true' || active === 'false') {
    where.push('u.is_active = ?');
    params.push(active === '1' || active === 'true' ? 1 : 0);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users u ${whereSql}`).get(...params);
  const items = db.prepare(`
    SELECT ${COLUMNS} FROM users u LEFT JOIN users cb ON cb.id = u.created_by
    ${whereSql} ORDER BY ${sortBy(sort, SORTS, 'u.name')}, u.id LIMIT ? OFFSET ?`)
    .all(...params, pagination.limit, pagination.offset)
    .map(toUser);
  return paged(items, total, pagination);
}

function toUser(row) {
  return { ...row, is_active: Boolean(row.is_active) };
}

function getUser(id) {
  const row = db.prepare(`SELECT ${COLUMNS} FROM users u LEFT JOIN users cb ON cb.id = u.created_by WHERE u.id = ?`).get(id);
  return row ? toUser(row) : null;
}

function createUser({ name, email, password, role }, createdBy) {
  if (emailTaken(email)) throw conflict('A user with this email already exists', { email: 'This email is already registered' });
  const id = Number(db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?)',
  ).run(name, email, hashPassword(password), role === 'admin' ? 'admin' : 'staff', createdBy).lastInsertRowid);
  return getUser(id);
}

function updateUser(id, changes, actingUserId) {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('User not found');
  if (user.role === 'customer' && changes.role !== undefined) {
    throw unprocessable({ role: 'Customer logins cannot be turned into staff accounts' });
  }
  if (id === actingUserId) {
    if (changes.is_active === 0) throw unprocessable({ is_active: 'You cannot deactivate your own account' });
    if (changes.role && changes.role !== 'admin') throw unprocessable({ role: 'You cannot remove your own admin role' });
  }
  const sets = [];
  const params = [];
  for (const key of ['name', 'is_active', 'role']) {
    if (changes[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(changes[key]);
    }
  }
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getUser(id);
}

module.exports = { listUsers, getUser, createUser, updateUser };
