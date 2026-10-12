import rateLimit from 'express-rate-limit';

// Stricter limit for the platform console's "send me a code" call, which now says whether an email is staff.
export const platformOtpRequestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in a minute' } });
  },
});

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
