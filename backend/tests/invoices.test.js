'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { sent } = require('../src/utils/mailer');

let t;
let customer;
const ids = {};

test.before(async () => {
  t = await start();
  customer = t.makeUser({ name: 'Ivy Invoice', email: 'ivy@example.com', role: 'customer' });
  ids.crm = t.db.prepare("SELECT id FROM products WHERE name = 'Brightloop CRM'").get().id;
  ids.monthly = t.db.prepare("SELECT id FROM recurring_plans WHERE name = 'Monthly Basic'").get().id;
  ids.immediate = t.db.prepare("SELECT id FROM payment_terms WHERE name = 'Immediate'").get().id;
  const res = await t.admin.post('/api/subscriptions', {
    customer_id: customer.customerId, plan_id: ids.monthly, payment_term_id: ids.immediate,
    start_date: '2026-01-01', lines: [{ product_id: ids.crm, quantity: 1 }],
  });
  ids.sub = res.body.id;
  for (const a of ['confirm', 'activate']) await t.admin.post(`/api/subscriptions/${ids.sub}/actions/${a}`);
  const run = await t.admin.post('/api/billing/run', { date: '2026-03-15' });
  assert.equal(run.body.created, 3);
  ids.invoices = run.body.invoices.map((i) => i.id);
});

test.after(async () => { await t.close(); });

test('list with filters, balance and overdue, counts', async () => {
  let res = await t.staff.get('/api/invoices');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.counts.draft, 3);
  const row = res.body.items[0];
  assert.equal(row.balance_due, row.total_amount);
  assert.equal(row.customer_name, 'Ivy Invoice');
  assert.ok(row.subscription_number);

  res = await t.staff.get(`/api/invoices?subscription_id=${ids.sub}&from=2026-02-01&to=2026-02-28`);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].period_start, '2026-02-01');
  res = await t.staff.get('/api/invoices?search=ivy');
  assert.equal(res.body.total, 3);
  res = await t.staff.get('/api/invoices?search=nobody');
  assert.equal(res.body.total, 0);

  await t.staff.post(`/api/invoices/${ids.invoices[0]}/confirm`);
  res = await t.staff.get('/api/invoices?overdue=1');
  assert.equal(res.body.total, 1); // due 2026-01-01, confirmed, today is later
  assert.equal(res.body.items[0].is_overdue, 1);
  res = await t.staff.get('/api/invoices?status=overdue');
  assert.equal(res.body.total, 1);
});

test('detail shape: lines with taxes, breakdown, customer, payments', async () => {
  const res = await t.staff.get(`/api/invoices/${ids.invoices[1]}`);
  assert.equal(res.status, 200);
  const inv = res.body;
  assert.equal(inv.customer.email, 'ivy@example.com');
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].taxes[0].name, 'GST 18%');
  assert.deepEqual(inv.tax_breakdown, [{ name: 'GST 18%', rate: 18, base: 1200, amount: 216 }]);
  assert.equal(inv.total_amount, 1416);
  assert.equal(inv.balance_due, 1416);
  assert.deepEqual(inv.payments, []);
  assert.deepEqual(inv.discounts, []);
  assert.equal((await t.staff.get('/api/invoices/99999')).status, 404);
});

test('confirm / send / cancel state rules', async () => {
  const id = ids.invoices[1];
  // draft cannot be sent
  assert.equal((await t.staff.post(`/api/invoices/${id}/send`)).status, 409);
  let res = await t.staff.post(`/api/invoices/${id}/confirm`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'confirmed');
  assert.ok(res.body.confirmed_at);
  assert.equal((await t.staff.post(`/api/invoices/${id}/confirm`)).status, 409);

  res = await t.staff.post(`/api/invoices/${id}/send`);
  assert.equal(res.status, 200);
  assert.ok(res.body.sent_at);
  const mail = sent.find((m) => m.to === 'ivy@example.com' && m.subject.includes(res.body.number));
  assert.ok(mail);
  assert.ok(mail.text.includes(`/portal/invoices/${id}`));
  assert.ok(mail.html.includes('<table'));

  // paid invoices cannot be cancelled (simulate payments module)
  t.db.prepare("UPDATE invoices SET amount_paid = 100 WHERE id = ?").run(id);
  assert.equal((await t.staff.post(`/api/invoices/${id}/cancel`)).status, 409);
  t.db.prepare("UPDATE invoices SET amount_paid = 0 WHERE id = ?").run(id);

  res = await t.staff.post(`/api/invoices/${id}/cancel`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.ok(res.body.cancelled_at);
  assert.equal((await t.staff.post(`/api/invoices/${id}/cancel`)).status, 409);
  assert.equal((await t.staff.post(`/api/invoices/${id}/confirm`)).status, 409);
});

test('cancel with rebill frees the period and the next run bills it again', async () => {
  const id = ids.invoices[2];
  const before = t.db.prepare('SELECT period_start FROM invoices WHERE id = ?').get(id);
  const res = await t.admin.post(`/api/invoices/${id}/cancel`, { rebill: true });
  assert.equal(res.status, 200);
  const sub = t.db.prepare('SELECT next_invoice_date FROM subscriptions WHERE id = ?').get(ids.sub);
  assert.equal(sub.next_invoice_date, before.period_start);
  const run = await t.admin.post('/api/billing/run', { date: '2026-03-15' });
  assert.equal(run.body.created, 1);
  const live = t.db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE subscription_id = ? AND period_start = ? AND status <> 'cancelled'")
    .get(ids.sub, before.period_start).n;
  assert.equal(live, 1);
});

test('invoice roles: customer 403, anonymous 401', async () => {
  assert.equal((await customer.client.get('/api/invoices')).status, 403);
  assert.equal((await customer.client.post(`/api/invoices/${ids.invoices[0]}/confirm`)).status, 403);
  assert.equal((await t.anon.get('/api/invoices')).status, 401);
});

test('service contract: listInvoices / getInvoice with customerId filter', () => {
  const svc = require('../src/modules/invoices/invoices.service');
  const list = svc.listInvoices({ customerId: customer.customerId }, { page: 1, limit: 10 });
  assert.ok(list.total >= 3);
  const other = svc.listInvoices({ customerId: 99999 }, { page: 1, limit: 10 });
  assert.equal(other.total, 0);
  const inv = svc.getInvoice(ids.invoices[0]);
  assert.equal(inv.customer.id, customer.customerId);
});
