import rateLimit from 'express-rate-limit';

// Per-IP limiter for public endpoints that reveal account existence.
export const publicAuthLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, try again shortly' } });
  },
});
