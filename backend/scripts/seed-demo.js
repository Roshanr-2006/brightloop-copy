'use strict';

// Large demo dataset for the finance dashboard and performance checks.
//   npm run db:demo              (adds demo data once; prints a message if it is already there)
//   npm run db:demo -- --force   (adds another batch anyway)
// Uses the DB from config (DB_FILE). Never deletes anything.
//
// Inserts ~5,000 customers, ~6,000 subscriptions (1-3 lines with product taxes), ~15,000 invoices over
// the last 12 months (paid / confirmed / overdue / partially paid / draft / cancelled) with lines and
// line taxes, matching payments, and status history. Also creates a staff user and a demo portal customer.
// Afterwards it times the main report queries and paged list queries.

const t0 = Date.now();
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { db } = require('../src/db');
const { round2, computeLine } = require('../src/utils/money');
const { today, addDays, addPeriod, daysBetween } = require('../src/utils/dates');

const FORCE = process.argv.includes('--force');
const N_CUSTOMERS = 5000;
const N_SUBSCRIPTIONS = 6000;
const DEMO_DOMAIN = 'demo.brightloop.test';
const STAFF = { name: 'Demo Staff', email: 'staff@brightloop.test', password: 'Staff@12345' };
const PORTAL = { name: 'Demo Customer', email: 'customer@brightloop.test', password: 'Customer@123' };

const TODAY = today();
const nowIso = () => new Date().toISOString();
const ts = (date) => `${date}T09:00:00.000Z`;

/* ------------------------------------------------------------------ random helpers (deterministic) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261031);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function weighted(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r < 0) return value;
  }
  return entries[entries.length - 1][0];
}
const minDate = (a, b) => (a < b ? a : b);

/* ------------------------------------------------------------------ users (idempotent) */
function ensureUser({ name, email, password }, role) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return { id: existing.id, created: false };
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 10), role);
  return { id: Number(info.lastInsertRowid), created: true };
}

let admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!admin) {
  admin = { id: ensureUser(config.admin, 'admin').id };
  console.log(`Created admin ${config.admin.email} / ${config.admin.password}`);
}
const staff = ensureUser(STAFF, 'staff');
if (staff.created) console.log(`Created staff user ${STAFF.email} / ${STAFF.password}`);
const portalUser = ensureUser(PORTAL, 'customer');
let portalCustomer = db.prepare('SELECT id, user_id FROM customers WHERE email = ?').get(PORTAL.email);
if (!portalCustomer) {
  const info = db.prepare(`INSERT INTO customers (user_id, name, company_name, email, phone, billing_address, city, state, country)
    VALUES (?, ?, 'Demo Ventures', ?, '+91 98470 12345', '12 MG Road', 'Kochi', 'Kerala', 'India')`)
    .run(portalUser.id, PORTAL.name, PORTAL.email);
  portalCustomer = { id: Number(info.lastInsertRowid), user_id: portalUser.id, fresh: true };
} else if (!portalCustomer.user_id) {
  db.prepare('UPDATE customers SET user_id = ? WHERE id = ?').run(portalUser.id, portalCustomer.id);
}
if (portalUser.created) console.log(`Created portal customer ${PORTAL.email} / ${PORTAL.password}`);
const portalHasSubs = db.prepare('SELECT 1 FROM subscriptions WHERE customer_id = ? LIMIT 1').get(portalCustomer.id);

