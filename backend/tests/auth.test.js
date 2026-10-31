'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, ADMIN } = require('./helpers');

let t;
before(async () => { t = await start(); });
after(async () => { await t.close(); });

const GOOD = 'Str0ng!Pass';

test('signup rejects weak passwords with a field error', async () => {
  const weak = ['Short!1a', 'alllowercase!', 'ALLUPPERCASE!', 'NoSpecial123', '', 'abcdefgh'];
  for (const password of weak) {
    const res = await t.client().post('/api/auth/signup', { name: 'Weak User', email: 'weak@example.com', password });
    assert.equal(res.status, 422, `expected 422 for "${password}"`);
    assert.ok(res.body.fields.password, `password error for "${password}"`);
  }
});

test('signup validates name and email', async () => {
  const res = await t.client().post('/api/auth/signup', { name: 'A', email: 'not-an-email', password: GOOD });
  assert.equal(res.status, 422);
  assert.ok(res.body.fields.name);
  assert.ok(res.body.fields.email);
});

test('signup creates a customer user + customers row and logs in', async () => {
  const c = t.client();
  const res = await c.post('/api/auth/signup', { name: 'Asha Menon', email: 'Asha@Example.com', password: GOOD });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'customer');
  assert.equal(res.body.user.email, 'asha@example.com');
  assert.ok(res.body.user.customerId);
  const row = t.db.prepare('SELECT * FROM customers WHERE id = ?').get(res.body.user.customerId);
  assert.equal(row.user_id, res.body.user.id);
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, res.body.user.id);
  assert.equal(me.body.user.customerId, res.body.user.customerId);
});

test('signup with a duplicate email (any case) -> 409 with fields.email', async () => {
  const res = await t.client().post('/api/auth/signup', { name: 'Asha Again', email: 'ASHA@example.com', password: GOOD });
  assert.equal(res.status, 409);
  assert.ok(res.body.fields.email);
  const staffDup = await t.client().post('/api/auth/signup', { name: 'Fake Staff', email: 'staff@brightloop.test', password: GOOD });
  assert.equal(staffDup.status, 409);
});

test('signup links to an existing customer record without a login', async () => {
  t.db.prepare("INSERT INTO customers (name, email, company_name) VALUES ('Ravi K', 'ravi@example.com', 'Ravi Co')").run();
  const res = await t.client().post('/api/auth/signup', { name: 'Ravi K', email: 'ravi@example.com', password: GOOD });
  assert.equal(res.status, 201);
  const row = t.db.prepare("SELECT * FROM customers WHERE email = 'ravi@example.com'").get();
  assert.equal(row.user_id, res.body.user.id);
  assert.equal(row.company_name, 'Ravi Co');
});

test('login, me and logout', async () => {
  const c = t.client();
  const bad = await c.post('/api/auth/login', { email: ADMIN.email, password: 'Wrong!Password1' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'Invalid email or password');
  const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'Wrong!Password1' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, 'Invalid email or password');

  const ok = await c.post('/api/auth/login', { email: ADMIN.email.toUpperCase(), password: ADMIN.password });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body.user).sort(), ['customerId', 'email', 'id', 'name', 'role']);
  assert.equal(ok.body.user.role, 'admin');
  assert.ok(t.db.prepare('SELECT last_login_at FROM users WHERE id = ?').get(ok.body.user.id).last_login_at);

  assert.equal((await c.get('/api/auth/me')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('inactive users cannot log in', async () => {
  const u = t.makeUser({ name: 'Old Staff', email: 'old@brightloop.test', role: 'staff' });
  t.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(u.userId);
  const res = await t.client().post('/api/auth/login', { email: 'old@brightloop.test', password: 'Passw0rd!x' });
  assert.equal(res.status, 401);
});

test('forgot + reset password flow, token is single use', async () => {
  const { sent } = require('../src/utils/mailer');
  const c = t.client();
  const unknown = await c.post('/api/auth/forgot-password', { email: 'ghost@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.devResetUrl, undefined);

  const before = sent.length;
  const res = await c.post('/api/auth/forgot-password', { email: 'asha@example.com' });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, unknown.body.message);
  assert.match(res.body.devResetUrl, /\/reset-password\?token=[a-f0-9]{64}$/);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).to, 'asha@example.com');
  assert.ok(sent.at(-1).text.includes(res.body.devResetUrl));

  const token = new URL(res.body.devResetUrl).searchParams.get('token');
  // Only the hash is stored.
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE token_hash = ?').get(token).n, 0);

  const weak = await c.post('/api/auth/reset-password', { token, password: 'weak' });
  assert.equal(weak.status, 422);

  const second = (await c.post('/api/auth/forgot-password', { email: 'asha@example.com' })).body.devResetUrl;
  const NEW = 'N3w!Password';
  const ok = await c.post('/api/auth/reset-password', { token, password: NEW });
  assert.equal(ok.status, 200);

  const reuse = await c.post('/api/auth/reset-password', { token, password: 'An0ther!Pass' });
  assert.equal(reuse.status, 400);
  // Other outstanding links were invalidated too.
  const other = await c.post('/api/auth/reset-password', { token: new URL(second).searchParams.get('token'), password: 'An0ther!Pass' });
  assert.equal(other.status, 400);

  assert.equal((await c.post('/api/auth/login', { email: 'asha@example.com', password: GOOD })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'asha@example.com', password: NEW })).status, 200);
});

