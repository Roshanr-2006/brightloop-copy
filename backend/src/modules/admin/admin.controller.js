'use strict';

const service = require('./admin.service');

const overview = (req, res) => res.json(service.overview());
const demoStatus = (req, res) => res.json(service.demoStatus());
const demoStart = (req, res) => res.status(202).json(service.startDemoLoad({ force: Boolean(req.body && req.body.force) }));
const importCustomers = async (req, res) => res.json(service.importCustomers(req.body && req.body.csv, { dryRun: Boolean(req.body && req.body.dryRun) }));

module.exports = { overview, demoStatus, demoStart, importCustomers };
