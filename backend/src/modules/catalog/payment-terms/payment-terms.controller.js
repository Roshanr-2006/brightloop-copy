'use strict';

const { crudController } = require('../catalog.crud');
const service = require('./payment-terms.service');

module.exports = crudController(service);
