'use strict';

// Plug a validator into a route:
//   router.post('/', requireAuth, requireAdmin, validate(validateProduct), ctrl.create)
// A validator receives req.body and returns either
//   { errors: { field: 'message' }, value: cleanedBody }   or   just the errors object.
// On errors -> 422 { error, fields }.  On success req.body is replaced with the cleaned value.

const { unprocessable } = require('../utils/httpError');

function validate(validator) {
  return (req, res, next) => {
    const result = validator(req.body || {}, req) || {};
    const errors = result.errors !== undefined ? result.errors : result;
    if (errors && Object.keys(errors).length > 0) return next(unprocessable(errors));
    if (result.value !== undefined) req.body = result.value;
    return next();
  };
}

module.exports = validate;
