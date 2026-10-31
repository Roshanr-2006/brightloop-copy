'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t;
before(async () => { t = await start(); });
after(async () => { await t.close(); });

const planId = () => t.db.prepare('SELECT id FROM recurring_plans ORDER BY id LIMIT 1').get().id;

function seedSubscription(customerId, number, status = 'active') {
  return Number(t.db.prepare(`INSERT INTO subscriptions (number, customer_id, plan_id, status, start_date)
    VALUES (?, ?, ?, ?, '2026-01-01')`).run(number, customerId, planId(), status).lastInsertRowid);
}

function seedInvoice(customerId, number, { status = 'confirmed', total = 1000, paid = 0, due = '2026-01-15', subscriptionId = null } = {}) {
  return Number(t.db.prepare(`INSERT INTO invoices (number, customer_id, subscription_id, status, invoice_date, due_date,
    untaxed_amount, total_amount, amount_paid) VALUES (?, ?, ?, ?, '2026-01-01', ?, ?, ?, ?)`)
    .run(number, customerId, subscriptionId, status, due, total, total, paid).lastInsertRowid);
}

test('customers API is internal only', async () => {
  assert.equal((await t.anon.get('/api/customers')).status, 401);
  const cust = t.makeUser({ name: 'Portal Pat', email: 'pat@example.com' });
  assert.equal((await cust.client.get('/api/customers')).status, 403);
  assert.equal((await cust.client.post('/api/customers', { name: 'X Y', email: 'xy@example.com' })).status, 403);
  assert.equal((await cust.client.get(`/api/customers/${cust.customerId}`)).status, 403);
  assert.equal((await t.staff.get('/api/customers')).status, 200);
});

test('create validates and rejects duplicate emails', async () => {
  const bad = await t.staff.post('/api/customers', { name: 'A', email: 'nope', phone: 'abc' });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.name);
  assert.ok(bad.body.fields.email);
  assert.ok(bad.body.fields.phone);

  const ok = await t.staff.post('/api/customers', {
    name: 'Acme Buyer', email: 'Buyer@Acme.com', company_name: 'Acme Pvt Ltd', phone: '+91 98765 43210', city: 'Kochi',
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.email, 'buyer@acme.com');
  assert.equal(ok.body.country, 'India');
  assert.equal(ok.body.has_portal_access, false);

  const dup = await t.admin.post('/api/customers', { name: 'Acme Dup', email: 'BUYER@acme.com' });
  assert.equal(dup.status, 409);
  assert.ok(dup.body.fields.email);
});

test('list supports search, paging, sort and aggregates', async () => {
  for (let i = 1; i <= 5; i += 1) {
    await t.staff.post('/api/customers', { name: `Batch Customer ${i}`, email: `batch${i}@example.com`, company_name: 'Batchworks' });
  }
  const page1 = await t.staff.get('/api/customers?search=batchworks&limit=2&page=1&sort=name:desc');
  assert.equal(page1.status, 200);
  assert.equal(page1.body.total, 5);
  assert.equal(page1.body.pages, 3);
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.items[0].name, 'Batch Customer 5');

  const acme = (await t.staff.get('/api/customers?search=acme')).body.items[0];
  seedSubscription(acme.id, 'SUB/T/1', 'active');
  seedSubscription(acme.id, 'SUB/T/2', 'closed');
  seedInvoice(acme.id, 'INV/T/1', { total: 1000, paid: 250 });
  seedInvoice(acme.id, 'INV/T/2', { status: 'paid', total: 500, paid: 500 });
  seedInvoice(acme.id, 'INV/T/3', { status: 'draft', total: 700 });

  const row = (await t.staff.get('/api/customers?search=acme')).body.items[0];
  assert.equal(row.active_subscriptions, 1);
  assert.equal(row.outstanding_balance, 750);
  assert.equal(row.overdue_invoices, 1);

  const sorted = await t.staff.get('/api/customers?sort=balance:desc&limit=1');
  assert.equal(sorted.body.items[0].id, acme.id);
});

