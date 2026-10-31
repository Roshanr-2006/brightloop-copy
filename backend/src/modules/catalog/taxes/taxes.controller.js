'use strict';

const { crudController } = require('../catalog.crud');
const service = require('./taxes.service');

module.exports = crudController(service);
