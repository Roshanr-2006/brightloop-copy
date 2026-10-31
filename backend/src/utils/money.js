'use strict';

// Money helpers (all amounts are numbers rounded to 2 decimals).

/** Round half away from zero to 2 decimals, avoiding float drift (1.005 -> 1.01). */
function round2(value) {
  const n = Number(value) || 0;
  return (Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

/**
 * Tax amount for a taxable base.
 *   tax = { computation: 'percent' | 'fixed', amount }
 *   percent -> base * amount / 100;  fixed -> amount per unit * quantity
 */
function taxAmount(tax, base, quantity = 1) {
  if (!tax) return 0;
  if (tax.computation === 'fixed') return round2(Number(tax.amount) * quantity);
  return round2((base * Number(tax.amount)) / 100);
}

/**
 * Totals for one line.
 *   computeLine({ quantity, unit_price, discount_amount = 0, taxes = [] })
 *   -> { quantity, unit_price, gross, discount_amount, subtotal, tax_amount, total,
 *        taxes: [{ id, name, computation, rate, amount }] }
 * Taxes are applied on the discounted subtotal.
 */
function computeLine({ quantity, unit_price, discount_amount = 0, taxes = [] }) {
  const qty = Number(quantity) || 0;
  const price = round2(unit_price);
  const gross = round2(qty * price);
  const discount = Math.min(round2(discount_amount), gross);
  const subtotal = round2(gross - discount);
  const taxLines = taxes.map((t) => ({
    id: t.id,
    name: t.name,
    computation: t.computation,
    rate: round2(t.amount),
    amount: taxAmount(t, subtotal, qty),
  }));
  const tax = round2(taxLines.reduce((s, t) => s + t.amount, 0));
  return {
    quantity: qty,
    unit_price: price,
    gross,
    discount_amount: discount,
    subtotal,
    tax_amount: tax,
    total: round2(subtotal + tax),
    taxes: taxLines,
  };
}

/** Sum a field over rows, rounded. */
function sum(rows, field) {
  return round2(rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0));
}

module.exports = { round2, taxAmount, computeLine, sum };