test('detail returns subscriptions, invoices and totals', async () => {
  const acme = (await t.staff.get('/api/customers?search=acme')).body.items[0];
  const res = await t.staff.get(`/api/customers/${acme.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.subscriptions.length, 2);
  assert.equal(res.body.invoices.length, 3);
  assert.equal(res.body.totals.active_subscriptions, 1);
  assert.equal(res.body.totals.invoiced, 1500);
  assert.equal(res.body.totals.paid, 750);
  assert.equal(res.body.totals.outstanding, 750);
  assert.equal(res.body.totals.overdue, 750);
  assert.equal((await t.staff.get('/api/customers/999999')).status, 404);
  assert.equal((await t.staff.get('/api/customers/abc')).status, 400);
});

test('update validates and keeps email unique', async () => {
  const list = (await t.staff.get('/api/customers?search=batch1@')).body.items;
  const id = list[0].id;
  const ok = await t.staff.put(`/api/customers/${id}`, { name: 'Batch One Renamed', email: 'batch1@example.com', city: 'Ernakulam' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, 'Batch One Renamed');
  assert.equal(ok.body.city, 'Ernakulam');
  const dup = await t.staff.put(`/api/customers/${id}`, { name: 'Batch One', email: 'batch2@example.com' });
  assert.equal(dup.status, 409);
  assert.equal((await t.staff.put('/api/customers/999999', { name: 'Ghost Here', email: 'g@example.com' })).status, 404);
});

test('delete is blocked when the customer has subscriptions or invoices', async () => {
  const acme = (await t.staff.get('/api/customers?search=acme')).body.items[0];
  assert.equal((await t.staff.delete(`/api/customers/${acme.id}`)).status, 409);
  const free = (await t.staff.get('/api/customers?search=batch5')).body.items[0];
  assert.equal((await t.staff.delete(`/api/customers/${free.id}`)).status, 204);
  assert.equal((await t.staff.get(`/api/customers/${free.id}`)).status, 404);
});

test('portal access: invite link or direct password, never twice', async () => {
  const { sent } = require('../src/utils/mailer');
  const c3 = (await t.staff.get('/api/customers?search=batch3')).body.items[0];
  const invite = await t.staff.post(`/api/customers/${c3.id}/portal-access`, {});
  assert.equal(invite.status, 201);
  assert.equal(invite.body.inviteSent, true);
  assert.equal(invite.body.user.role, 'customer');
  assert.equal(invite.body.user.customerId, c3.id);
  assert.equal(sent.at(-1).to, 'batch3@example.com');
  assert.match(invite.body.devInviteUrl, /reset-password\?token=/);

  const again = await t.staff.post(`/api/customers/${c3.id}/portal-access`, {});
  assert.equal(again.status, 409);

  // The invite link sets the password and the customer can log in.
  const token = new URL(invite.body.devInviteUrl).searchParams.get('token');
  assert.equal((await t.anon.post('/api/auth/reset-password', { token, password: 'Inv1ted!Pass' })).status, 200);
  const login = await t.client().post('/api/auth/login', { email: 'batch3@example.com', password: 'Inv1ted!Pass' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.customerId, c3.id);

  const c4 = (await t.staff.get('/api/customers?search=batch4')).body.items[0];
  const weak = await t.staff.post(`/api/customers/${c4.id}/portal-access`, { password: 'weak' });
  assert.equal(weak.status, 422);
  const direct = await t.staff.post(`/api/customers/${c4.id}/portal-access`, { password: 'Direct!Pass1' });
  assert.equal(direct.status, 201);
  assert.equal(direct.body.inviteSent, false);
  assert.equal((await t.client().post('/api/auth/login', { email: 'batch4@example.com', password: 'Direct!Pass1' })).status, 200);

  // Email already used by a staff login -> 409.
  const clash = await t.staff.post('/api/customers', { name: 'Staff Clash', email: 'staff@brightloop.test' });
  assert.equal(clash.status, 201);
  assert.equal((await t.staff.post(`/api/customers/${clash.body.id}/portal-access`, {})).status, 409);

  // Editing a customer keeps the linked login email in sync.
  const upd = await t.staff.put(`/api/customers/${c4.id}`, { name: 'Batch Four', email: 'batch4.new@example.com' });
  assert.equal(upd.status, 200);
  assert.equal((await t.client().post('/api/auth/login', { email: 'batch4.new@example.com', password: 'Direct!Pass1' })).status, 200);
});
