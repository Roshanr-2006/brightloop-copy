'use strict';

const service = require('./billing.service');

function run(req, res) {
  const body = req.body || {};
  res.json(service.runBilling({
    date: body.date || undefined,
    userId: req.user.id,
    autoConfirm: body.auto_confirm === true || body.auto_confirm === 'true',
  }));
}

function preview(req, res) {
  res.json(service.previewBilling({ date: req.query.date || undefined }));
}

module.exports = { run, preview };
