const rateLimitStore = new Map();
const MAX_STORED_KEYS = 10000;

function pruneExpiredKeys(now) {
  if (rateLimitStore.size < MAX_STORED_KEYS) return;

  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.expiresAt) rateLimitStore.delete(key);
  }
}

function getClientKey(req, name) {
  return `${name}:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

export function createRateLimiter({ name, windowMs, maxRequests }) {
  return (req, res, next) => {
    const key = getClientKey(req, name);
    const now = Date.now();
    pruneExpiredKeys(now);

    const current = rateLimitStore.get(key);

    if (!current || now > current.expiresAt) {
      rateLimitStore.set(key, {
        count: 1,
        expiresAt: now + windowMs,
      });
      return next();
    }

    current.count += 1;

    if (current.count > maxRequests) {
      return res.status(429).json({
        error: "Too many attempts. Please try again later.",
      });
    }

    return next();
  };
}

export function getRateLimitStats() {
  return {
    keys: rateLimitStore.size,
  };
}
