'use strict';

// Standard controller + router wiring for catalog resources.
// Every resource exposes:
//   GET    /            list (paged: { items, total, page, pages, limit })
//   GET    /:id         one row
//   POST   /            create            (admin)
//   PUT    /:id         update            (admin)
//   PATCH  /:id/archive set is_active = 0 (admin)
//   PATCH  /:id/restore set is_active = 1 (admin)
//   DELETE /:id         hard delete only when nothing references it, else 409 (admin)

const express = require('express');
const validate = require('../../middleware/validate');
const { requireAdmin, requireInternal } = require('../../middleware/roles');

/** Thin controller over a service with list/get/create/update/setActive/remove. */
function crudController(service) {
  return {
    list: (req, res) => res.json(service.list(req.query, req.user)),
    get: (req, res) => res.json(service.get(req.params.id, req.user)),
    create: (req, res) => res.status(201).json(service.create(req.body, req.user)),
    update: (req, res) => res.json(service.update(req.params.id, req.body, req.user)),
    archive: (req, res) => res.json(service.setActive(req.params.id, false)),
    restore: (req, res) => res.json(service.setActive(req.params.id, true)),
    remove: (req, res) => {
      service.remove(req.params.id);
      res.status(204).end();
    },
  };
}

/**
 * Router with the standard endpoints.
 * @param {object} ctrl controller from crudController
 * @param {Function} validator body validator
 * @param {{ readRole?: Function, extend?: (router) => void }} options
 *        readRole: middleware for GETs (default requireInternal = admin + staff)
 *        extend:   register extra routes BEFORE the /:id routes
 */
function crudRouter(ctrl, validator, { readRole = requireInternal, extend } = {}) {
  const router = express.Router();
  if (extend) extend(router);
  router.get('/', readRole, ctrl.list);
  router.get('/:id(\\d+)', readRole, ctrl.get);
  router.post('/', requireAdmin, validate(validator), ctrl.create);
  router.put('/:id(\\d+)', requireAdmin, validate(validator), ctrl.update);
  router.patch('/:id(\\d+)/archive', requireAdmin, ctrl.archive);
  router.patch('/:id(\\d+)/restore', requireAdmin, ctrl.restore);
  router.delete('/:id(\\d+)', requireAdmin, ctrl.remove);
  return router;
}

module.exports = { crudController, crudRouter };
