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

// ---------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------
test('roles: staff can read but not write, customers are blocked, anon is 401', async () => {
  const r1 = await t.staff.get('/api/catalog/taxes');
  assert.equal(r1.status, 200);
  assert.ok(r1.body.items.length >= 3);
  assert.deepEqual(Object.keys(r1.body).sort(), ['items', 'limit', 'page', 'pages', 'total']);
  assert.equal((await t.staff.post('/api/catalog/taxes', { name: 'Staff tax', amount: 5 })).status, 403);
  assert.equal((await t.staff.get('/api/catalog/payment-terms')).status, 200);
  assert.equal((await t.staff.post('/api/catalog/payment-terms', { name: 'Net 7', due_days: 7 })).status, 403);

  const cust = t.makeUser({ name: 'Portal Pat', email: 'pat@test.dev', role: 'customer' });
  assert.equal((await cust.client.get('/api/catalog/taxes')).status, 403);
  assert.equal((await t.anon.get('/api/catalog/taxes')).status, 401);
});

// ---------------------------------------------------------------------
// Taxes + payment terms
// ---------------------------------------------------------------------
test('taxes: validation, unique names, archive instead of delete when referenced', async () => {
  const bad = await t.admin.post('/api/catalog/taxes', { name: 'Huge', computation: 'percent', amount: 150 });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.amount);

  const ok = await t.admin.post('/api/catalog/taxes', { name: 'Cess 2%', computation: 'percent', amount: 2 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.amount, 2);
  const fixed = await t.admin.post('/api/catalog/taxes', { name: 'Eco fee', computation: 'fixed', amount: 150 });
  assert.equal(fixed.status, 201);

  const dup = await t.admin.post('/api/catalog/taxes', { name: 'cess 2%', amount: 3 });
  assert.equal(dup.status, 409);

  const upd = await t.admin.put(`/api/catalog/taxes/${ok.body.id}`, { name: 'Cess 3%', computation: 'percent', amount: 3 });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.name, 'Cess 3%');

  // unreferenced tax can be deleted
  assert.equal((await t.admin.delete(`/api/catalog/taxes/${ok.body.id}`)).status, 204);

  // GST 18% is used by products -> 409, archive works
  const gst = idOf('taxes', 'GST 18%');
  const del = await t.admin.delete(`/api/catalog/taxes/${gst}`);
  assert.equal(del.status, 409);
  assert.match(del.body.error, /Archive/);
  const arch = await t.admin.patch(`/api/catalog/taxes/${gst}/archive`);
  assert.equal(arch.body.is_active, 0);
  const active = await t.admin.get('/api/catalog/taxes?active=1&limit=100');
  assert.equal(active.body.items.some((x) => x.id === gst), false);
  assert.equal((await t.admin.patch(`/api/catalog/taxes/${gst}/restore`)).body.is_active, 1);

  const search = await t.staff.get('/api/catalog/taxes?search=GST&sort=amount:desc');
  assert.deepEqual(search.body.items.map((x) => x.name), ['GST 18%', 'GST 12%', 'GST 5%']);
});

test('payment terms: due days >= 0, CRUD', async () => {
  const bad = await t.admin.post('/api/catalog/payment-terms', { name: 'Negative', due_days: -1 });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.due_days);
  const ok = await t.admin.post('/api/catalog/payment-terms', { name: 'Net 7', due_days: 7 });
  assert.equal(ok.status, 201);
  assert.equal((await t.admin.get(`/api/catalog/payment-terms/${ok.body.id}`)).body.due_days, 7);
  const term30 = idOf('payment_terms', '30 Days');
  assert.equal((await t.admin.delete(`/api/catalog/payment-terms/${term30}`)).status, 409, 'used by the seeded template');
  assert.equal((await t.admin.delete(`/api/catalog/payment-terms/${ok.body.id}`)).status, 204);
});

// ---------------------------------------------------------------------
// Products, variants, attributes
// ---------------------------------------------------------------------
test('attributes: create with values, add/rename/delete value, 409 when used', async () => {
  const a = await t.admin.post('/api/catalog/attributes', { name: 'Edition', values: ['Standard', 'Pro'] });
  assert.equal(a.status, 201);
  assert.deepEqual(a.body.values.map((v) => v.name), ['Pro', 'Standard']);
  assert.equal((await t.staff.post('/api/catalog/attributes', { name: 'Nope' })).status, 403);
  const v = await t.admin.post(`/api/catalog/attributes/${a.body.id}/values`, { name: 'Enterprise' });
  assert.equal(v.status, 201);
  assert.equal((await t.admin.post(`/api/catalog/attributes/${a.body.id}/values`, { name: 'enterprise' })).status, 409);
  const ren = await t.admin.put(`/api/catalog/attributes/${a.body.id}/values/${v.body.id}`, { name: 'Ultimate' });
  assert.equal(ren.body.name, 'Ultimate');
  assert.equal((await t.admin.delete(`/api/catalog/attributes/${a.body.id}/values/${v.body.id}`)).status, 204);
  const list = await t.staff.get('/api/catalog/attributes');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.find((x) => x.name === 'Brand').values.length >= 2);
  const brand = list.body.items.find((x) => x.name === 'Brand');
  assert.equal((await t.admin.delete(`/api/catalog/attributes/${brand.id}`)).status, 409);
});

