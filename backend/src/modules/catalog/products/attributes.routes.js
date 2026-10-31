'use strict';

// /api/catalog/attributes  (GET: admin + staff, writes: admin)
//   GET    /                          attributes with values
//   GET    /:id
//   POST   /                          { name, values?: [] }
//   PUT    /:id                       { name }
//   DELETE /:id                       409 when any value is used by a variant
//   POST   /:id/values                { name }
//   PUT    /:id/values/:valueId       { name }
//   DELETE /:id/values/:valueId       409 when used by a variant

const express = require('express');
const validate = require('../../../middleware/validate');
const { requireAdmin } = require('../../../middleware/roles');
const ctrl = require('./attributes.controller');
const { validateAttribute, validateValue } = require('./attributes.validators');

const router = express.Router();

router.get('/', ctrl.list);
router.get('/:id(\\d+)', ctrl.get);
router.post('/', requireAdmin, validate(validateAttribute), ctrl.create);
router.put('/:id(\\d+)', requireAdmin, validate(validateAttribute), ctrl.update);
router.delete('/:id(\\d+)', requireAdmin, ctrl.remove);
router.post('/:id(\\d+)/values', requireAdmin, validate(validateValue), ctrl.addValue);
router.put('/:id(\\d+)/values/:valueId(\\d+)', requireAdmin, validate(validateValue), ctrl.updateValue);
router.delete('/:id(\\d+)/values/:valueId(\\d+)', requireAdmin, ctrl.removeValue);

module.exports = router;
