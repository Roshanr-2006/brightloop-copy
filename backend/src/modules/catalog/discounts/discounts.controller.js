'use strict';

const { crudController } = require('../catalog.crud');
const service = require('./discounts.service');

module.exports = crudController(service);
