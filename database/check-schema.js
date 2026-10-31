// Sanity check for database/schema.sql + seed.sql.
// Run: node database/check-schema.js   (Node 22.13+, uses built-in node:sqlite)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
db.exec(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));

const fails = (sql, ...params) => assert.throws(() => db.prepare(sql).run(...params), undefined, sql);
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

check('seed data loaded', () => {
  const variant = db.prepare(`
    SELECT p.sales_price + v.extra_price AS price FROM product_variants v
    JOIN products p ON p.id = v.product_id
    JOIN product_attribute_values av ON av.id = v.attribute_value_id
    WHERE p.name = 'Brightloop CRM' AND av.name = 'Odoo'`).get();
  assert.equal(variant.price, 1760); // 1200 + 560
});

check('one account per email (case-insensitive)', () => {
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', 'admin@brightloop.test', 'x', 'admin')").run();
  fails("INSERT INTO users (name, email, password_hash) VALUES ('Dup', 'ADMIN@Brightloop.test', 'x')");
});

check('invalid role / status values rejected', () => {
  fails("INSERT INTO users (name, email, password_hash, role) VALUES ('Bad', 'bad@x.test', 'x', 'superuser')");
});

db.prepare("INSERT INTO customers (name, email) VALUES ('Small Shop', 'shop@x.test')").run();
db.prepare(`INSERT INTO subscriptions (number, customer_id, plan_id, status, start_date, next_invoice_date)
            VALUES ('SUB/2026/00001', 1, 3, 'active', '2026-10-01', '2026-11-01')`).run();

check('subscription status must be valid', () => {
  fails("UPDATE subscriptions SET status = 'archived' WHERE id = 1");
});

check('no double billing for the same subscription period', () => {
  const ins = db.prepare(`INSERT INTO invoices (number, subscription_id, customer_id, status, invoice_date, due_date, period_start, period_end, total_amount)
                          VALUES (?, 1, 1, ?, '2026-09-01', '2026-09-15', '2026-09-01', '2026-09-30', 1178.82)`);
  ins.run('INV/2026/00001', 'confirmed');
  assert.throws(() => ins.run('INV/2026/00002', 'draft'));
  // cancelling frees the period so it can be re-billed
  db.prepare("UPDATE invoices SET status = 'cancelled' WHERE number = 'INV/2026/00001'").run();
  ins.run('INV/2026/00003', 'confirmed');
});

check('cannot record more paid than invoiced / non-positive payments', () => {
  fails("UPDATE invoices SET amount_paid = 999999 WHERE number = 'INV/2026/00003'");
  fails("INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date) VALUES (3, 1, 'upi', 0, '2026-09-05')");
  fails("INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date) VALUES (3, 1, 'bitcoin', 10, '2026-09-05')");
});

check('discount usage can never exceed its limit', () => {
  db.prepare("INSERT INTO discounts (name, discount_type, value, usage_limit) VALUES ('10 seats', 'percent', 10, 1)").run();
  db.prepare("UPDATE discounts SET usage_count = usage_count + 1 WHERE name = '10 seats'").run();
  fails("UPDATE discounts SET usage_count = usage_count + 1 WHERE name = '10 seats'");
  fails("INSERT INTO discounts (name, discount_type, value) VALUES ('Too much', 'percent', 150)");
});

check('overdue view flags past-due confirmed invoices', () => {
  const row = db.prepare("SELECT is_overdue, balance_due FROM v_invoice_balances WHERE number = 'INV/2026/00003'").get();
  assert.equal(row.is_overdue, 1);
  assert.equal(row.balance_due, 1178.82);
});

console.log(`\nSchema OK - ${passed} checks passed.`);