test('products: create with taxes + variants in one go, final prices, update, options', async () => {
  const brand = (await t.admin.get('/api/catalog/attributes')).body.items.find((x) => x.name === 'Brand');
  const odoo = brand.values.find((v) => v.name === 'Odoo').id;
  const bl = brand.values.find((v) => v.name === 'Brightloop').id;
  const gst = idOf('taxes', 'GST 18%');

  const bad = await t.admin.post('/api/catalog/products', {
    name: 'X', sales_price: -5, variants: [{ attribute_value_id: odoo }, { attribute_value_id: odoo }],
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.name && bad.body.fields.sales_price && bad.body.fields['variants.1.attribute_value_id']);

  const res = await t.admin.post('/api/catalog/products', {
    name: 'Helpdesk', type: 'service', sales_price: 1200, cost_price: 200, tax_ids: [gst],
    variants: [{ attribute_value_id: odoo, extra_price: 560 }, { attribute_value_id: bl, extra_price: 0 }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.taxes[0].name, 'GST 18%');
  const ov = res.body.variants.find((v) => v.value_name === 'Odoo');
  assert.equal(ov.name, 'Brand: Odoo');
  assert.equal(ov.final_price, 1760);
  assert.equal(catalog.getPrice(res.body.id, ov.id), 1760);

  assert.equal((await t.admin.post('/api/catalog/products', { name: 'helpdesk', sales_price: 1 })).status, 409);

  // update: drop the Brightloop variant, change Odoo extra, remove taxes
  const upd = await t.admin.put(`/api/catalog/products/${res.body.id}`, {
    name: 'Helpdesk Pro', type: 'service', sales_price: 1300, tax_ids: [],
    variants: [{ id: ov.id, attribute_value_id: odoo, extra_price: 600 }],
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.variants.length, 1);
  assert.equal(upd.body.variants[0].final_price, 1900);
  assert.deepEqual(upd.body.taxes, []);

  const staffGet = await t.staff.get(`/api/catalog/products/${res.body.id}`);
  assert.equal(staffGet.status, 200);
  assert.equal((await t.staff.put(`/api/catalog/products/${res.body.id}`, { name: 'Hack', sales_price: 1 })).status, 403);

  const list = await t.staff.get('/api/catalog/products?type=service&search=help&with=variants');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].variants[0].final_price, 1900);

  const opts = await t.staff.get('/api/catalog/products/options');
  const crm = opts.body.items.find((p) => p.name === 'Brightloop CRM');
  assert.deepEqual(crm.variants.map((v) => v.final_price).sort(), [1200, 1760]);
  assert.equal(crm.taxes[0].name, 'GST 18%');

  // unreferenced -> hard delete
  assert.equal((await t.admin.delete(`/api/catalog/products/${res.body.id}`)).status, 204);
});

test('products: referenced product must be archived, referenced variant is deactivated', async () => {
  const crm = idOf('products', 'Brightloop CRM');
  const del = await t.admin.delete(`/api/catalog/products/${crm}`);
  assert.equal(del.status, 409, 'used by the seeded template');
  assert.match(del.body.error, /Archive/);
  const arch = await t.admin.patch(`/api/catalog/products/${crm}/archive`);
  assert.equal(arch.body.is_active, 0);
  const opts = await t.staff.get('/api/catalog/products/options');
  assert.equal(opts.body.items.some((p) => p.id === crm), false);
  await t.admin.patch(`/api/catalog/products/${crm}/restore`);

  // a template line uses the Odoo variant -> removing it from the product deactivates it
  const prod = (await t.admin.get(`/api/catalog/products/${crm}`)).body;
  const odooV = prod.variants.find((v) => v.value_name === 'Odoo');
  const blV = prod.variants.find((v) => v.value_name === 'Brightloop');
  const tplId = idOf('quotation_templates', 'Enterprise Yearly Bundle');
  t.db.prepare('UPDATE quotation_template_lines SET variant_id = ? WHERE template_id = ? AND product_id = ?').run(odooV.id, tplId, crm);
  const upd = await t.admin.put(`/api/catalog/products/${crm}`, {
    name: prod.name, type: prod.type, sales_price: prod.sales_price, cost_price: prod.cost_price,
    tax_ids: prod.tax_ids, variants: [{ id: blV.id, attribute_value_id: blV.attribute_value_id, extra_price: 0 }],
  });
  assert.equal(upd.status, 200);
  const kept = upd.body.variants.find((v) => v.id === odooV.id);
  assert.equal(kept.is_active, 0);
  assert.equal(kept.in_use, true);
  // put it back for later tests
  await t.admin.put(`/api/catalog/products/${crm}`, {
    name: prod.name, type: prod.type, sales_price: prod.sales_price, cost_price: prod.cost_price, tax_ids: prod.tax_ids,
    variants: prod.variants.map((v) => ({ id: v.id, attribute_value_id: v.attribute_value_id, extra_price: v.extra_price, is_active: 1 })),
  });
  t.db.prepare('UPDATE quotation_template_lines SET variant_id = NULL WHERE template_id = ?').run(tplId);
  assert.equal(catalog.getPrice(crm, odooV.id), 1760);
});

// ---------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------
test('plans: validation, availability flag, lifecycle flags, archive when referenced', async () => {
  const bad = await t.admin.post('/api/catalog/plans', {
    name: 'Broken', price: 10, billing_period: 'hourly', billing_interval: 0, min_quantity: 0,
    start_date: '2026-05-10', end_date: '2026-05-01',
  });
  assert.equal(bad.status, 422);
  for (const f of ['billing_period', 'billing_interval', 'min_quantity', 'end_date']) assert.ok(bad.body.fields[f], f);
  assert.equal((await t.admin.post('/api/catalog/plans', { name: 'Bad date', price: 1, billing_period: 'monthly', start_date: '2026-02-30' })).status, 422);

  const ok = await t.admin.post('/api/catalog/plans', {
    name: 'Quarterly', price: 2500, billing_period: 'monthly', billing_interval: 3, min_quantity: 2,
    start_date: '2020-01-01', pausable: true, renewable: true, closable: false, auto_close: false,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.available, true);
  assert.equal(ok.body.pausable, 1);
  assert.equal(ok.body.closable, 0);
  assert.equal(ok.body.subscription_count, 0);

  const future = await t.admin.post('/api/catalog/plans', { name: 'Future plan', price: 5, billing_period: 'weekly', start_date: '2999-01-01' });
  assert.equal(future.body.available, false);

  const list = await t.staff.get('/api/catalog/plans?available=1&limit=100');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((p) => p.id === ok.body.id));
  assert.equal(list.body.items.some((p) => p.id === future.body.id), false);
  assert.equal((await t.staff.post('/api/catalog/plans', { name: 'Staff plan', price: 1, billing_period: 'daily' })).status, 403);

  const yearly = idOf('recurring_plans', 'Yearly Business');
  assert.equal((await t.admin.delete(`/api/catalog/plans/${yearly}`)).status, 409);
  assert.equal((await t.admin.delete(`/api/catalog/plans/${future.body.id}`)).status, 204);
  assert.equal((await t.admin.patch(`/api/catalog/plans/${ok.body.id}/archive`)).body.available, false);
});

// ---------------------------------------------------------------------
// Quotation templates
// ---------------------------------------------------------------------
test('templates: lines with variants, totals preview, validation', async () => {
  const crm = idOf('products', 'Brightloop CRM');
  const acc = idOf('products', 'Brightloop Accounting');
  const prod = (await t.admin.get(`/api/catalog/products/${crm}`)).body;
  const odooV = prod.variants.find((v) => v.value_name === 'Odoo');
  const monthly = idOf('recurring_plans', 'Monthly Basic');

  const bad = await t.admin.post('/api/catalog/templates', {
    name: 'Bad', validity_days: 0, plan_id: monthly,
    lines: [{ product_id: acc, variant_id: odooV.id, quantity: 0 }],
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.validity_days && bad.body.fields['lines.0.quantity']);
  const wrongVariant = await t.admin.post('/api/catalog/templates', {
    name: 'Wrong variant', plan_id: monthly, lines: [{ product_id: acc, variant_id: odooV.id, quantity: 1 }],
  });
  assert.equal(wrongVariant.status, 422);
  assert.ok(wrongVariant.body.fields['lines.0.variant_id']);
  assert.equal((await t.admin.post('/api/catalog/templates', { name: 'No lines', plan_id: monthly, lines: [] })).status, 422);

  const res = await t.admin.post('/api/catalog/templates', {
    name: 'Starter Bundle', validity_days: 10, plan_id: monthly, payment_term_id: idOf('payment_terms', '15 Days'),
    lines: [
      { product_id: crm, variant_id: odooV.id, quantity: 2, description: 'CRM (Odoo brand)' },
      { product_id: acc, quantity: 1 },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.plan_name, 'Monthly Basic');
  assert.equal(res.body.payment_term_name, '15 Days');
  const l0 = res.body.lines[0];
  assert.equal(l0.unit_price, 1760);
  assert.equal(l0.variant_name, 'Brand: Odoo');
  assert.equal(l0.subtotal, 3520);
  // 3520 + 1500 = 5020 untaxed, 18% GST = 903.6
  assert.deepEqual(res.body.totals, { untaxed: 5020, tax: 903.6, total: 5923.6 });

  const upd = await t.admin.put(`/api/catalog/templates/${res.body.id}`, {
    name: 'Starter Bundle', validity_days: 20, plan_id: monthly, lines: [{ product_id: acc, quantity: 3 }],
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.lines.length, 1);
  assert.equal(upd.body.totals.untaxed, 4500);

  const list = await t.staff.get('/api/catalog/templates?search=starter');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].untaxed_amount, 4500);
  assert.equal(list.body.items[0].line_count, 1);
  assert.equal((await t.staff.post('/api/catalog/templates', { name: 'S', plan_id: monthly, lines: [{ product_id: acc }] })).status, 403);

  // archived plan cannot be used for a new template
  const archivedPlan = (await t.admin.post('/api/catalog/plans', { name: 'Old plan', price: 1, billing_period: 'daily', is_active: false })).body;
  const r = await t.admin.post('/api/catalog/templates', { name: 'Uses old plan', plan_id: archivedPlan.id, lines: [{ product_id: acc }] });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.plan_id);
});

// ---------------------------------------------------------------------
// Discounts (admin only)
// ---------------------------------------------------------------------
test('discounts: admin only, validation, status, usages, limit cannot drop below usage', async () => {
  assert.equal((await t.staff.get('/api/catalog/discounts')).status, 403);
  assert.equal((await t.staff.post('/api/catalog/discounts', { name: 'S', discount_type: 'fixed', value: 1 })).status, 403);

  const bad = await t.admin.post('/api/catalog/discounts', {
    name: 'Too much', discount_type: 'percent', value: 150, start_date: '2026-12-01', end_date: '2026-11-01',
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.value && bad.body.fields.end_date);
  const zero = await t.admin.post('/api/catalog/discounts', { name: 'Zero', discount_type: 'fixed', value: 0 });
  assert.ok(zero.body.fields.value);
  const noProducts = await t.admin.post('/api/catalog/discounts', { name: 'No products', discount_type: 'fixed', value: 5, scope: 'product' });
  assert.ok(noProducts.body.fields.product_ids);

  const crm = idOf('products', 'Brightloop CRM');
  const d = await t.admin.post('/api/catalog/discounts', {
    name: 'CRM 10%', discount_type: 'percent', value: 10, scope: 'product', product_ids: [crm],
    min_quantity: 2, usage_limit: 2, start_date: '2020-01-01',
  });
  assert.equal(d.status, 201);
  assert.equal(d.body.status, 'active');
  assert.equal(d.body.usage_count, 0);
  assert.deepEqual(d.body.product_ids, [crm]);
  assert.equal(d.body.remaining, 2);

  const sched = await t.admin.post('/api/catalog/discounts', { name: 'Future 5', discount_type: 'fixed', value: 50, start_date: '2999-01-01' });
  assert.equal(sched.body.status, 'scheduled');
  const exp = await t.admin.post('/api/catalog/discounts', { name: 'Old 5', discount_type: 'fixed', value: 50, end_date: '2000-01-01' });
  assert.equal(exp.body.status, 'expired');

  const inv = makeInvoice('INV/T/90');
  assert.equal(catalog.recordDiscountUsage(d.body.id, inv, 240), true);
  const full = await t.admin.get(`/api/catalog/discounts/${d.body.id}`);
  assert.equal(full.body.usage_count, 1);
  assert.equal(full.body.usages[0].invoice_number, 'INV/T/90');

  const lower = await t.admin.put(`/api/catalog/discounts/${d.body.id}`, {
    name: 'CRM 10%', discount_type: 'percent', value: 10, scope: 'product', product_ids: [crm], usage_limit: 1,
  });
  assert.equal(lower.status, 200, 'limit equal to usage is allowed');
  assert.equal(lower.body.status, 'exhausted');
  const tooLow = await t.admin.put(`/api/catalog/discounts/${sched.body.id}`, { name: 'Future 5', discount_type: 'fixed', value: 50, usage_limit: 0 });
  assert.equal(tooLow.status, 422);

  const filtered = await t.admin.get('/api/catalog/discounts?status=exhausted');
  assert.deepEqual(filtered.body.items.map((x) => x.name), ['CRM 10%']);

  const del = await t.admin.delete(`/api/catalog/discounts/${d.body.id}`);
  assert.equal(del.status, 409);
  assert.equal((await t.admin.delete(`/api/catalog/discounts/${exp.body.id}`)).status, 204);
  assert.equal((await t.admin.patch(`/api/catalog/discounts/${sched.body.id}/archive`)).body.status, 'inactive');
});
