'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t;
const ids = {};

function plan(name) {
  return t.db.prepare('SELECT id FROM recurring_plans WHERE name = ?').get(name).id;
}

function sub(number, customerId, planId, status, lineAmounts) {
  const id = Number(t.db.prepare(`
    INSERT INTO subscriptions (number, customer_id, plan_id, status, start_date) VALUES (?, ?, ?, ?, '2026-01-01')`)
    .run(number, customerId, planId, status).lastInsertRowid);
  for (const amount of lineAmounts) {
    t.db.prepare('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, amount) VALUES (?, 1, 1, ?, ?)')
      .run(id, amount, amount);
  }
  return id;
}

function inv(number, customerId, status, total, paid, invoiceDate, dueDate, subscriptionId = null) {
  return Number(t.db.prepare(`
    INSERT INTO invoices (number, customer_id, subscription_id, status, invoice_date, due_date, period_start,
                          untaxed_amount, total_amount, amount_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(number, customerId, subscriptionId, status, invoiceDate, dueDate, invoiceDate, total, total, paid).lastInsertRowid);
}

function payment(invoiceId, customerId, method, amount, date) {
  t.db.prepare('INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date) VALUES (?, ?, ?, ?, ?)')
    .run(invoiceId, customerId, method, amount, date);
}

test.before(async () => {
  process.env.TODAY = '2026-10-31';
  t = await start();
  const A = Number(t.db.prepare("INSERT INTO customers (name, email) VALUES ('Acme Corp', 'acme@example.com')").run().lastInsertRowid);
  const B = Number(t.db.prepare("INSERT INTO customers (name, email) VALUES ('Beta Ltd', 'beta@example.com')").run().lastInsertRowid);
  Object.assign(ids, { A, B });

  const monthly = plan('Monthly Basic');
  const yearly = plan('Yearly Business');
  const weekly = plan('Weekly Starter');
  ids.monthly = monthly;
  ids.S1 = sub('SUB/T/1', A, monthly, 'active', [1000, 200]); // MRR 1200
  sub('SUB/T/2', A, yearly, 'active', [12000]); //               MRR 1000
  sub('SUB/T/3', B, weekly, 'active', [120]); //                 MRR 520
  sub('SUB/T/4', B, monthly, 'paused', [5000]); //               not counted
  sub('SUB/T/5', A, monthly, 'draft', [700]); //                 not counted

  const I1 = inv('INV/T/1', A, 'paid', 1180, 1180, '2026-10-05', '2026-10-10', ids.S1);
  const I2 = inv('INV/T/2', A, 'confirmed', 2000, 500, '2026-10-10', '2026-10-20'); // 11 days overdue, bal 1500
  inv('INV/T/3', A, 'confirmed', 1000, 0, '2026-08-01', '2026-08-15', ids.S1); //     77 days, bal 1000
  inv('INV/T/4', A, 'confirmed', 300, 0, '2026-10-25', '2026-11-10'); //              not due yet
  inv('INV/T/5', A, 'draft', 999, 0, '2026-10-02', '2026-10-02');
  inv('INV/T/6', A, 'cancelled', 500, 0, '2026-10-03', '2026-10-03');
  inv('INV/T/7', B, 'confirmed', 400, 0, '2026-06-01', '2026-06-15'); //              138 days, bal 400
  inv('INV/T/8', B, 'confirmed', 250, 0, '2026-09-01', '2026-09-20'); //              41 days, bal 250
  payment(I1, A, 'upi', 1180, '2026-10-06');
  payment(I2, A, 'cash', 500, '2026-10-15');
});

test.after(async () => { await t.close(); });

test('reports are internal only', async () => {
  assert.equal((await t.anon.get('/api/reports/summary')).status, 401);
  const cust = t.makeUser({ name: 'Portal Rep', email: 'portal-rep@example.com' });
  for (const path of ['summary', 'revenue', 'overdue', 'payments-by-method', 'subscriptions-by-plan', 'top-customers']) {
    assert.equal((await cust.client.get(`/api/reports/${path}`)).status, 403, path);
  }
  assert.equal((await t.staff.get('/api/reports/summary')).status, 200);
});

test('summary numbers for October', async () => {
  const res = await t.admin.get('/api/reports/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(res.status, 200);
  const b = res.body;
  assert.deepEqual(b.subscriptions, { draft: 1, quotation: 0, confirmed: 0, active: 3, paused: 1, closed: 0, total: 5 });
  assert.equal(b.mrr, 2720);
  assert.equal(b.revenue.invoiced, 3480);
  assert.equal(b.revenue.collected, 1680);
  assert.equal(b.revenue.outstanding, 3450);
  assert.equal(b.revenue.overdue_amount, 3150);
  assert.equal(b.revenue.overdue_count, 4);
  assert.deepEqual(b.invoices, { draft: 1, confirmed: 2, paid: 1, cancelled: 1 });
  assert.equal(typeof b.generated_ms, 'number');
});

test('summary filters by customer and plan; bad dates -> 422', async () => {
  const byB = (await t.admin.get(`/api/reports/summary?customer_id=${ids.B}`)).body;
  assert.equal(byB.revenue.overdue_amount, 650);
  assert.equal(byB.mrr, 520);
  assert.equal(byB.subscriptions.total, 2);
  const byPlan = (await t.admin.get(`/api/reports/summary?plan_id=${ids.monthly}`)).body;
  assert.equal(byPlan.mrr, 1200);
  assert.equal(byPlan.revenue.invoiced, 2180); // INV/T/1 + INV/T/3 belong to the monthly subscription
  assert.equal(byPlan.revenue.collected, 1180);
  assert.equal((await t.admin.get('/api/reports/summary?from=2026-13-01')).status, 422);
  assert.equal((await t.admin.get('/api/reports/summary?from=2026-10-10&to=2026-10-01')).status, 422);
});

test('overdue detection, sorting and aging buckets', async () => {
  const res = await t.staff.get('/api/reports/overdue?limit=3');
  assert.equal(res.status, 200);
  const b = res.body;
  assert.equal(b.total, 4);
  assert.equal(b.pages, 2);
  assert.equal(b.total_balance, 3150);
  assert.deepEqual(b.items.map((i) => i.number), ['INV/T/7', 'INV/T/3', 'INV/T/8']);
  assert.deepEqual(b.items.map((i) => i.days_overdue), [138, 77, 41]);
  assert.equal(b.items[0].customer_name, 'Beta Ltd');
  assert.equal(b.items[0].balance, 400);
  const buckets = Object.fromEntries(b.buckets.map((x) => [x.key, [x.amount, x.count]]));
  assert.deepEqual(buckets, { '0-30': [1500, 1], '31-60': [250, 1], '61-90': [1000, 1], '90+': [400, 1] });
  const page2 = (await t.staff.get('/api/reports/overdue?limit=3&page=2')).body;
  assert.deepEqual(page2.items.map((i) => [i.number, i.days_overdue, i.balance]), [['INV/T/2', 11, 1500]]);
  const search = (await t.staff.get('/api/reports/overdue?search=beta')).body;
  assert.equal(search.total, 2);
});

test('revenue series by month', async () => {
  const res = await t.admin.get('/api/reports/revenue?months=3');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((r) => [r.month, r.invoiced, r.collected]), [
    ['2026-08', 1000, 0],
    ['2026-09', 250, 0],
    ['2026-10', 3480, 1680],
  ]);
  assert.equal(res.body.totals.invoiced, 4730);
  const ranged = (await t.admin.get('/api/reports/revenue?from=2026-06-01&to=2026-07-31')).body;
  assert.deepEqual(ranged.items.map((r) => [r.month, r.invoiced]), [['2026-06', 400], ['2026-07', 0]]);
});

test('payments by method, subscriptions by plan, top customers', async () => {
  const pm = (await t.admin.get('/api/reports/payments-by-method?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(pm.total, 1680);
  const upi = pm.items.find((r) => r.method === 'upi');
  assert.deepEqual([upi.amount, upi.count], [1180, 1]);
  assert.equal(pm.items.find((r) => r.method === 'cash').amount, 500);
  assert.equal(pm.items.find((r) => r.method === 'card').amount, 0);

  const sp = (await t.admin.get('/api/reports/subscriptions-by-plan')).body;
  const monthly = sp.items.find((r) => r.plan_id === ids.monthly);
  assert.deepEqual([monthly.total, monthly.active, monthly.paused, monthly.draft, monthly.mrr], [3, 1, 1, 1, 1200]);
  assert.equal(sp.mrr, 2720);
  assert.equal(sp.by_status.active, 3);

  const top = (await t.admin.get('/api/reports/top-customers?limit=5')).body;
  assert.deepEqual(top.items.map((r) => [r.customer_name, r.revenue]), [['Acme Corp', 4480], ['Beta Ltd', 650]]);
  assert.equal(top.items[0].outstanding, 2800);
});
