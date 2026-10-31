'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t;
let customer;
const ids = {};

test.before(async () => {
  t = await start();
  customer = t.makeUser({ name: 'Asha Customer', email: 'asha@example.com', role: 'customer' });
  const id = (sql, name) => t.db.prepare(sql).get(name).id;
  ids.crm = id('SELECT id FROM products WHERE name = ?', 'Brightloop CRM');
  ids.accounting = id('SELECT id FROM products WHERE name = ?', 'Brightloop Accounting');
  ids.support = id('SELECT id FROM products WHERE name = ?', 'Priority Support');
  ids.monthly = id('SELECT id FROM recurring_plans WHERE name = ?', 'Monthly Basic');
  ids.yearly = id('SELECT id FROM recurring_plans WHERE name = ?', 'Yearly Business');
  ids.festive = id('SELECT id FROM recurring_plans WHERE name = ?', 'Festive Offer');
  ids.term30 = id('SELECT id FROM payment_terms WHERE name = ?', '30 Days');
  ids.template = id('SELECT id FROM quotation_templates WHERE name = ?', 'Enterprise Yearly Bundle');
  ids.odoo = t.db.prepare(`
    SELECT v.id FROM product_variants v JOIN product_attribute_values av ON av.id = v.attribute_value_id
    WHERE v.product_id = ? AND av.name = 'Odoo'`).get(ids.crm).id;
  ids.otherVariant = t.db.prepare('INSERT INTO product_variants (product_id, attribute_value_id, extra_price) VALUES (?, ?, 10)')
    .run(ids.accounting, t.db.prepare("SELECT id FROM product_attribute_values WHERE name = 'Odoo'").get().id).lastInsertRowid;
});

test.after(async () => { await t.close(); });

const monthlyBody = (over = {}) => ({
  customer_id: customer.customerId,
  plan_id: ids.monthly,
  payment_term_id: ids.term30,
  start_date: '2026-11-01',
  notes: 'Test',
  lines: [{ product_id: ids.crm, variant_id: ids.odoo, quantity: 2 }],
  ...over,
});

test('create draft with catalog defaults (price + variant, GST 18%)', async () => {
  const res = await t.admin.post('/api/subscriptions', monthlyBody());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const s = res.body;
  assert.match(s.number, /^SUB\/\d{4}\/\d{5}$/);
  assert.equal(s.status, 'draft');
  assert.equal(s.salesperson_id, t.adminId);
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].unit_price, 1760); // 1200 + 560 (Odoo)
  assert.equal(s.lines[0].amount, 3520);
  assert.equal(s.lines[0].taxes[0].name, 'GST 18%');
  assert.deepEqual(s.totals, { untaxed: 3520, tax: 633.6, total: 4153.6 });
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].to_status, 'draft');
  assert.deepEqual(s.allowed_actions, ['send', 'confirm']);
});

