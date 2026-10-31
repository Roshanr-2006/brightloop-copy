'use strict';

/** Wrap async route handlers so thrown errors reach errorHandler (Express 4). */
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
