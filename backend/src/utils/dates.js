'use strict';

// Date helpers. Dates are 'YYYY-MM-DD' strings, computed in UTC so they never shift by timezone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const toDate = (value) => new Date(`${value}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);

/** Today as YYYY-MM-DD (override with env TODAY=2026-11-01 for demos/tests). */
function today() {
  if (process.env.TODAY && isValidDate(process.env.TODAY)) return process.env.TODAY;
  return fmt(new Date());
}

function addDays(date, days) {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return fmt(d);
}

/** Add months, clamping to the last day of the month (Jan 31 + 1 month = Feb 28/29). */
function addMonths(date, months) {
  const d = toDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fmt(d);
}

/** Start of the next billing period: addPeriod('2026-01-31', 'monthly', 1) -> '2026-02-28'. */
function addPeriod(date, period, interval = 1) {
  const n = Number(interval) || 1;
  switch (period) {
    case 'daily': return addDays(date, n);
    case 'weekly': return addDays(date, 7 * n);
    case 'monthly': return addMonths(date, n);
    case 'yearly': return addMonths(date, 12 * n);
    default: throw new Error(`Unknown billing period: ${period}`);
  }
}

/** Whole days from a to b (b - a). */
function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

module.exports = { isValidDate, today, addDays, addMonths, addPeriod, daysBetween };
