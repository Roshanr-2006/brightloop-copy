'use strict';

// Products + variants + default taxes.
// A variant = product + one attribute value (e.g. Brand = Odoo) with an extra price.
// Final price of a variant = product.sales_price + variant.extra_price.

const { db, transaction } = require('../../../db');
const { round2 } = require('../../../utils/money');
const { unprocessable } = require('../../../utils/httpError');
const h = require('../catalog.helpers');
const { variantLabel } = require('../catalog.service');

const PRODUCT_REFS = [
  ['quotation_template_lines', 'product_id'],
  ['subscription_lines', 'product_id'],
  ['invoice_lines', 'product_id'],
  ['discount_products', 'product_id'],
];
const VARIANT_REFS = [
  ['quotation_template_lines', 'variant_id'],
  ['subscription_lines', 'variant_id'],
  ['invoice_lines', 'variant_id'],
];

const VARIANT_SELECT = `
  SELECT v.id, v.product_id, v.attribute_value_id, v.extra_price, v.is_active,
         av.name AS value_name, a.id AS attribute_id, a.name AS attribute_name
  FROM product_variants v
  JOIN product_attribute_values av ON av.id = v.attribute_value_id
  JOIN product_attributes a ON a.id = av.attribute_id`;

function shapeVariant(v, salesPrice) {
  return {
    ...v,
    name: variantLabel(v.attribute_name, v.value_name),
    extra_price: Number(v.extra_price),
    final_price: round2(Number(salesPrice) + Number(v.extra_price)),
  };
}

/** Variants of a product (all, or only active), with labels and final prices. */
function variantsOf(productId, salesPrice, { activeOnly = false, withUsage = false } = {}) {
  const rows = db.prepare(`${VARIANT_SELECT}
    WHERE v.product_id = ? ${activeOnly ? 'AND v.is_active = 1' : ''}
    ORDER BY a.name, av.name`).all(productId);
  return rows.map((r) => {
    const v = shapeVariant({ ...r }, salesPrice);
    if (withUsage) v.in_use = h.usage(VARIANT_REFS, v.id).total > 0;
    return v;
  });
}

function taxesOf(productId, { activeOnly = false } = {}) {
  return db.prepare(`
    SELECT t.id, t.name, t.computation, t.amount, t.is_active
    FROM product_taxes pt JOIN taxes t ON t.id = pt.tax_id
    WHERE pt.product_id = ? ${activeOnly ? 'AND t.is_active = 1' : ''}
    ORDER BY t.name`).all(productId).map((r) => ({ ...r }));
}

function list(query) {
  const where = [];
  const params = [];
  h.activeCondition(query, 'p.is_active', where, params);
  h.searchCondition(query, ['p.name', 'p.notes'], where, params);
  if (['service', 'goods', 'addon'].includes(query.type)) {
    where.push('p.type = ?');
    params.push(query.type);
  }
  const withVariants = String(query.with || '').split(',').includes('variants');
  return h.listQuery({
    select: `p.*,
      (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
      (SELECT group_concat(t.name, ', ') FROM product_taxes pt JOIN taxes t ON t.id = pt.tax_id
        WHERE pt.product_id = p.id) AS tax_names`,
    from: 'products p',
    where,
    params,
    query,
    sortable: {
      name: 'p.name', price: 'p.sales_price', sales_price: 'p.sales_price', cost: 'p.cost_price',
      type: 'p.type', created: 'p.created_at',
    },
    defaultSort: 'p.name',
    map: (r) => (withVariants ? { ...r, variants: variantsOf(r.id, r.sales_price) } : r),
  });
}

/**
 * Lightweight picker data for subscription / template forms:
 * active products with their active variants and active taxes.
 */
function options() {
  const products = db.prepare(`
    SELECT id, name, type, sales_price FROM products WHERE is_active = 1 ORDER BY name`).all();
  return products.map((p) => ({
    ...p,
    variants: variantsOf(p.id, p.sales_price, { activeOnly: true })
      .map(({ id, name, extra_price, final_price }) => ({ id, name, extra_price, final_price })),
    taxes: taxesOf(p.id, { activeOnly: true }).map(({ id, name, computation, amount }) => ({ id, name, computation, amount })),
  }));
}

function get(id) {
  const p = h.findOr404('products', id, 'Product');
  p.taxes = taxesOf(p.id);
  p.tax_ids = p.taxes.map((t) => t.id);
  p.variants = variantsOf(p.id, p.sales_price, { withUsage: true });
  p.usage = h.usage(PRODUCT_REFS, p.id);
  return p;
}

function checkRefs(v) {
  const errors = {};
  const badTaxes = h.missingIds('taxes', v.tax_ids);
  if (badTaxes.length) errors.tax_ids = `Unknown tax id(s): ${badTaxes.join(', ')}`;
  const valueIds = v.variants.map((x) => x.attribute_value_id);
  const badValues = h.missingIds('product_attribute_values', valueIds);
  v.variants.forEach((x, i) => {
    if (badValues.includes(x.attribute_value_id)) errors[`variants.${i}.attribute_value_id`] = 'Unknown attribute value';
  });
  if (Object.keys(errors).length) throw unprocessable(errors);
}

