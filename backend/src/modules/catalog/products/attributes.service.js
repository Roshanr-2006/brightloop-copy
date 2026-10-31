'use strict';

// Product attributes ("Brand") and their values ("Odoo", "Brightloop").

const { db, transaction } = require('../../../db');
const { conflict, notFound } = require('../../../utils/httpError');
const h = require('../catalog.helpers');

function valuesOf(attributeId) {
  return db.prepare(`
    SELECT av.id, av.attribute_id, av.name,
           (SELECT COUNT(*) FROM product_variants v WHERE v.attribute_value_id = av.id) AS variant_count
    FROM product_attribute_values av
    WHERE av.attribute_id = ? ORDER BY av.name`).all(attributeId).map((r) => ({ ...r }));
}

/** All attributes with their values (small table, not paged). ?search= filters by attribute or value name. */
function list(query = {}) {
  const s = String(query.search || '').trim().toLowerCase();
  const rows = db.prepare('SELECT id, name FROM product_attributes ORDER BY name').all();
  const items = rows.map((a) => ({ ...a, values: valuesOf(a.id) }))
    .filter((a) => !s || a.name.toLowerCase().includes(s) || a.values.some((v) => v.name.toLowerCase().includes(s)));
  return { items, total: items.length };
}

function get(id) {
  const a = h.findOr404('product_attributes', id, 'Attribute');
  return { ...a, values: valuesOf(a.id) };
}

function assertUniqueValue(attributeId, name, exceptId = null) {
  const row = db.prepare(`SELECT id FROM product_attribute_values
    WHERE attribute_id = ? AND lower(name) = lower(?) AND id IS NOT ?`).get(attributeId, name, exceptId);
  if (row) throw conflict(`The value "${name}" already exists for this attribute`, { name: 'This value already exists' });
}

function create(v) {
  h.assertUniqueName('product_attributes', v.name, null, 'attribute');
  const lower = v.values.map((x) => x.toLowerCase());
  if (new Set(lower).size !== lower.length) throw conflict('Attribute values must be unique', { values: 'Duplicate values' });
  const id = transaction(() => {
    const attrId = Number(db.prepare('INSERT INTO product_attributes (name) VALUES (?)').run(v.name).lastInsertRowid);
    const ins = db.prepare('INSERT INTO product_attribute_values (attribute_id, name) VALUES (?, ?)');
    for (const name of v.values) ins.run(attrId, name);
    return attrId;
  });
  return get(id);
}

function update(id, v) {
  const a = h.findOr404('product_attributes', id, 'Attribute');
  h.assertUniqueName('product_attributes', v.name, a.id, 'attribute');
  db.prepare('UPDATE product_attributes SET name = ? WHERE id = ?').run(v.name, a.id);
  return get(a.id);
}

function remove(id) {
  const a = h.findOr404('product_attributes', id, 'Attribute');
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM product_variants v
    JOIN product_attribute_values av ON av.id = v.attribute_value_id WHERE av.attribute_id = ?`).get(a.id);
  if (n > 0) throw conflict(`This attribute is used by ${n} product variant(s). Remove those variants first.`);
  db.prepare('DELETE FROM product_attributes WHERE id = ?').run(a.id);
}

function findValue(attributeId, valueId) {
  const row = db.prepare('SELECT * FROM product_attribute_values WHERE id = ? AND attribute_id = ?')
    .get(Number(valueId), Number(attributeId));
  if (!row) throw notFound('Attribute value not found');
  return { ...row };
}

function addValue(attributeId, v) {
  const a = h.findOr404('product_attributes', attributeId, 'Attribute');
  assertUniqueValue(a.id, v.name);
  const info = db.prepare('INSERT INTO product_attribute_values (attribute_id, name) VALUES (?, ?)').run(a.id, v.name);
  return { ...findValue(a.id, Number(info.lastInsertRowid)), variant_count: 0, attribute_name: a.name };
}

function updateValue(attributeId, valueId, v) {
  const val = findValue(attributeId, valueId);
  assertUniqueValue(val.attribute_id, v.name, val.id);
  db.prepare('UPDATE product_attribute_values SET name = ? WHERE id = ?').run(v.name, val.id);
  return valuesOf(val.attribute_id).find((x) => x.id === val.id);
}

function removeValue(attributeId, valueId) {
  const val = findValue(attributeId, valueId);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM product_variants WHERE attribute_value_id = ?').get(val.id);
  if (n > 0) throw conflict(`This value is used by ${n} product variant(s). Remove those variants first.`);
  db.prepare('DELETE FROM product_attribute_values WHERE id = ?').run(val.id);
}

module.exports = { list, get, create, update, remove, addValue, updateValue, removeValue };
