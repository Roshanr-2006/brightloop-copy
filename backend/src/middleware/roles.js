'use strict';

// Role checks (use AFTER requireAuth):
//   router.post('/', requireAuth, requireRole('admin'), ctrl.create)          admin only
//   router.get('/',  requireAuth, requireRole('admin', 'staff'), ctrl.list)   internal users
//   router.get('/mine', requireAuth, requireRole('customer'), ctrl.mine)     portal

const { unauthorized, forbidden } = require('../utils/httpError');

const ROLES = Object.freeze({ ADMIN: 'admin', STAFF: 'staff', CUSTOMER: 'customer' });

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

const requireAdmin = requireRole(ROLES.ADMIN);
const requireInternal = requireRole(ROLES.ADMIN, ROLES.STAFF);

module.exports = { ROLES, requireRole, requireAdmin, requireInternal };
