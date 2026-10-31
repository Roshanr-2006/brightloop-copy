'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const modules = path.join(__dirname, '..', 'src', 'modules');
const hasSubscriptions = fs.existsSync(path.join(modules, 'subscriptions', 'subscriptions.service.js'));
const hasInvoices = fs.existsSync(path.join(modules, 'invoices', 'invoices.service.js'));

let t;
let A;
let B;
const ids = {};

before(async () => {
  t = await start();
  A = t.makeUser({ name: 'Customer Alpha', email: 'alpha@example.com' });
  B = t.makeUser({ name: 'Customer Beta', email: 'beta@example.com' });
  const db = t.db;
  const planId = Number(db.prepare(`INSERT INTO recurring_plans (name, price, billing_period, pausable, closable, renewable)
    VALUES ('Portal Test Plan', 100, 'monthly', 1, 1, 1)`).run().lastInsertRowid);
  const sub = (customerId, number, status) => Number(db.prepare(`INSERT INTO subscriptions
    (number, customer_id, plan_id, status, start_date) VALUES (?, ?, ?, ?, '2026-01-01')`)
    .run(number, customerId, planId, status).lastInsertRowid);
  const inv = (customerId, number, status, subscriptionId, total = 1180, paid = 0) => Number(db.prepare(`INSERT INTO invoices
    (number, customer_id, subscription_id, status, invoice_date, due_date, period_start, untaxed_amount, tax_amount, total_amount, amount_paid)
    VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-10', ?, 1000, 180, ?, ?)`)
    .run(number, customerId, subscriptionId, status, `2026-01-0${Object.keys(ids).length % 9 + 1}`, total, paid).lastInsertRowid);

  ids.subA = sub(A.customerId, 'SUB/P/A1', 'active');
  ids.subAdraft = sub(A.customerId, 'SUB/P/A2', 'draft');
  ids.subB = sub(B.customerId, 'SUB/P/B1', 'active');
  ids.invA = inv(A.customerId, 'INV/P/A1', 'confirmed', ids.subA, 1180, 180);
  ids.invAdraft = inv(A.customerId, 'INV/P/A2', 'draft', null);
  ids.invAPaid = inv(A.customerId, 'INV/P/A3', 'paid', null, 500, 500);
  ids.invB = inv(B.customerId, 'INV/P/B1', 'confirmed', ids.subB);
  db.prepare(`INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date)
    VALUES (?, ?, 'upi', 180, '2026-01-05')`).run(ids.invA, A.customerId);
  db.prepare(`INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date)
    VALUES (?, ?, 'cash', 50, '2026-01-06')`).run(ids.invB, B.customerId);
});
after(async () => { await t.close(); });

test('portal is for customers only', async () => {
  assert.equal((await t.anon.get('/api/portal/subscriptions')).status, 401);
  assert.equal((await t.admin.get('/api/portal/subscriptions')).status, 403);
  assert.equal((await t.staff.get('/api/portal/invoices')).status, 403);
  // and customers cannot reach internal APIs
  assert.equal((await A.client.get('/api/customers')).status, 403);
  assert.equal((await A.client.get('/api/users')).status, 403);
});

test('subscriptions list is scoped to the customer and hides drafts', async () => {
  const res = await A.client.get('/api/portal/subscriptions');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((s) => s.number), ['SUB/P/A1']);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].pausable, true);
  const resB = await B.client.get('/api/portal/subscriptions');
  assert.deepEqual(resB.body.items.map((s) => s.number), ['SUB/P/B1']);
});

test('customer A cannot read customer B subscription or drafts', async () => {
  assert.equal((await A.client.get(`/api/portal/subscriptions/${ids.subB}`)).status, 404);
  assert.equal((await A.client.get(`/api/portal/subscriptions/${ids.subAdraft}`)).status, 404);
  assert.equal((await A.client.post(`/api/portal/subscriptions/${ids.subB}/pause`)).status, 404);
  assert.equal((await A.client.post(`/api/portal/subscriptions/${ids.subA}/activate`)).status, 404);
  const own = await A.client.get(`/api/portal/subscriptions/${ids.subA}`);
  assert.ok([200, 503].includes(own.status));
  if (hasSubscriptions) {
    assert.equal(own.status, 200);
    assert.equal(own.body.number, 'SUB/P/A1');
    assert.ok(own.body.allowed_actions.every((a) => ['pause', 'resume', 'close', 'renew'].includes(a)));
    assert.ok(own.body.invoices.every((i) => i.status !== 'draft'));
  }
});

test('portal actions delegate to the subscriptions service', { skip: !hasSubscriptions }, async () => {
  const paused = await A.client.post(`/api/portal/subscriptions/${ids.subA}/pause`, { note: 'Holiday' });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.status, 'paused');
  assert.equal((await A.client.post(`/api/portal/subscriptions/${ids.subA}/pause`)).status, 409);
  const resumed = await A.client.post(`/api/portal/subscriptions/${ids.subA}/resume`);
  assert.equal(resumed.body.status, 'active');
  assert.equal(t.db.prepare('SELECT status FROM subscriptions WHERE id = ?').get(ids.subB).status, 'active');
});

test('invoices list is scoped, hides drafts and filters by status', async () => {
  const res = await A.client.get('/api/portal/invoices');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => i.number).sort(), ['INV/P/A1', 'INV/P/A3']);
  assert.equal(res.body.summary.outstanding, 1000);
  const paid = await A.client.get('/api/portal/invoices?status=paid');
  assert.deepEqual(paid.body.items.map((i) => i.number), ['INV/P/A3']);
  const overdue = await A.client.get('/api/portal/invoices?status=overdue');
  assert.deepEqual(overdue.body.items.map((i) => i.number), ['INV/P/A1']);
  assert.equal(overdue.body.items[0].balance_due, 1000);
});

test('customer A cannot read customer B invoice', async () => {
  assert.equal((await A.client.get(`/api/portal/invoices/${ids.invB}`)).status, 404);
  assert.equal((await A.client.get(`/api/portal/invoices/${ids.invAdraft}`)).status, 404);
  assert.equal((await B.client.get(`/api/portal/invoices/${ids.invA}`)).status, 404);
  assert.equal((await A.client.get('/api/portal/invoices/999999')).status, 404);
  const own = await A.client.get(`/api/portal/invoices/${ids.invA}`);
  assert.ok([200, 503].includes(own.status), `got ${own.status}`);
  if (hasInvoices) assert.equal(own.body.number, 'INV/P/A1');
  else assert.match(own.body.error, /not available/);
});

test('payments are scoped to the customer', async () => {
  const res = await A.client.get('/api/portal/payments');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].invoice_number, 'INV/P/A1');
  assert.equal(res.body.summary.total_paid, 180);
});

test('profile read and update (email cannot change)', async () => {
  const me = await A.client.get('/api/portal/profile');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'alpha@example.com');
  assert.equal(me.body.id, A.customerId);

  const bad = await A.client.put('/api/portal/profile', { email: 'hacker@example.com' });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.email);

  const ok = await A.client.put('/api/portal/profile', {
    name: 'Alpha Industries', phone: '0484 222 3333', company_name: 'Alpha Pvt Ltd', city: 'Kochi', tax_id: '32ABCDE1234F1Z5',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.company_name, 'Alpha Pvt Ltd');
  assert.equal(ok.body.email, 'alpha@example.com');
  assert.equal(t.db.prepare('SELECT name FROM users WHERE id = ?').get(A.userId).name, 'Alpha Industries');
  assert.equal(t.db.prepare('SELECT name FROM customers WHERE id = ?').get(B.customerId).name, 'Customer Beta');
});
