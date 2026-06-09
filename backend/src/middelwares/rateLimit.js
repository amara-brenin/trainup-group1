const rateLimit = require("express-rate-limit");

// Rate limiters for public Group Training Hall endpoints to deter QR/code
// scanning, join spam, and Q&A flooding. Limits are per-IP and tunable via env.
// Disabled automatically in test to avoid flakiness.
const disabled = process.env.NODE_ENV === "test";

const make = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled,
    message: { status: false, message, data: {} },
  });

// QR/code resolution: protect against enumeration of tokens/codes.
const resolveLimiter = make(
  Number(process.env.RL_RESOLVE_WINDOW_MS || 60 * 1000),
  Number(process.env.RL_RESOLVE_MAX || 30),
  "Too many requests. Please slow down and try again shortly.",
);

// Join attempts: a trainee should not hammer join.
const joinLimiter = make(
  Number(process.env.RL_JOIN_WINDOW_MS || 60 * 1000),
  Number(process.env.RL_JOIN_MAX || 15),
  "Too many join attempts. Please wait a moment.",
);

// Q&A asks: bounded per IP (also server-gated to the active speaker).
const askLimiter = make(
  Number(process.env.RL_ASK_WINDOW_MS || 60 * 1000),
  Number(process.env.RL_ASK_MAX || 20),
  "Too many requests. Please slow down.",
);

module.exports = { resolveLimiter, joinLimiter, askLimiter };
