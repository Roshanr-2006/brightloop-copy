'use strict';

const { crudController } = require('../catalog.crud');
const service = require('./products.service');

module.exports = {
  ...crudController(service),
  options: (req, res) => res.json({ items: service.options() }),
};
