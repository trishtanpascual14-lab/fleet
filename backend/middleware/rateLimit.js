/**
 * Simple in-memory rate limiter.
 * keyGenerator: function(req) => string
 */
function rateLimit({ windowMs = 60000, max = 5, message = 'Too many requests', keyGenerator, statusCode = 429 }) {
  const store = new Map();
  // cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store.entries()) if (now > v.resetAt) store.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyGenerator ? keyGenerator(req) : (req.ip || 'global');
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    store.set(key, entry);
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(statusCode).json({ success: false, message, retryAfter });
    }
    next();
  };
}

module.exports = { rateLimit };
