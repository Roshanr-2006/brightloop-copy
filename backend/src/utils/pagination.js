'use strict';

/**
 * Read ?page=&limit= safely.  Default 20 per page, max 100.
 *   const { page, limit, offset } = parsePagination(req.query);
 */
function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const toInt = (v, fallback) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const limit = Math.min(toInt(query.limit, defaultLimit), maxLimit);
  const page = toInt(query.page, 1);
  return { page, limit, offset: (page - 1) * limit };
}

/** Standard list response: { items, total, page, pages, limit } */
function paged(items, total, { page, limit }) {
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escape % and _ so user search text is matched literally in LIKE ... ESCAPE '\' */
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Whitelist a sort column: sortBy(req.query.sort, { name: 'p.name', price: 'p.sales_price' }, 'p.name') */
function sortBy(requested, allowed, fallback) {
  const [key, dir] = String(requested || '').split(':');
  const column = allowed[key] || fallback;
  return `${column} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
}

module.exports = { parsePagination, paged, likePattern, sortBy };