function saveTaxes(productId, taxIds) {
  db.prepare('DELETE FROM product_taxes WHERE product_id = ?').run(productId);
  const ins = db.prepare('INSERT INTO product_taxes (product_id, tax_id) VALUES (?, ?)');
  for (const taxId of taxIds) ins.run(productId, taxId);
}

/**
 * Sync variants: update rows that match (by id or by attribute value), insert new ones,
 * delete removed ones when unused, or deactivate them when they are referenced.
 */
function saveVariants(productId, variants) {
  const existing = db.prepare('SELECT id, attribute_value_id FROM product_variants WHERE product_id = ?')
    .all(productId).map((r) => ({ ...r }));
  const byId = new Map(existing.map((r) => [r.id, r]));
  const byValue = new Map(existing.map((r) => [r.attribute_value_id, r]));
  const kept = new Set();
  const errors = {};

  variants.forEach((v, i) => {
    if (v.id && !byId.has(v.id)) errors[`variants.${i}.id`] = 'This variant does not belong to the product';
  });
  if (Object.keys(errors).length) throw unprocessable(errors);

  // Remove first so an attribute value can move between rows without hitting UNIQUE.
  const incomingIds = new Set(variants.map((v) => v.id || (byValue.get(v.attribute_value_id) || {}).id).filter(Boolean));
  for (const row of existing) {
    if (incomingIds.has(row.id)) continue;
    if (h.usage(VARIANT_REFS, row.id).total > 0) {
      db.prepare('UPDATE product_variants SET is_active = 0 WHERE id = ?').run(row.id);
      kept.add(row.attribute_value_id);
    } else {
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(row.id);
    }
  }

  const upd = db.prepare('UPDATE product_variants SET attribute_value_id = ?, extra_price = ?, is_active = ? WHERE id = ?');
  const ins = db.prepare('INSERT INTO product_variants (product_id, attribute_value_id, extra_price, is_active) VALUES (?, ?, ?, ?)');
  variants.forEach((v, i) => {
    const id = v.id || (byValue.get(v.attribute_value_id) || {}).id;
    if (id) {
      const clash = db.prepare('SELECT id FROM product_variants WHERE product_id = ? AND attribute_value_id = ? AND id <> ?')
        .get(productId, v.attribute_value_id, id);
      if (clash) {
        throw unprocessable({ [`variants.${i}.attribute_value_id`]: 'An archived variant already uses this value' });
      }
      upd.run(v.attribute_value_id, v.extra_price, v.is_active, id);
    } else {
      if (kept.has(v.attribute_value_id)) {
        throw unprocessable({ [`variants.${i}.attribute_value_id`]: 'An archived variant already uses this value' });
      }
      ins.run(productId, v.attribute_value_id, v.extra_price, v.is_active);
    }
  });
}

function assertUniqueProduct(name, exceptId) {
  h.assertUniqueName('products', name, exceptId, 'product');
}

function create(v) {
  checkRefs(v);
  assertUniqueProduct(v.name, null);
  const id = transaction(() => {
    const info = db.prepare(`INSERT INTO products (name, type, sales_price, cost_price, notes, is_active)
      VALUES (?, ?, ?, ?, ?, ?)`).run(v.name, v.type, v.sales_price, v.cost_price, v.notes, v.is_active ?? 1);
    const productId = Number(info.lastInsertRowid);
    saveTaxes(productId, v.tax_ids);
    saveVariants(productId, v.variants);
    return productId;
  });
  return get(id);
}

function update(id, v) {
  const p = h.findOr404('products', id, 'Product');
  checkRefs(v);
  assertUniqueProduct(v.name, p.id);
  transaction(() => {
    db.prepare(`UPDATE products SET name = ?, type = ?, sales_price = ?, cost_price = ?, notes = ?, is_active = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(v.name, v.type, v.sales_price, v.cost_price, v.notes, v.is_active ?? p.is_active, p.id);
    saveTaxes(p.id, v.tax_ids);
    saveVariants(p.id, v.variants);
  });
  return get(p.id);
}

function setActive(id, active) {
  const p = h.findOr404('products', id, 'Product');
  db.prepare(`UPDATE products SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(active ? 1 : 0, p.id);
  return get(p.id);
}

function remove(id) {
  const p = h.findOr404('products', id, 'Product');
  const used = h.usage([...PRODUCT_REFS], p.id);
  const variantUse = db.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(p.id)
    .reduce((n, v) => n + h.usage(VARIANT_REFS, v.id).total, 0);
  if (used.total + variantUse > 0) throw h.inUseConflict('product', used);
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
}

module.exports = { list, options, get, create, update, setActive, remove, variantsOf, taxesOf };