test('expired and bogus reset tokens are rejected', async () => {
  const bogus = await t.client().post('/api/auth/reset-password', { token: 'deadbeef', password: GOOD });
  assert.equal(bogus.status, 400);
  const res = await t.client().post('/api/auth/forgot-password', { email: 'ravi@example.com' });
  const token = new URL(res.body.devResetUrl).searchParams.get('token');
  t.db.prepare("UPDATE password_reset_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
  const expired = await t.client().post('/api/auth/reset-password', { token, password: GOOD });
  assert.equal(expired.status, 400);
});

test('change password requires the current password', async () => {
  const c = t.client();
  await c.post('/api/auth/login', { email: 'asha@example.com', password: 'N3w!Password' });
  const wrong = await c.post('/api/auth/change-password', { current_password: 'nope', new_password: 'Chang3d!Pass' });
  assert.equal(wrong.status, 422);
  assert.ok(wrong.body.fields.current_password);
  const weak = await c.post('/api/auth/change-password', { current_password: 'N3w!Password', new_password: 'weak' });
  assert.equal(weak.status, 422);
  assert.ok(weak.body.fields.new_password);
  const ok = await c.post('/api/auth/change-password', { current_password: 'N3w!Password', new_password: 'Chang3d!Pass' });
  assert.equal(ok.status, 200);
  assert.equal((await t.client().post('/api/auth/login', { email: 'asha@example.com', password: 'Chang3d!Pass' })).status, 200);
  assert.equal((await t.anon.post('/api/auth/change-password', {})).status, 401);
});

// ---------------------------------------------------------------- /api/users

test('only admins can manage staff users', async () => {
  const body = { name: 'New Staff', email: 'newstaff@brightloop.test', password: GOOD };
  assert.equal((await t.anon.get('/api/users')).status, 401);
  assert.equal((await t.staff.post('/api/users', body)).status, 403);
  assert.equal((await t.staff.get('/api/users')).status, 403);
  const customer = t.makeUser({ name: 'Cust One', email: 'cust1@example.com' });
  assert.equal((await customer.client.post('/api/users', body)).status, 403);

  const weak = await t.admin.post('/api/users', { ...body, password: 'weak' });
  assert.equal(weak.status, 422);
  assert.ok(weak.body.fields.password);

  const res = await t.admin.post('/api/users', { ...body, role: 'customer' });
  assert.equal(res.status, 422, 'customer role is not allowed here');

  const created = await t.admin.post('/api/users', body);
  assert.equal(created.status, 201);
  assert.equal(created.body.role, 'staff');
  assert.equal(created.body.created_by, t.adminId);
  assert.equal(created.body.password_hash, undefined);

  const dup = await t.admin.post('/api/users', { ...body, email: 'NEWSTAFF@brightloop.test' });
  assert.equal(dup.status, 409);
  assert.ok(dup.body.fields.email);

  const login = await t.client().post('/api/auth/login', { email: body.email, password: GOOD });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'staff');
});

test('admin lists staff (customers excluded by default) and updates them', async () => {
  const list = await t.admin.get('/api/users?limit=100');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length >= 2);
  assert.ok(list.body.items.every((u) => u.role !== 'customer'));
  assert.ok(list.body.total >= 2);

  const search = await t.admin.get('/api/users?search=newstaff');
  assert.equal(search.body.items.length, 1);
  const id = search.body.items[0].id;

  const off = await t.admin.patch(`/api/users/${id}`, { is_active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.is_active, false);
  assert.equal((await t.client().post('/api/auth/login', { email: 'newstaff@brightloop.test', password: GOOD })).status, 401);

  const promote = await t.admin.patch(`/api/users/${id}`, { role: 'admin', is_active: true, name: 'Promoted Staff' });
  assert.equal(promote.body.role, 'admin');
  assert.equal(promote.body.name, 'Promoted Staff');

  assert.equal((await t.admin.patch(`/api/users/${t.adminId}`, { is_active: false })).status, 422);
  assert.equal((await t.admin.patch(`/api/users/${t.adminId}`, { role: 'staff' })).status, 422);
  assert.equal((await t.admin.get('/api/users/999999')).status, 404);
  assert.equal((await t.admin.patch('/api/users/999999', { name: 'Nobody Here' })).status, 404);
});
