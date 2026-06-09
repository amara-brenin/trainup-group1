// Structured JSON logger for the Group Training Hall subsystem.
//
// Every line is a single JSON object so log aggregators (CloudWatch, Loki,
// Datadog, ELK) can index by `category`, `level`, `gsId`, etc.
//
// Categories: scheduler | lifecycle | join | qa | error | perf | socket

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;
const PRETTY = String(process.env.LOG_PRETTY || "").toLowerCase() === "true";

const emit = (level, category, message, meta = {}) => {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    category,
    msg: message,
    ...meta,
  };
  const line = PRETTY ? `[${entry.ts}] ${level.toUpperCase()} ${category}: ${message} ${JSON.stringify(meta)}` : JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

// Per-category helpers.
const makeCategory = (category) => ({
  debug: (msg, meta) => emit("debug", category, msg, meta),
  info: (msg, meta) => emit("info", category, msg, meta),
  warn: (msg, meta) => emit("warn", category, msg, meta),
  error: (msg, meta) => emit("error", category, msg, meta),
});

module.exports = {
  scheduler: makeCategory("scheduler"),
  lifecycle: makeCategory("lifecycle"),
  join: makeCategory("join"),
  qa: makeCategory("qa"),
  socket: makeCategory("socket"),
  perf: makeCategory("perf"),
  error: makeCategory("error"),
  log: emit,
};