const alreadyDemo = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE email LIKE ?`).get(`%@${DEMO_DOMAIN}`).n;
if (alreadyDemo > 0 && !FORCE) {
  console.log(`Demo data is already loaded (${alreadyDemo} demo customers). Use "npm run db:demo -- --force" to add another batch.`);
  if (!portalHasSubs) console.log('Note: the demo portal customer has no subscriptions; run with --force to add them.');
  process.exit(0);
}

/* ------------------------------------------------------------------ reference data */
const products = db.prepare('SELECT id, name, type, sales_price FROM products WHERE is_active = 1 ORDER BY id').all();
if (!products.length) throw new Error('No active products found. Run npm run db:reset first.');
const taxRows = db.prepare(`
  SELECT pt.product_id, t.id, t.name, t.computation, t.amount
  FROM product_taxes pt JOIN taxes t ON t.id = pt.tax_id WHERE t.is_active = 1`).all();
const variants = db.prepare('SELECT id, product_id, extra_price FROM product_variants WHERE is_active = 1').all();
for (const p of products) {
  p.taxes = taxRows.filter((t) => t.product_id === p.id);
  p.variants = variants.filter((v) => v.product_id === p.id);
}
const recurringProducts = products.filter((p) => p.type !== 'goods');
const plans = db.prepare('SELECT * FROM recurring_plans WHERE is_active = 1').all();
const planBy = (period) => plans.filter((p) => p.billing_period === period);
const terms = db.prepare('SELECT id, due_days FROM payment_terms WHERE is_active = 1').all();
if (!plans.length || !terms.length) throw new Error('Plans or payment terms missing. Run npm run db:reset first.');
const salespeople = [admin.id, staff.id];

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan', 'Kabir', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Meera', 'Lakshmi', 'Nila', 'Gouri', 'Fathima', 'Anjali', 'Rahul', 'Vishnu', 'Akhil', 'Nikhil', 'Sneha', 'Priya', 'Divya', 'Arun', 'Joseph', 'Thomas', 'Mariam', 'Neha', 'Kiran', 'Manu', 'Hari', 'Devika', 'Riya', 'Sachin', 'Swathy', 'Merryl'];
const LAST = ['Nair', 'Menon', 'Pillai', 'Kurian', 'Varghese', 'Sharma', 'Iyer', 'Reddy', 'Patel', 'Gupta', 'Shetty', 'Rao', 'Das', 'Joseph', 'Mathew', 'Thomas', 'Krishnan', 'Kumar', 'Singh', 'Chacko', 'Rajan', 'Unni', 'Bose', 'Mehta', 'Kapoor'];
const COMPANY_A = ['Blue', 'Green', 'Bright', 'Coastal', 'Spice', 'Lotus', 'Peak', 'Silver', 'Nova', 'Delta', 'Monsoon', 'Harbor', 'Pixel', 'Cardamom', 'Tusker'];
const COMPANY_B = ['Systems', 'Traders', 'Labs', 'Foods', 'Logistics', 'Textiles', 'Studios', 'Retail', 'Infotech', 'Exports', 'Clinic', 'Motors'];
const CITIES = [['Kochi', 'Kerala'], ['Thiruvananthapuram', 'Kerala'], ['Kozhikode', 'Kerala'], ['Bengaluru', 'Karnataka'], ['Chennai', 'Tamil Nadu'], ['Coimbatore', 'Tamil Nadu'], ['Hyderabad', 'Telangana'], ['Mumbai', 'Maharashtra'], ['Pune', 'Maharashtra'], ['Delhi', 'Delhi'], ['Ahmedabad', 'Gujarat'], ['Kolkata', 'West Bengal']];
const METHOD_WEIGHTS = [['bank_transfer', 35], ['upi', 30], ['card', 15], ['cash', 8], ['cheque', 8], ['other', 4]];

/* ------------------------------------------------------------------ prepared statements */
const st = {
  customer: db.prepare(`INSERT INTO customers (name, company_name, email, phone, billing_address, city, state, country, tax_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'India', ?, ?, ?)`),
  sub: db.prepare(`INSERT INTO subscriptions (number, customer_id, plan_id, payment_term_id, salesperson_id, status, start_date,
      expiry_date, quotation_valid_until, next_invoice_date, notes, closed_at, close_reason, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  subLine: db.prepare(`INSERT INTO subscription_lines (subscription_id, product_id, variant_id, description, quantity, unit_price, amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  subLineTax: db.prepare('INSERT INTO subscription_line_taxes (line_id, tax_id) VALUES (?, ?)'),
  history: db.prepare(`INSERT INTO subscription_status_history (subscription_id, from_status, to_status, changed_by, note, changed_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  invoice: db.prepare(`INSERT INTO invoices (number, subscription_id, customer_id, status, invoice_date, due_date, period_start, period_end,
      untaxed_amount, discount_amount, tax_amount, total_amount, amount_paid, sent_at, confirmed_at, paid_at, cancelled_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`),
  invLine: db.prepare(`INSERT INTO invoice_lines (invoice_id, product_id, variant_id, description, quantity, unit_price, discount_amount, tax_amount, subtotal, total)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`),
  invLineTax: db.prepare('INSERT INTO invoice_line_taxes (line_id, tax_id, tax_name, rate, amount) VALUES (?, ?, ?, ?, ?)'),
  nextInvoice: db.prepare('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?'),
  payment: db.prepare(`INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date, reference, note, recorded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

const seqRow = (code) => db.prepare('SELECT prefix, next_value FROM sequences WHERE code = ?').get(code);
const subSeq = seqRow('subscription');
const invSeq = seqRow('invoice');
if (!subSeq || !invSeq) throw new Error('sequences table is missing subscription/invoice rows');
let nextSub = subSeq.next_value;
let nextInv = invSeq.next_value;
const docNumber = (prefix, date, n) => `${prefix}/${date.slice(0, 4)}/${String(n).padStart(5, '0')}`;

const counts = { customers: 0, subscriptions: 0, subscription_lines: 0, invoices: 0, invoice_lines: 0, payments: 0, history: 0 };
const invoiceStatusCount = { draft: 0, confirmed: 0, paid: 0, cancelled: 0, overdue: 0, partial: 0 };

/* ------------------------------------------------------------------ builders */
function makeLines(plan) {
  const n = weighted([[1, 45], [2, 35], [3, 20]]);
  const pool = [...recurringProducts];
  const lines = [];
  for (let i = 0; i < n && pool.length; i += 1) {
    const product = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const variant = product.variants.length && rand() < 0.6 ? pick(product.variants) : null;
    const unitPrice = round2(Number(product.sales_price) + (variant ? Number(variant.extra_price) : 0));
    const quantity = Math.max(plan.min_quantity, weighted([[1, 50], [2, 20], [3, 12], [5, 10], [10, 8]]));
    lines.push({ product, variant, quantity, unit_price: unitPrice, amount: round2(quantity * unitPrice) });
  }
  return lines;
}

function insertSubscription(customerId, plan, status, startDate, extra = {}) {
  const number = docNumber(subSeq.prefix, startDate, nextSub);
  nextSub += 1;
  const term = extra.term || pick(terms);
  const created = ts(addDays(startDate, -int(1, 10)));
  const info = st.sub.run(number, customerId, plan.id, term.id, pick(salespeople), status, startDate,
    extra.expiry || null, extra.validUntil || null, extra.nextInvoice || null, extra.notes || null,
    extra.closedAt || null, extra.closeReason || null, pick(salespeople), created, extra.updated || created);
  const id = Number(info.lastInsertRowid);
  counts.subscriptions += 1;
  const lines = extra.lines || makeLines(plan);
  for (const l of lines) {
    const lineId = Number(st.subLine.run(id, l.product.id, l.variant ? l.variant.id : null, l.product.name, l.quantity, l.unit_price, l.amount).lastInsertRowid);
    for (const tax of l.product.taxes) st.subLineTax.run(lineId, tax.id);
    counts.subscription_lines += 1;
  }
  // Status history following the lifecycle up to the current status.
  const flow = ['draft', 'quotation', 'confirmed', 'active'];
  const path_ = status === 'paused' || status === 'closed' ? [...flow, status] : flow.slice(0, flow.indexOf(status) + 1);
  let prev = null;
  path_.forEach((s, i) => {
    const when = s === 'closed' && extra.closedAt ? extra.closedAt
      : s === 'paused' ? ts(extra.pausedOn || startDate)
        : ts(minDate(addDays(startDate, i - 3), TODAY));
    st.history.run(id, prev, s, pick(salespeople), prev ? null : 'Created', when);
    counts.history += 1;
    prev = s;
  });
  return { id, number, lines, term, customerId };
}

function invoiceLineData(lines) {
  return lines.map((l) => {
    const c = computeLine({ quantity: l.quantity, unit_price: l.unit_price, taxes: l.product.taxes });
    return { ...l, calc: c };
  });
}

/**
 * Insert one invoice for a billing period.
 * kind: 'paid' | 'open' | 'partial' | 'draft' | 'cancelled'
 */
function insertInvoice(sub, periodStart, periodEnd, kind) {
  const invoiceDate = periodStart;
  const dueDate = addDays(invoiceDate, sub.term.due_days);
  const lines = invoiceLineData(sub.lines);
  const untaxed = round2(lines.reduce((s, l) => s + l.calc.subtotal, 0));
  const tax = round2(lines.reduce((s, l) => s + l.calc.tax_amount, 0));
  const total = round2(untaxed + tax);

  let status = 'confirmed';
  let paid = 0;
  let paidAt = null;
  let cancelledAt = null;
  const confirmedAt = kind === 'draft' ? null : ts(invoiceDate);
  const sentAt = kind === 'draft' ? null : ts(invoiceDate);
  const payments = [];
  if (kind === 'draft') status = 'draft';
  if (kind === 'cancelled') { status = 'cancelled'; cancelledAt = ts(minDate(addDays(invoiceDate, int(1, 5)), TODAY)); }
  if (kind === 'paid' && total > 0) {
    const lastPay = minDate(addDays(invoiceDate, int(0, sub.term.due_days + 12)), TODAY);
    if (rand() < 0.15 && total >= 2) {
      const first = round2(total * (0.3 + rand() * 0.4));
      payments.push({ amount: first, date: minDate(addDays(invoiceDate, int(0, 5)), lastPay) });
      payments.push({ amount: round2(total - first), date: lastPay });
    } else {
      payments.push({ amount: total, date: lastPay });
    }
    status = 'paid';
    paid = total;
    paidAt = ts(lastPay);
  } else if (kind === 'paid') {
    status = 'paid';
    paidAt = ts(invoiceDate);
  }
  if (kind === 'partial' && total >= 2) {
    const amount = round2(total * (0.25 + rand() * 0.5));
    payments.push({ amount, date: minDate(addDays(invoiceDate, int(0, 10)), TODAY) });
    paid = amount;
  }

  const number = docNumber(invSeq.prefix, invoiceDate, nextInv);
  nextInv += 1;
  const updated = paidAt || cancelledAt || confirmedAt || ts(invoiceDate);
  const id = Number(st.invoice.run(number, sub.id, sub.customerId, status, invoiceDate, dueDate, periodStart, periodEnd,
    untaxed, tax, total, paid, sentAt, confirmedAt, paidAt, cancelledAt, ts(invoiceDate), updated).lastInsertRowid);
  counts.invoices += 1;
  invoiceStatusCount[status] += 1;
  if (status === 'confirmed' && dueDate < TODAY) invoiceStatusCount.overdue += 1;
  if (status === 'confirmed' && paid > 0) invoiceStatusCount.partial += 1;

  for (const l of lines) {
    const lineId = Number(st.invLine.run(id, l.product.id, l.variant ? l.variant.id : null, l.product.name, l.quantity,
      l.unit_price, l.calc.tax_amount, l.calc.subtotal, l.calc.total).lastInsertRowid);
    counts.invoice_lines += 1;
    for (const tx of l.calc.taxes) st.invLineTax.run(lineId, tx.id, tx.name, tx.rate, tx.amount);
  }
  for (const p of payments) {
    const method = weighted(METHOD_WEIGHTS);
    const reference = method === 'cash' ? null : method === 'cheque' ? `CHQ${int(100000, 999999)}` : `UTR${int(10000000, 99999999)}`;
    st.payment.run(id, sub.customerId, method, p.amount, p.date, reference, null, pick(salespeople), ts(p.date));
    counts.payments += 1;
  }
  return { id, status };
}

/** Pick the outcome of an invoice by its age (older -> mostly paid). */
function invoiceKind(periodStart, isLatest) {
  const age = daysBetween(periodStart, TODAY);
  if (isLatest && age < 20 && rand() < 0.18) return 'draft';
  if (age > 60) return weighted([['paid', 86], ['open', 7], ['partial', 3], ['cancelled', 4]]);
  if (age > 25) return weighted([['paid', 70], ['open', 18], ['partial', 8], ['cancelled', 4]]);
  return weighted([['paid', 45], ['open', 40], ['partial', 12], ['cancelled', 3]]);
}

/** Bill every period from start until `until` (inclusive); returns the next unbilled period start. */
function billPeriods(sub, plan, startDate, until, maxInvoices = 60) {
  let periodStart = startDate;
  let n = 0;
  while (periodStart <= until && n < maxInvoices) {
    const next = addPeriod(periodStart, plan.billing_period, plan.billing_interval);
    const isLatest = next > until;
    const kind = invoiceKind(periodStart, isLatest);
    insertInvoice(sub, periodStart, addDays(next, -1), kind);
    if (kind === 'cancelled' && rand() < 0.6) {
      // Re-billed after cancellation: the unique live index allows one new live invoice for the period.
      insertInvoice(sub, periodStart, addDays(next, -1), 'paid');
    }
    periodStart = next;
    n += 1;
  }
  return periodStart;
}

/* ------------------------------------------------------------------ main generation */
function planFor() {
  const period = weighted([['monthly', 70], ['yearly', 18], ['weekly', 9], ['daily', 3]]);
  const options = planBy(period);
  return options.length ? pick(options) : pick(plans);
}

function startDateFor(plan, status) {
  // Respect a plan's availability window when it has an end date (e.g. a festive offer).
  const lo = plan.end_date && plan.start_date ? plan.start_date : null;
  const hi = plan.end_date ? minDate(plan.end_date, TODAY) : TODAY;
  const window = (maxBack) => {
    let d = addDays(TODAY, -int(0, maxBack));
    if (lo && d < lo) d = addDays(lo, int(0, Math.max(0, daysBetween(lo, hi))));
    return minDate(d, hi);
  };
  if (status === 'draft' || status === 'quotation') return window(20);
  if (status === 'confirmed') return addDays(TODAY, int(1, 20)); // starts soon, nothing billed yet
  switch (plan.billing_period) {
    case 'daily': return window(status === 'closed' ? 120 : 3);
    case 'weekly': return window(status === 'closed' ? 300 : 24);
    case 'yearly': return window(360);
    default: return window(status === 'closed' ? 365 : 330);
  }
}

function seedCustomers(batch) {
  const ids = [];
  for (let i = 1; i <= N_CUSTOMERS; i += 1) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const [city, state] = pick(CITIES);
    const company = rand() < 0.7 ? `${pick(COMPANY_A)} ${pick(COMPANY_B)}` : null;
    const created = ts(addDays(TODAY, -int(30, 420)));
    const email = `${first}.${last}.${i}${batch}@${DEMO_DOMAIN}`.toLowerCase();
    const gst = company ? `32${String(int(10000, 99999))}${'ABCDE'[int(0, 4)]}${int(1000, 9999)}Z${int(1, 9)}` : null;
    ids.push(Number(st.customer.run(`${first} ${last}`, company, email, `+91 9${int(100000000, 999999999)}`,
      `${int(1, 250)}, ${pick(['MG Road', 'Market Road', 'Infopark', 'Station Road', 'Church Street', 'Main Street'])}`,
      city, state, gst, created, created).lastInsertRowid));
    counts.customers += 1;
  }
  return ids;
}

function seedSubscriptions(customerIds) {
  for (let i = 0; i < N_SUBSCRIPTIONS; i += 1) {
    // Every customer gets one subscription, then extra ones go to random customers.
    const customerId = i < customerIds.length ? customerIds[i] : pick(customerIds);
    const plan = planFor();
    const status = weighted([['active', 64], ['paused', 5], ['closed', 11], ['confirmed', 5], ['quotation', 8], ['draft', 7]]);
    if (status === 'paused' && !plan.pausable) { i -= 1; continue; }
    const start = startDateFor(plan, status);

    if (status === 'draft' || status === 'quotation' || status === 'confirmed') {
      insertSubscription(customerId, plan, status, start, {
        validUntil: status === 'quotation' ? addDays(start, 15) : null,
        nextInvoice: status === 'confirmed' ? start : null,
      });
      continue;
    }
    if (status === 'active') {
      const sub = insertSubscription(customerId, plan, 'active', start, {});
      st.nextInvoice.run(billPeriods(sub, plan, start, TODAY), sub.id);
      continue;
    }
    if (status === 'paused') {
      const pausedOn = minDate(addDays(start, int(10, 120)), TODAY);
      const sub = insertSubscription(customerId, plan, 'paused', start, { pausedOn });
      st.nextInvoice.run(billPeriods(sub, plan, start, pausedOn), sub.id);
      continue;
    }
    // closed: ran a few periods, then closed at the end of the last one.
    const periods = int(1, plan.billing_period === 'monthly' ? 10 : 4);
    let end = start;
    for (let k = 0; k < periods; k += 1) end = addPeriod(end, plan.billing_period, plan.billing_interval);
    const closedOn = minDate(addDays(end, -1), addDays(TODAY, -1));
    if (closedOn < start) { i -= 1; continue; }
    const sub = insertSubscription(customerId, plan, 'closed', start, {
      expiry: closedOn,
      closedAt: ts(closedOn),
      closeReason: pick(['Customer cancelled', 'Contract ended', 'Moved to another plan', 'Expired']),
      updated: ts(closedOn),
    });
    billPeriods(sub, plan, start, closedOn);
  }
}

function seedPortalCustomer() {
  const monthly = planBy('monthly').find((p) => !p.end_date) || planBy('monthly')[0] || plans[0];
  const yearly = planBy('yearly')[0] || plans[0];
  const crm = products.find((p) => p.name === 'Brightloop CRM') || products[0];
  const support = products.find((p) => p.name === 'Priority Support') || products[products.length - 1];
  const accounting = products.find((p) => p.name === 'Brightloop Accounting') || products[0];
  const term = terms.find((t) => t.due_days === 15) || terms[0];
  const line = (product, quantity) => ({ product, variant: null, quantity, unit_price: round2(product.sales_price), amount: round2(quantity * product.sales_price) });

  const startA = addDays(addPeriod(TODAY, 'monthly', -3), 0);
  const subA = insertSubscription(portalCustomer.id, monthly, 'active', startA, {
    term, lines: [line(crm, Math.max(monthly.min_quantity, 2)), line(support, Math.max(monthly.min_quantity, 1))],
    notes: 'Demo portal subscription',
  });
  // Explicit outcomes: older ones paid, one overdue, latest open.
  let p = startA;
  const outcomes = ['paid', 'paid', 'open', 'open'];
  let k = 0;
  while (p <= TODAY) {
    const next = addPeriod(p, monthly.billing_period, monthly.billing_interval);
    insertInvoice(subA, p, addDays(next, -1), outcomes[Math.min(k, outcomes.length - 1)]);
    p = next;
    k += 1;
  }
  db.prepare('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?').run(p, subA.id);

  const startB = addDays(TODAY, -100);
  const subB = insertSubscription(portalCustomer.id, yearly, 'active', startB, {
    term, lines: [line(accounting, Math.max(yearly.min_quantity, 5))], notes: 'Demo yearly plan',
  });
  insertInvoice(subB, startB, addDays(addPeriod(startB, 'yearly', yearly.billing_interval), -1), 'partial');
  db.prepare('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?')
    .run(addPeriod(startB, 'yearly', yearly.billing_interval), subB.id);
}

const batch = FORCE && alreadyDemo > 0 ? `.b${Date.now().toString(36)}` : '';
const tGen = Date.now();
db.exec('BEGIN IMMEDIATE');
try {
  const customerIds = seedCustomers(batch);
  seedSubscriptions(customerIds);
  if (!portalHasSubs) seedPortalCustomer();
  db.prepare('UPDATE sequences SET next_value = ? WHERE code = ?').run(nextSub, 'subscription');
  db.prepare('UPDATE sequences SET next_value = ? WHERE code = ?').run(nextInv, 'invoice');
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Demo seed failed, nothing was written:', err.message);
  process.exit(1);
}
const genMs = Date.now() - tGen;
db.exec('ANALYZE');

console.log(`\nDemo data inserted into ${config.dbFile}`);
console.table(counts);
console.log('Invoices by status:', invoiceStatusCount);
console.log(`Insert time: ${(genMs / 1000).toFixed(2)} s (total so far ${((Date.now() - t0) / 1000).toFixed(2)} s)`);

/* ------------------------------------------------------------------ query timings */
const reports = require('../src/modules/reports/reports.service');

function time(label, fn, runs = 5) {
  fn(); // warm up (prepares statements, loads pages)
  const samples = [];
  let result;
  for (let i = 0; i < runs; i += 1) {
    const s = process.hrtime.bigint();
    result = fn();
    samples.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { query: label, median_ms: Math.round(median * 10) / 10, max_ms: Math.round(samples[samples.length - 1] * 10) / 10, ok: median < 2000 ? 'yes' : 'NO', _r: result };
}

function optionalService(file) {
  const full = path.join(__dirname, '..', 'src', 'modules', file);
  return fs.existsSync(full) ? require(full) : null;
}
const subsService = optionalService('subscriptions/subscriptions.service.js');
const invService = optionalService('invoices/invoices.service.js');
const monthStart = `${TODAY.slice(0, 7)}-01`;
const yearAgo = addDays(TODAY, -365);
const page = { page: 3, limit: 20, offset: 40 };

const listSubsSql = () => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM subscriptions s WHERE s.status = 'active'").get().n;
  const items = db.prepare(`
    SELECT s.id, s.number, s.status, s.start_date, s.next_invoice_date, c.name AS customer_name, p.name AS plan_name,
      (SELECT COALESCE(SUM(amount), 0) FROM subscription_lines l WHERE l.subscription_id = s.id) AS recurring_amount
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN recurring_plans p ON p.id = s.plan_id
    WHERE s.status = 'active' ORDER BY s.id DESC LIMIT 20 OFFSET 40`).all();
  return { total, items };
};
const listInvSql = () => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM invoices i WHERE i.status = 'confirmed'").get().n;
  const items = db.prepare(`
    SELECT i.id, i.number, i.status, i.invoice_date, i.due_date, i.total_amount, i.amount_paid, c.name AS customer_name
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.status = 'confirmed' ORDER BY i.invoice_date DESC, i.id DESC LIMIT 20 OFFSET 40`).all();
  return { total, items };
};
const searchInvSql = () => db.prepare(`
    SELECT i.id, i.number, c.name FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' ORDER BY i.id DESC LIMIT 20`).all('%nair%', '%nair%');

const timings = [
  time('reports summary (this month)', () => reports.summary({ from: monthStart, to: TODAY })),
  time('reports summary (all time)', () => reports.summary({})),
  time('reports revenue 12 months', () => reports.revenue({ months: 12 })),
  time('reports overdue page 1 + aging', () => reports.overdue({}, { page: 1, limit: 20, offset: 0 })),
  time('reports payments by method (1y)', () => reports.paymentsByMethod({ from: yearAgo, to: TODAY })),
  time('reports subscriptions by plan', () => reports.subscriptionsByPlan({})),
  time('reports top customers (1y)', () => reports.topCustomers({ from: yearAgo, to: TODAY, limit: 5 })),
  subsService && subsService.listSubscriptions
    ? time('listSubscriptions active p3 (service)', () => subsService.listSubscriptions({ status: 'active' }, page))
    : time('subscriptions list active p3 (SQL)', listSubsSql),
  time('subscriptions search "nair" (SQL)', () => db.prepare(`
    SELECT s.id, s.number, c.name FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    WHERE s.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' ORDER BY s.id DESC LIMIT 20`).all('%nair%', '%nair%')),
  invService && invService.listInvoices
    ? time('listInvoices confirmed p3 (service)', () => invService.listInvoices({ status: 'confirmed' }, page))
    : time('invoices list confirmed p3 (SQL)', listInvSql),
  time('invoices search "nair" (SQL)', searchInvSql),
];
const summaryNow = timings[0]._r;
console.log('\nQuery timings on this dataset (target < 2000 ms, aim < 300 ms):');
console.table(timings.map(({ _r, ...rest }) => rest));
console.log('This month:', {
  active_subscriptions: summaryNow.subscriptions.active,
  mrr: summaryNow.mrr,
  invoiced: summaryNow.revenue.invoiced,
  collected: summaryNow.revenue.collected,
  outstanding: summaryNow.revenue.outstanding,
  overdue: `${summaryNow.revenue.overdue_amount} (${summaryNow.revenue.overdue_count} invoices)`,
});
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(2)} s. Logins: ${STAFF.email} / ${STAFF.password}, ${PORTAL.email} / ${PORTAL.password}`);
db.close();
