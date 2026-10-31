'use strict';

const { crudController } = require('../catalog.crud');
const service = require('./templates.service');

module.exports = crudController(service);