test('create from template copies plan, payment term, lines and validity', async () => {
  const pre = await t.staff.get(`/api/subscriptions/from-template/${ids.template}`);
  assert.equal(pre.status, 200);
  assert.equal(pre.body.plan_id, ids.yearly);
  assert.equal(pre.body.lines.length, 3);

  const res = await t.staff.post('/api/subscriptions', {
    customer_id: customer.customerId, template_id: ids.template, start_date: '2026-11-01',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.plan_id, ids.yearly);
  assert.equal(res.body.payment_term_id, ids.term30);
  assert.equal(res.body.lines.length, 3);
  assert.ok(res.body.quotation_valid_until);
  assert.equal(res.body.template_id, ids.template);
  assert.equal(res.body.created_by, t.staffId);
});

test('validations: min quantity, plan availability, expiry, variant, required fields', async () => {
  let res = await t.admin.post('/api/subscriptions', monthlyBody({
    plan_id: ids.yearly, lines: [{ product_id: ids.crm, quantity: 2 }],
  }));
  assert.equal(res.status, 422);
  assert.ok(res.body.fields['lines.0.quantity']);

  res = await t.admin.post('/api/subscriptions', monthlyBody({ plan_id: ids.festive, start_date: '2026-09-15' }));
  assert.equal(res.status, 422);
  assert.ok(res.body.fields.start_date);
  res = await t.admin.post('/api/subscriptions', monthlyBody({ plan_id: ids.festive, start_date: '2027-01-15' }));
  assert.equal(res.status, 422);

  res = await t.admin.post('/api/subscriptions', monthlyBody({ expiry_date: '2026-10-01' }));
  assert.equal(res.status, 422);
  assert.ok(res.body.fields.expiry_date);

  res = await t.admin.post('/api/subscriptions', monthlyBody({
    lines: [{ product_id: ids.crm, variant_id: ids.otherVariant, quantity: 1 }],
  }));
  assert.equal(res.status, 422);
  assert.ok(res.body.fields['lines.0.variant_id']);

  res = await t.admin.post('/api/subscriptions', { start_date: 'nope', lines: [] });
  assert.equal(res.status, 422);
  assert.ok(res.body.fields.customer_id && res.body.fields.plan_id && res.body.fields.start_date && res.body.fields.lines);
});

test('full lifecycle with history, illegal transitions are 409', async () => {
  const { body: s } = await t.admin.post('/api/subscriptions', monthlyBody({ start_date: '2026-11-05' }));
  const act = (a, b) => t.staff.post(`/api/subscriptions/${s.id}/actions/${a}`, b);

  assert.equal((await act('activate')).status, 409); // draft -> active not allowed
  assert.equal((await act('pause')).status, 409);

  let res = await act('send');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'quotation');
  const { sent } = require('../src/utils/mailer');
  assert.ok(sent.some((m) => m.to === 'asha@example.com' && m.subject.includes(s.number)));
  assert.equal((await act('send')).status, 409);

  // Quotation may still be edited
  res = await t.staff.put(`/api/subscriptions/${s.id}`, monthlyBody({ start_date: '2026-11-05', lines: [{ product_id: ids.crm, quantity: 3 }] }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.lines[0].quantity, 3);
  assert.equal(res.body.lines[0].unit_price, 1200);

  res = await act('confirm');
  assert.equal(res.body.status, 'confirmed');
  res = await t.staff.put(`/api/subscriptions/${s.id}`, monthlyBody());
  assert.equal(res.status, 409);
  assert.equal((await t.admin.delete(`/api/subscriptions/${s.id}`)).status, 409);

  res = await act('activate');
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.next_invoice_date, '2026-11-05');

  res = await act('pause', { note: 'Customer travelling' });
  assert.equal(res.body.status, 'paused');
  res = await act('resume');
  assert.equal(res.body.status, 'active');

  res = await act('renew');
  assert.equal(res.status, 200);
  assert.ok(res.body.expiry_date);

  res = await act('close', { reason: 'Customer left' });
  assert.equal(res.body.status, 'closed');
  assert.equal(res.body.close_reason, 'Customer left');
  assert.ok(res.body.closed_at);
  assert.equal((await act('resume')).status, 409);
  assert.equal((await act('activate')).status, 409);
  assert.equal((await act('explode')).status, 400);

  const statuses = res.body.history.map((h) => h.to_status);
  assert.deepEqual(statuses, ['draft', 'quotation', 'confirmed', 'active', 'paused', 'active', 'active', 'closed']);
  assert.ok(res.body.history.every((h) => h.changed_by));
});

test('renew extends expiry by one billing period', async () => {
  const { body: s } = await t.admin.post('/api/subscriptions', monthlyBody({ expiry_date: '2027-01-31' }));
  for (const a of ['confirm', 'activate']) await t.admin.post(`/api/subscriptions/${s.id}/actions/${a}`);
  const res = await t.admin.post(`/api/subscriptions/${s.id}/actions/renew`);
  assert.equal(res.body.expiry_date, '2027-02-28');
});

