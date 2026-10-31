'use strict';

const h = require('../catalog.helpers');

/** Attribute: { name, values?: string[] } (values only used on create) */
function validateAttribute(body) {
  const errors = {};
  const value = {
    name: h.text(body, 'name', errors, { required: true, min: 1, max: 60, label: 'Name' }),
    values: [],
  };
  if (body.values !== undefined && body.values !== null) {
    if (!Array.isArray(body.values)) errors.values = 'Values must be a list';
    else {
      value.values = body.values.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (value.values.some((x) => x.length > 60)) errors.values = 'Each value must be at most 60 characters';
    }
  }
  return { errors, value };
}

/** Attribute value: { name } */
function validateValue(body) {
  const errors = {};
  const value = { name: h.text(body, 'name', errors, { required: true, min: 1, max: 60, label: 'Value' }) };
  return { errors, value };
}

module.exports = { validateAttribute, validateValue };
