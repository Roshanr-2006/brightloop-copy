'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t;
let customerId;
let seq = 0;

function makeInvoice({ status = 'confirmed', total = 1180, paid = 0, invoiceDate = '2026-10-01', dueDate = '2026-10-15' } = {}) {
  seq += 1;
  const info = t.db.prepare(`
    INSERT INTO invoices (number, customer_id, status, invoice_date, due_date, untaxed_amount, tax_amount, total_amount, amount_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`TEST/PAY/${seq}`, customerId, status, invoiceDate, dueDate, total, 0, total, paid);
  return Number(info.lastInsertRowid);
}

const invoiceRow = (id) => t.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const pay = (client, invoiceId, amount, extra = {}) => client.post('/api/payments', {
  invoice_id: invoiceId, method: 'upi', amount, payment_date: '2026-10-20', ...extra,
});

test.before(async () => {
  process.env.TODAY = '2026-10-31';
  t = await start();
  customerId = Number(t.db.prepare("INSERT INTO customers (name, email) VALUES ('Pay Customer', 'pay@example.com')").run().lastInsertRowid);
});

test.after(async () => { await t.close(); });

test('anonymous and customers cannot use payments API', async () => {
  assert.equal((await t.anon.get('/api/payments')).status, 401);
  const cust = t.makeUser({ name: 'Portal Pay', email: 'portal-pay@example.com' });
  assert.equal((await cust.client.get('/api/payments')).status, 403);
  assert.equal((await pay(cust.client, makeInvoice(), 10)).status, 403);
});

test('validation errors', async () => {
  const res = await t.staff.post('/api/payments', { invoice_id: 'x', method: 'bitcoin', amount: -5, payment_date: '2099-01-01' });
  assert.equal(res.status, 422);
  assert.ok(res.body.fields.invoice_id);
  assert.ok(res.body.fields.method);
  assert.ok(res.body.fields.amount);
  assert.ok(res.body.fields.payment_date);
  const zero = await pay(t.staff, makeInvoice(), 0);
  assert.equal(zero.status, 422);
  const missing = await pay(t.staff, 999999, 10);
  assert.equal(missing.status, 404);
});

test('payment on a draft invoice -> 422', async () => {
  const id = makeInvoice({ status: 'draft' });
  const res = await pay(t.staff, id, 100);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'Confirm the invoice before recording a payment');
});

test('payment on cancelled or paid invoice -> 409', async () => {
  assert.equal((await pay(t.staff, makeInvoice({ status: 'cancelled' }), 100)).status, 409);
  assert.equal((await pay(t.staff, makeInvoice({ status: 'paid', paid: 1180 }), 100)).status, 409);
});

test('partial then full payment marks invoice paid', async () => {
  const id = makeInvoice({ total: 1180 });
  const first = await pay(t.staff, id, 500.4, { reference: 'UTR123', note: 'first part' });
  assert.equal(first.status, 201);
  assert.equal(first.body.amount, 500.4);
  assert.equal(first.body.customer_id, customerId);
  assert.equal(first.body.recorded_by, t.staffId);
  assert.equal(first.body.invoice_number, invoiceRow(id).number);
  let inv = invoiceRow(id);
  assert.equal(inv.status, 'confirmed');
  assert.equal(inv.amount_paid, 500.4);
  assert.equal(inv.paid_at, null);

  const second = await pay(t.staff, id, 679.6, { method: 'bank_transfer' });
  assert.equal(second.status, 201);
  inv = invoiceRow(id);
  assert.equal(inv.status, 'paid');
  assert.equal(inv.amount_paid, 1180);
  assert.ok(inv.paid_at);

  const list = await t.staff.get(`/api/payments?invoice_id=${id}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.total_amount, 1180);
  assert.ok(list.body.items[0].customer_name);

  const one = await t.staff.get(`/api/payments/${first.body.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.reference, 'UTR123');
});

test('overpayment -> 422 with fields.amount', async () => {
  const id = makeInvoice({ total: 1000, paid: 400 });
  const res = await pay(t.staff, id, 600.01);
  assert.equal(res.status, 422);
  assert.ok(res.body.fields.amount);
  assert.equal(invoiceRow(id).amount_paid, 400);
  assert.equal((await pay(t.staff, id, 600)).status, 201);
  assert.equal(invoiceRow(id).status, 'paid');
});

test('list filters: search, method, date range', async () => {
  const id = makeInvoice({ total: 300 });
  await pay(t.admin, id, 100, { method: 'cheque', reference: 'CHQ-998877', payment_date: '2026-09-05' });
  const byRef = await t.staff.get('/api/payments?search=CHQ-9988');
  assert.equal(byRef.body.total, 1);
  const byMethod = await t.staff.get('/api/payments?method=cheque');
  assert.ok(byMethod.body.items.every((p) => p.method === 'cheque'));
  const byDate = await t.staff.get('/api/payments?from=2026-09-01&to=2026-09-30');
  assert.equal(byDate.body.total, 1);
  const byCustomer = await t.staff.get(`/api/payments?customer_id=${customerId}&limit=1`);
  assert.equal(byCustomer.body.items.length, 1);
  assert.ok(byCustomer.body.pages >= 2);
});

test('admin can reverse a payment; staff cannot', async () => {
  const id = makeInvoice({ total: 200 });
  const p = await pay(t.staff, id, 200);
  assert.equal(invoiceRow(id).status, 'paid');

  const denied = await t.staff.delete(`/api/payments/${p.body.id}`);
  assert.equal(denied.status, 403);
  assert.equal(invoiceRow(id).status, 'paid');

  const res = await t.admin.delete(`/api/payments/${p.body.id}`);
  assert.equal(res.status, 200);
  const inv = invoiceRow(id);
  assert.equal(inv.status, 'confirmed');
  assert.equal(inv.amount_paid, 0);
  assert.equal(inv.paid_at, null);
  assert.equal((await t.admin.get(`/api/payments/${p.body.id}`)).status, 404);
  assert.equal((await t.admin.delete(`/api/payments/${p.body.id}`)).status, 404);
});
