'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { round2, computeLine } = require('../src/utils/money');
const { addPeriod } = require('../src/utils/dates');
const { nextNumber } = require('../src/utils/sequence');

test('foundation: health, money, dates, sequences', async () => {
  const t = await start();
  try {
    const res = await t.anon.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');

    assert.equal(round2(1.005), 1.01);
    const line = computeLine({
      quantity: 2, unit_price: 100, discount_amount: 20,
      taxes: [{ id: 1, name: 'GST 18%', computation: 'percent', amount: 18 }],
    });
    assert.deepEqual([line.subtotal, line.tax_amount, line.total], [180, 32.4, 212.4]);

    assert.equal(addPeriod('2026-01-31', 'monthly', 1), '2026-02-28');
    assert.equal(addPeriod('2026-03-01', 'yearly', 1), '2027-03-01');
    assert.equal(addPeriod('2026-03-01', 'weekly', 2), '2026-03-15');

    assert.equal(nextNumber('invoice', 2026), 'INV/2026/00001');
    assert.equal(nextNumber('invoice', 2026), 'INV/2026/00002');
  } finally {
    await t.close();
  }
});
