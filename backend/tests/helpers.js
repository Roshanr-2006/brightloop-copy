'use strict';

// Test helper: boots the real app on a random port with a fresh in-memory DB.
//   const { start } = require('./helpers');
//   const t = await start();   // t.admin / t.staff / t.anon clients, t.makeUser(), t.db, t.close()
//   const res = await t.admin.get('/api/catalog/products');   // -> { status, body, headers }
// Each test file runs in its own process (node --test), so each gets its own DB.

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const bcrypt = require('bcryptjs');

const ADMIN = { email: 'admin@brightloop.test', password: 'Admin@12345' };

function client(base) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b ?? {}),
    delete: (p) => call('DELETE', p),
    /** Authenticate with a signed token directly (works without the login endpoint). */
    as(userId, role) {
      const { signToken } = require('../src/middleware/auth');
      cookie = `bl_token=${signToken({ id: userId, role })}`;
      return this;
    },
  };
}

/** Insert a user straight into the DB and return { userId, customerId, client } logged in as them. */
function makeUser(base, { name, email, password = 'Passw0rd!x', role = 'customer', customer = role === 'customer' }) {
  const { db } = require('../src/db');
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 4), role);
  const userId = Number(info.lastInsertRowid);
  let customerId = null;
  if (customer) {
    customerId = Number(db.prepare('INSERT INTO customers (user_id, name, email) VALUES (?, ?, ?)')
      .run(userId, name, email).lastInsertRowid);
  }
  return { userId, customerId, client: client(base).as(userId, role) };
}

async function start() {
  const app = require('../src/app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const admin = makeUser(url, { name: 'Test Admin', email: ADMIN.email, password: ADMIN.password, role: 'admin', customer: false });
  const staff = makeUser(url, { name: 'Test Staff', email: 'staff@brightloop.test', role: 'staff', customer: false });
  return {
    url,
    adminId: admin.userId,
    staffId: staff.userId,
    admin: admin.client,
    staff: staff.client,
    anon: client(url),
    client: () => client(url),
    makeUser: (opts) => makeUser(url, opts),
    db: require('../src/db').db,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { start, client, ADMIN };
