'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t;
let catalog;

test.before(async () => {
  t = await start();
  catalog = require('../src/modules/catalog/catalog.service');
});
test.after(async () => { await t.close(); });

const idOf = (table, name) => t.db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name).id;

function makeInvoice(number) {
  let cust = t.db.prepare("SELECT id FROM customers WHERE email = 'inv@test.dev'").get();
  if (!cust) {
    cust = { id: Number(t.db.prepare("INSERT INTO customers (name, email) VALUES ('Invoice Cust', 'inv@test.dev')").run().lastInsertRowid) };
  }
  return Number(t.db.prepare(`INSERT INTO invoices (number, customer_id, invoice_date, due_date)
    VALUES (?, ?, '2026-11-01', '2026-11-15')`).run(number, cust.id).lastInsertRowid);
}

function makeDiscount(fields) {
  const d = {
    discount_type: 'percent', value: 10, scope: 'subscription', min_purchase: 0, min_quantity: 0,
    start_date: null, end_date: null, usage_limit: null, is_active: 1, ...fields,
  };
  return Number(t.db.prepare(`INSERT INTO discounts
    (name, discount_type, value, scope, min_purchase, min_quantity, start_date, end_date, usage_limit, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.discount_type, d.value, d.scope, d.min_purchase,
    d.min_quantity, d.start_date, d.end_date, d.usage_limit, d.is_active).lastInsertRowid);
}

// ---------------------------------------------------------------------
// catalog.service.js contract
// ---------------------------------------------------------------------
test('getPrice: Odoo variant adds 560 to 1200 = 1760', () => {
  const crm = idOf('products', 'Brightloop CRM');
  const odoo = t.db.prepare(`SELECT v.id FROM product_variants v
    JOIN product_attribute_values av ON av.id = v.attribute_value_id
    WHERE v.product_id = ? AND av.name = 'Odoo'`).get(crm).id;
  assert.equal(catalog.getPrice(crm), 1200);
  assert.equal(catalog.getPrice(crm, odoo), 1760);
  const other = idOf('products', 'Brightloop Accounting');
  assert.throws(() => catalog.getPrice(other, odoo), (e) => e.status === 422);
  assert.throws(() => catalog.getPrice(99999), (e) => e.status === 404);
});

test('getProductTaxes, getPlan, getPaymentTerm, getTemplate', () => {
  const crm = idOf('products', 'Brightloop CRM');
  const taxes = catalog.getProductTaxes(crm);
  assert.deepEqual(taxes.map((x) => [x.name, x.computation, x.amount]), [['GST 18%', 'percent', 18]]);

  const plan = catalog.getPlan(idOf('recurring_plans', 'Yearly Business'));
  assert.equal(plan.billing_period, 'yearly');
  assert.equal(plan.min_quantity, 5);
  assert.equal(catalog.getPlan(99999), null);

  assert.deepEqual(catalog.getPaymentTerm(idOf('payment_terms', '30 Days')), { id: idOf('payment_terms', '30 Days'), name: '30 Days', due_days: 30 });
  assert.equal(catalog.getPaymentTerm(99999), null);

  const tpl = catalog.getTemplate(idOf('quotation_templates', 'Enterprise Yearly Bundle'));
  assert.equal(tpl.validity_days, 15);
  assert.equal(tpl.plan.name, 'Yearly Business');
  assert.equal(tpl.lines.length, 3);
  const crmLine = tpl.lines.find((l) => l.product_name === 'Brightloop CRM');
  assert.equal(crmLine.quantity, 10);
  assert.equal(crmLine.unit_price, 1200);
  assert.equal(crmLine.taxes[0].name, 'GST 18%');
  assert.equal(catalog.getTemplate(99999), null);
});

test('getApplicableDiscounts respects dates, minimums, scope and usage limit', () => {
  const crm = idOf('products', 'Brightloop CRM');
  const acc = idOf('products', 'Brightloop Accounting');
  const lines = [
    { product_id: crm, quantity: 2, amount: 2400 },
    { product_id: acc, quantity: 1, amount: 1500 },
  ];
  const date = '2026-11-10';
  makeDiscount({ name: 'T-Open' });
  makeDiscount({ name: 'T-Future', start_date: '2026-12-01' });
  makeDiscount({ name: 'T-Expired', end_date: '2026-11-01' });
  makeDiscount({ name: 'T-Inactive', is_active: 0 });
  makeDiscount({ name: 'T-MinPurchase-ok', min_purchase: 3900 });
  makeDiscount({ name: 'T-MinPurchase-no', min_purchase: 3901 });
  makeDiscount({ name: 'T-MinQty-ok', min_quantity: 3 });
  makeDiscount({ name: 'T-MinQty-no', min_quantity: 4 });
  const used = makeDiscount({ name: 'T-UsedUp', usage_limit: 1 });
  t.db.prepare('UPDATE discounts SET usage_count = 1 WHERE id = ?').run(used);
  const prodOk = makeDiscount({ name: 'T-Product-crm', scope: 'product', min_quantity: 2 });
  t.db.prepare('INSERT INTO discount_products VALUES (?, ?)').run(prodOk, crm);
  const prodMinNo = makeDiscount({ name: 'T-Product-crm-min3', scope: 'product', min_quantity: 3 });
  t.db.prepare('INSERT INTO discount_products VALUES (?, ?)').run(prodMinNo, crm);
  const prodOther = makeDiscount({ name: 'T-Product-storage', scope: 'product' });
  t.db.prepare('INSERT INTO discount_products VALUES (?, ?)').run(prodOther, idOf('products', 'Extra Storage 100 GB'));

  const names = catalog.getApplicableDiscounts({ subscriptionId: null, lines, date }).map((d) => d.name).sort();
  assert.deepEqual(names, ['T-MinPurchase-ok', 'T-MinQty-ok', 'T-Open', 'T-Product-crm']);
  const p = catalog.getApplicableDiscounts({ lines, date }).find((d) => d.name === 'T-Product-crm');
  assert.deepEqual(p.productIds, [crm]);
  assert.equal(p.scope, 'product');

  // tidy up so later tests are not affected
  t.db.prepare("UPDATE discounts SET is_active = 0 WHERE name LIKE 'T-%'").run();
});

test('recordDiscountUsage stops at the usage limit', () => {
  const id = makeDiscount({ name: 'Limit2', discount_type: 'fixed', value: 100, usage_limit: 2 });
  const inv = [makeInvoice('INV/T/1'), makeInvoice('INV/T/2'), makeInvoice('INV/T/3')];
  assert.equal(catalog.recordDiscountUsage(id, inv[0], 100), true);
  assert.equal(catalog.recordDiscountUsage(id, inv[0], 100), false, 'same invoice twice is ignored');
  assert.equal(catalog.recordDiscountUsage(id, inv[1], 100), true);
  assert.equal(catalog.recordDiscountUsage(id, inv[2], 100), false);
  const row = t.db.prepare('SELECT usage_count FROM discounts WHERE id = ?').get(id);
  assert.equal(row.usage_count, 2);
  const n = t.db.prepare('SELECT COUNT(*) AS n FROM discount_usages WHERE discount_id = ?').get(id).n;
  assert.equal(n, 2);
  assert.equal(catalog.getApplicableDiscounts({ lines: [{ product_id: 1, quantity: 1, amount: 10 }] })
    .some((d) => d.id === id), false);
  t.db.prepare('UPDATE discounts SET is_active = 0 WHERE id = ?').run(id);
});
