'use strict';

const { db } = require('../../../db');
const h = require('../catalog.helpers');

const REFS = [['quotation_templates', 'payment_term_id'], ['subscriptions', 'payment_term_id']];

function list(query) {
  const where = [];
  const params = [];
  h.activeCondition(query, 'pt.is_active', where, params);
  h.searchCondition(query, ['pt.name'], where, params);
  return h.listQuery({
    select: `pt.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.payment_term_id = pt.id) AS subscription_count`,
    from: 'payment_terms pt',
    where,
    params,
    query,
    sortable: { name: 'pt.name', due_days: 'pt.due_days' },
    defaultSort: 'pt.due_days',
  });
}

function get(id) {
  const term = h.findOr404('payment_terms', id, 'Payment term');
  term.usage = h.usage(REFS, term.id);
  return term;
}

function create(v) {
  h.assertUniqueName('payment_terms', v.name, null, 'payment term');
  const info = db.prepare('INSERT INTO payment_terms (name, due_days, is_active) VALUES (?, ?, ?)')
    .run(v.name, v.due_days, v.is_active ?? 1);
  return get(Number(info.lastInsertRowid));
}

function update(id, v) {
  const term = h.findOr404('payment_terms', id, 'Payment term');
  h.assertUniqueName('payment_terms', v.name, term.id, 'payment term');
  db.prepare('UPDATE payment_terms SET name = ?, due_days = ?, is_active = ? WHERE id = ?')
    .run(v.name, v.due_days, v.is_active ?? term.is_active, term.id);
  return get(term.id);
}

function setActive(id, active) {
  const term = h.findOr404('payment_terms', id, 'Payment term');
  db.prepare('UPDATE payment_terms SET is_active = ? WHERE id = ?').run(active ? 1 : 0, term.id);
  return get(term.id);
}

function remove(id) {
  const term = h.findOr404('payment_terms', id, 'Payment term');
  const used = h.usage(REFS, term.id);
  if (used.total > 0) throw h.inUseConflict('payment term', used);
  db.prepare('DELETE FROM payment_terms WHERE id = ?').run(term.id);
}

module.exports = { list, get, create, update, setActive, remove };
