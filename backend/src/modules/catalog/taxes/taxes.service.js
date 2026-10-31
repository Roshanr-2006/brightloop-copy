'use strict';

const { db } = require('../../../db');
const h = require('../catalog.helpers');

const REFS = [['product_taxes', 'tax_id'], ['subscription_line_taxes', 'tax_id']];

function list(query) {
  const where = [];
  const params = [];
  h.activeCondition(query, 't.is_active', where, params);
  h.searchCondition(query, ['t.name'], where, params);
  if (query.computation === 'percent' || query.computation === 'fixed') {
    where.push('t.computation = ?');
    params.push(query.computation);
  }
  return h.listQuery({
    select: `t.*, (SELECT COUNT(*) FROM product_taxes pt WHERE pt.tax_id = t.id) AS product_count`,
    from: 'taxes t',
    where,
    params,
    query,
    sortable: { name: 't.name', amount: 't.amount', computation: 't.computation', created: 't.created_at' },
    defaultSort: 't.name',
  });
}

function get(id) {
  const tax = h.findOr404('taxes', id, 'Tax');
  tax.usage = h.usage(REFS, tax.id);
  return tax;
}

function create(v) {
  h.assertUniqueName('taxes', v.name, null, 'tax');
  const info = db.prepare('INSERT INTO taxes (name, computation, amount, is_active) VALUES (?, ?, ?, ?)')
    .run(v.name, v.computation, v.amount, v.is_active ?? 1);
  return get(Number(info.lastInsertRowid));
}

function update(id, v) {
  const tax = h.findOr404('taxes', id, 'Tax');
  h.assertUniqueName('taxes', v.name, tax.id, 'tax');
  db.prepare('UPDATE taxes SET name = ?, computation = ?, amount = ?, is_active = ? WHERE id = ?')
    .run(v.name, v.computation, v.amount, v.is_active ?? tax.is_active, tax.id);
  return get(tax.id);
}

function setActive(id, active) {
  const tax = h.findOr404('taxes', id, 'Tax');
  db.prepare('UPDATE taxes SET is_active = ? WHERE id = ?').run(active ? 1 : 0, tax.id);
  return get(tax.id);
}

function remove(id) {
  const tax = h.findOr404('taxes', id, 'Tax');
  const used = h.usage(REFS, tax.id);
  if (used.total > 0) throw h.inUseConflict('tax', used);
  db.prepare('DELETE FROM taxes WHERE id = ?').run(tax.id);
}

module.exports = { list, get, create, update, setActive, remove };
