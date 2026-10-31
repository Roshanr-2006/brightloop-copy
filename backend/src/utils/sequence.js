'use strict';

// Document numbers: nextNumber('invoice') -> 'INV/2026/00001'.
// Call inside the same transaction() that inserts the document.

const { db } = require('../db');

const bump = db.prepare(
  'UPDATE sequences SET next_value = next_value + 1 WHERE code = ? RETURNING prefix, next_value - 1 AS value',
);

function nextNumber(code, year = new Date().getUTCFullYear()) {
  const row = bump.get(code);
  if (!row) throw new Error(`Unknown sequence: ${code}`);
  return `${row.prefix}/${year}/${String(row.value).padStart(5, '0')}`;
}

module.exports = { nextNumber };
