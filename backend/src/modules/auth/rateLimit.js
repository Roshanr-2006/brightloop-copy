'use strict';

// Tiny in-memory fixed-window rate limiter (per IP + bucket name).
// Good enough for a single-process deployment; resets when the server restarts.

const { HttpError } = require('../../utils/httpError');

function rateLimit({ name, max = 10, windowMs = 60 * 1000 }) {
  const hits = new Map();
  const limit = process.env.NODE_ENV === 'test' ? Number(process.env.AUTH_RATE_LIMIT_TEST || 1000) : max;
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new HttpError(429, 'Too many attempts. Please wait a minute and try again.'));
    }
    return next();
  };
}

module.exports = rateLimit;
