'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t;
let customer;
const ids = {};

test.before(async () => {
  t = await start();
  customer = t.makeUser({ name: 'Billy Customer', email: 'billy@example.com', role: 'customer' });
  const id = (sql, name) => t.db.prepare(sql).get(name).id;
  ids.crm = id('SELECT id FROM products WHERE name = ?', 'Brightloop CRM');
  ids.accounting = id('SELECT id FROM products WHERE name = ?', 'Brightloop Accounting');
  ids.storage = id('SELECT id FROM products WHERE name = ?', 'Extra Storage 100 GB');
  ids.monthly = id('SELECT id FROM recurring_plans WHERE name = ?', 'Monthly Basic');
  ids.daily = id('SELECT id FROM recurring_plans WHERE name = ?', 'Daily Trial');
  ids.term15 = id('SELECT id FROM payment_terms WHERE name = ?', '15 Days');
});

test.after(async () => { await t.close(); });

async function activeSub(over = {}) {
  const res = await t.admin.post('/api/subscriptions', {
    customer_id: customer.customerId,
    plan_id: ids.monthly,
    payment_term_id: ids.term15,
    start_date: '2026-01-10',
    lines: [{ product_id: ids.accounting, quantity: 1 }],
    ...over,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  for (const a of ['confirm', 'activate']) {
    const r = await t.admin.post(`/api/subscriptions/${res.body.id}/actions/${a}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return res.body;
}

const runAt = (date, extra = {}) => t.admin.post('/api/billing/run', { date, ...extra });
const invoicesOf = (subId) => t.db.prepare(
  "SELECT * FROM invoices WHERE subscription_id = ? AND status <> 'cancelled' ORDER BY period_start",
).all(subId);

test('billing creates an invoice with GST 18% and is idempotent', async () => {
  const sub = await activeSub();
  const preview = await t.staff.get('/api/billing/preview?date=2026-01-10');
  assert.equal(preview.status, 200);
  const p = preview.body.items.find((i) => i.id === sub.id);
  assert.equal(p.periods, 1);

  const res = await runAt('2026-01-10');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.created, 1);
  assert.equal(res.body.invoices[0].customer_name, 'Billy Customer');
  const [inv] = invoicesOf(sub.id);
  assert.equal(inv.status, 'draft');
  assert.equal(inv.period_start, '2026-01-10');
  assert.equal(inv.period_end, '2026-02-09');
  assert.equal(inv.invoice_date, '2026-01-10');
  assert.equal(inv.due_date, '2026-01-25');
  assert.equal(inv.untaxed_amount, 1500);
  assert.equal(inv.tax_amount, 270);
  assert.equal(inv.total_amount, 1770);
  assert.equal(inv.created_by, t.adminId);
  const tax = t.db.prepare(`SELECT lt.* FROM invoice_line_taxes lt JOIN invoice_lines l ON l.id = lt.line_id
    WHERE l.invoice_id = ?`).all(inv.id);
  assert.deepEqual(tax.map((x) => [x.tax_name, x.rate, x.amount]), [['GST 18%', 18, 270]]);

  const sub2 = t.db.prepare('SELECT next_invoice_date FROM subscriptions WHERE id = ?').get(sub.id);
  assert.equal(sub2.next_invoice_date, '2026-02-10');

  const again = await runAt('2026-01-10');
  assert.equal(again.body.created, 0);
  const again2 = await runAt('2026-01-31');
  assert.equal(again2.body.created, 0);
  assert.equal(invoicesOf(sub.id).length, 1);
});

test('unique index prevents double billing even if next_invoice_date is rewound', async () => {
  const sub = await activeSub({ start_date: '2026-03-01' });
  await runAt('2026-03-01');
  t.db.prepare("UPDATE subscriptions SET next_invoice_date = '2026-03-01' WHERE id = ?").run(sub.id);
  const res = await runAt('2026-03-01');
  assert.equal(res.body.errors.length, 0);
  assert.equal(invoicesOf(sub.id).length, 1);
  assert.ok(res.body.skipped >= 1);
});

test('catch-up creates one invoice per missed period, nothing skipped', async () => {
  const sub = await activeSub({ start_date: '2026-01-31' });
  const res = await runAt('2026-05-15', { auto_confirm: true });
  const mine = res.body.invoices.filter((i) => i.subscription_id === sub.id);
  assert.equal(mine.length, 4);
  const rows = invoicesOf(sub.id);
  assert.deepEqual(rows.map((r) => r.period_start), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.ok(rows.every((r) => r.status === 'confirmed' && r.confirmed_at));
  // contiguous periods: each end is the day before the next start
  for (let i = 0; i < rows.length - 1; i += 1) {
    const end = new Date(`${rows[i].period_end}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    assert.equal(end.toISOString().slice(0, 10), rows[i + 1].period_start);
  }
  const numbers = new Set(rows.map((r) => r.number));
  assert.equal(numbers.size, 4);
});

test('percent product discount and fixed subscription discount, usage limit respected', async () => {
  const sub = await activeSub({
    start_date: '2026-06-01',
    lines: [{ product_id: ids.crm, quantity: 2 }, { product_id: ids.storage, quantity: 2 }],
  });
  const ins = t.db.prepare(`INSERT INTO discounts (name, discount_type, value, scope, start_date, end_date, usage_limit, created_by)
    VALUES (?, ?, ?, ?, '2026-06-01', '2026-12-31', ?, ?)`);
  const pct = Number(ins.run('CRM 10% off', 'percent', 10, 'product', null, t.adminId).lastInsertRowid);
  t.db.prepare('INSERT INTO discount_products (discount_id, product_id) VALUES (?, ?)').run(pct, ids.crm);
  const fixed = Number(ins.run('Welcome 300', 'fixed', 300, 'subscription', 1, t.adminId).lastInsertRowid);
  t.db.prepare('INSERT INTO discount_subscriptions (discount_id, subscription_id) VALUES (?, ?)').run(fixed, sub.id);

  await runAt('2026-07-01');
  const rows = invoicesOf(sub.id);
  assert.equal(rows.length, 2);
  const [june, july] = rows;
  // June: CRM 2400 - 240 (10%) = 2160, storage 500; fixed 300 spread over 2660 remaining.
  const juneLines = t.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(june.id);
  assert.equal(june.discount_amount, 540);
  assert.equal(june.untaxed_amount, 2900 - 540);
  assert.equal(juneLines[0].discount_amount + juneLines[1].discount_amount, 540);
  assert.ok(Math.abs(juneLines[0].discount_amount - (240 + 243.61)) < 0.02);
  assert.equal(june.tax_amount, Math.round(2360 * 18) / 100);
  assert.equal(june.total_amount, Math.round((2360 + 424.8) * 100) / 100);
  // July: fixed discount used up (limit 1); percent still applies.
  assert.equal(july.discount_amount, 240);
  const usage = t.db.prepare('SELECT usage_count FROM discounts WHERE id = ?').get(fixed).usage_count;
  assert.equal(usage, 1);
  const detail = await t.staff.get(`/api/invoices/${june.id}`);
  assert.deepEqual(detail.body.discounts.map((d) => d.name).sort(), ['CRM 10% off', 'Welcome 300']);
  // tidy up so later tests are not affected
  t.db.prepare('UPDATE discounts SET is_active = 0').run();
});

test('fixed product discount is capped at the line gross', async () => {
  const sub = await activeSub({ start_date: '2026-08-01', lines: [{ product_id: ids.storage, quantity: 1 }] });
  const id = Number(t.db.prepare(`INSERT INTO discounts (name, discount_type, value, scope) VALUES ('Huge', 'fixed', 1000, 'product')`).run().lastInsertRowid);
  t.db.prepare('INSERT INTO discount_products (discount_id, product_id) VALUES (?, ?)').run(id, ids.storage);
  await runAt('2026-08-01');
  const [inv] = invoicesOf(sub.id);
  assert.equal(inv.discount_amount, 250);
  assert.equal(inv.total_amount, 0);
  t.db.prepare('UPDATE discounts SET is_active = 0').run();
});

test('auto-close plan closes after expiry once the last period is billed', async () => {
  const sub = await activeSub({
    plan_id: ids.daily, start_date: '2026-09-01', expiry_date: '2026-09-03',
    lines: [{ product_id: ids.storage, quantity: 1 }],
  });
  const res = await runAt('2026-09-10');
  assert.equal(res.body.invoices.filter((i) => i.subscription_id === sub.id).length, 3);
  assert.ok(res.body.closed >= 1);
  const row = t.db.prepare('SELECT status, close_reason FROM subscriptions WHERE id = ?').get(sub.id);
  assert.equal(row.status, 'closed');
  const hist = t.db.prepare('SELECT * FROM subscription_status_history WHERE subscription_id = ? ORDER BY id DESC').get(sub.id);
  assert.equal(hist.note, 'Expired (auto-close)');
  assert.equal(invoicesOf(sub.id).length, 3);
});

test('paused subscriptions are not billed; generate invoice now bills next period', async () => {
  const sub = await activeSub({ start_date: '2026-10-01' });
  await t.admin.post(`/api/subscriptions/${sub.id}/actions/pause`);
  await runAt('2026-10-05');
  assert.equal(invoicesOf(sub.id).length, 0);
  assert.equal((await t.admin.post(`/api/subscriptions/${sub.id}/invoice`)).status, 409);
  await t.admin.post(`/api/subscriptions/${sub.id}/actions/resume`);
  const now = await t.staff.post(`/api/subscriptions/${sub.id}/invoice`);
  assert.equal(now.status, 201, JSON.stringify(now.body));
  assert.equal(now.body.period_start, '2026-10-01');
  const again = await t.staff.post(`/api/subscriptions/${sub.id}/invoice`);
  assert.equal(again.body.period_start, '2026-11-01');
  const run = await runAt('2026-11-20');
  assert.equal(run.body.invoices.filter((i) => i.subscription_id === sub.id).length, 0);
  const detail = await t.staff.get(`/api/subscriptions/${sub.id}`);
  assert.equal(detail.body.invoices.length, 2);
});

test('billing roles: staff allowed, customer 403', async () => {
  assert.equal((await t.staff.post('/api/billing/run', { date: '2026-01-01' })).status, 200);
  assert.equal((await customer.client.post('/api/billing/run', {})).status, 403);
  assert.equal((await customer.client.get('/api/billing/preview')).status, 403);
  assert.equal((await t.admin.post('/api/billing/run', { date: '2026-13-45' })).status, 422);
});

test('billing run handles hundreds of due subscriptions quickly', async () => {
  const insert = t.db.prepare(`INSERT INTO subscriptions (number, customer_id, plan_id, payment_term_id, status, start_date, next_invoice_date)
    VALUES (?, ?, ?, ?, 'active', '2027-01-01', '2027-01-01')`);
  const line = t.db.prepare(`INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, amount)
    VALUES (?, ?, 1, 1500, 1500)`);
  const tax = t.db.prepare("INSERT INTO subscription_line_taxes (line_id, tax_id) SELECT ?, id FROM taxes WHERE name = 'GST 18%'");
  t.db.exec('BEGIN');
  for (let i = 0; i < 500; i += 1) {
    const id = Number(insert.run(`LOAD/${i}`, customer.customerId, ids.monthly, ids.term15).lastInsertRowid);
    tax.run(Number(line.run(id, ids.accounting).lastInsertRowid));
  }
  t.db.exec('COMMIT');
  const t0 = Date.now();
  const res = await runAt('2027-01-01');
  const ms = Date.now() - t0;
  assert.ok(res.body.created >= 500);
  assert.equal(res.body.errors.length, 0);
  assert.ok(ms < 10000, `took ${ms}ms`);
});
