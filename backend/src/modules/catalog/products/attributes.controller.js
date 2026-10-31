'use strict';

const service = require('./attributes.service');

module.exports = {
  list: (req, res) => res.json(service.list(req.query)),
  get: (req, res) => res.json(service.get(req.params.id)),
  create: (req, res) => res.status(201).json(service.create(req.body)),
  update: (req, res) => res.json(service.update(req.params.id, req.body)),
  remove: (req, res) => {
    service.remove(req.params.id);
    res.status(204).end();
  },
  addValue: (req, res) => res.status(201).json(service.addValue(req.params.id, req.body)),
  updateValue: (req, res) => res.json(service.updateValue(req.params.id, req.params.valueId, req.body)),
  removeValue: (req, res) => {
    service.removeValue(req.params.id, req.params.valueId);
    res.status(204).end();
  },
};