test('yearly business plan cannot be paused or closed', async () => {
  const res0 = await t.admin.post('/api/subscriptions', monthlyBody({
    plan_id: ids.yearly, lines: [{ product_id: ids.crm, quantity: 5 }, { product_id: ids.support, quantity: 1 }],
  }));
  assert.equal(res0.status, 201, JSON.stringify(res0.body));
  const s = res0.body;
  for (const a of ['confirm', 'activate']) await t.admin.post(`/api/subscriptions/${s.id}/actions/${a}`);
  assert.equal((await t.admin.post(`/api/subscriptions/${s.id}/actions/pause`)).status, 409);
  assert.equal((await t.admin.post(`/api/subscriptions/${s.id}/actions/close`)).status, 409);
  const detail = await t.admin.get(`/api/subscriptions/${s.id}`);
  assert.deepEqual(detail.body.allowed_actions, ['renew']);
});

test('expired quotation cannot be confirmed', async () => {
  const { body: s } = await t.admin.post('/api/subscriptions', {
    customer_id: customer.customerId, template_id: ids.template, start_date: '2026-11-01',
  });
  t.db.prepare("UPDATE subscriptions SET quotation_valid_until = '2020-01-01' WHERE id = ?").run(s.id);
  const res = await t.admin.post(`/api/subscriptions/${s.id}/actions/confirm`);
  assert.equal(res.status, 409);
});

test('delete only drafts', async () => {
  const { body: s } = await t.admin.post('/api/subscriptions', monthlyBody());
  assert.equal((await t.admin.delete(`/api/subscriptions/${s.id}`)).status, 204);
  assert.equal((await t.admin.get(`/api/subscriptions/${s.id}`)).status, 404);
});

test('list: paging, filters, search, totals, counts', async () => {
  let res = await t.staff.get('/api/subscriptions?limit=2');
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 2);
  assert.ok(res.body.total >= 5);
  assert.ok(res.body.counts.all >= 5);
  const row = res.body.items[0];
  assert.ok('customer_name' in row && 'plan_name' in row && 'recurring_total' in row);

  res = await t.staff.get(`/api/subscriptions?plan_id=${ids.yearly}`);
  assert.ok(res.body.items.every((s) => s.plan_id === ids.yearly));
  res = await t.staff.get('/api/subscriptions?status=closed');
  assert.ok(res.body.items.length >= 1 && res.body.items.every((s) => s.status === 'closed'));
  res = await t.staff.get('/api/subscriptions?search=asha');
  assert.ok(res.body.total >= 5);
  res = await t.staff.get('/api/subscriptions?search=zzz_nobody');
  assert.equal(res.body.total, 0);
});

test('roles: anonymous 401, customer 403', async () => {
  assert.equal((await t.anon.get('/api/subscriptions')).status, 401);
  assert.equal((await customer.client.get('/api/subscriptions')).status, 403);
  assert.equal((await customer.client.post('/api/subscriptions', monthlyBody())).status, 403);
});

test('list stays fast with 5,000 subscriptions', async () => {
  const insert = t.db.prepare(`INSERT INTO subscriptions (number, customer_id, plan_id, status, start_date)
    VALUES (?, ?, ?, 'active', '2026-01-01')`);
  const line = t.db.prepare(`INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, amount)
    VALUES (?, ?, 1, 100, 100)`);
  t.db.exec('BEGIN');
  for (let i = 0; i < 5000; i += 1) {
    const id = Number(insert.run(`BULK/${i}`, customer.customerId, ids.monthly).lastInsertRowid);
    line.run(id, ids.crm);
  }
  t.db.exec('COMMIT');
  const t0 = Date.now();
  const res = await t.staff.get('/api/subscriptions?search=BULK&status=active&page=3');
  const ms = Date.now() - t0;
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 5000);
  assert.ok(ms < 2000, `took ${ms}ms`);
});
