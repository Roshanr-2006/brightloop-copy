'use strict';

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
// Module routers. Each owner uncomments/adds their line when the module exists.
// Pull before editing this block, push right after (one-line changes only).
// ---------------------------------------------------------------------------
// A. Sachin
// app.use('/api/auth', require('./modules/auth/auth.routes'));
// app.use('/api/users', require('./modules/users/users.routes'));
// app.use('/api/customers', require('./modules/customers/customers.routes'));
// app.use('/api/portal', require('./modules/portal/portal.routes'));
// B. Roshan
// app.use('/api/catalog', require('./modules/catalog/catalog.routes'));
// C. Swathy
// app.use('/api/subscriptions', require('./modules/subscriptions/subscriptions.routes'));
// app.use('/api/invoices', require('./modules/invoices/invoices.routes'));
// app.use('/api/billing', require('./modules/billing/billing.routes'));
// D. Merryl
// app.use('/api/payments', require('./modules/payments/payments.routes'));
// app.use('/api/reports', require('./modules/reports/reports.routes'));

app.use('/api', notFoundHandler);
app.use(errorHandler);

module.exports = app;
