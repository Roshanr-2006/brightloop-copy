'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { db } = require('./db');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Health check: confirms the API and the database are up.
app.get('/api/health', (req, res) => {
  const { products } = db.prepare('SELECT COUNT(*) AS products FROM products').get();
  const { plans } = db.prepare('SELECT COUNT(*) AS plans FROM recurring_plans').get();
  res.json({ status: 'ok', time: new Date().toISOString(), database: { products, plans } });
});

// ---------------------------------------------------------------------------
// Module routers. A router is mounted as soon as its <name>.routes.js file exists,
// so modules can land in any order without editing this file.
// ---------------------------------------------------------------------------
const MODULES = [
  // A. Sachin
  ['/api/auth', 'auth/auth.routes'],
  ['/api/users', 'users/users.routes'],
  ['/api/customers', 'customers/customers.routes'],
  ['/api/portal', 'portal/portal.routes'],
  // B. Roshan
  ['/api/catalog', 'catalog/catalog.routes'],
  // C. Swathy
  ['/api/subscriptions', 'subscriptions/subscriptions.routes'],
  ['/api/invoices', 'invoices/invoices.routes'],
  ['/api/billing', 'billing/billing.routes'],
  // D. Merryl
  ['/api/payments', 'payments/payments.routes'],
  ['/api/reports', 'reports/reports.routes'],
];

for (const [mountPath, file] of MODULES) {
  const full = path.join(__dirname, 'modules', `${file}.js`);
  if (fs.existsSync(full)) app.use(mountPath, require(full));
}

app.use('/api', notFoundHandler);
app.use(errorHandler);

module.exports = app;
