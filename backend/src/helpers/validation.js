const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const isValidUrl = (value) => {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_error) {
    return false;
  }
};

const ensureArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

// Digits only (no letters/symbols) — mirrors the frontend's real-time filter
// as a server-side backstop for direct API calls.
const isValidPhone = (value) => /^\d{7,15}$/.test(String(value || "").trim());

// Strips everything except digits — used for bulk (CSV) import where rejecting
// the whole row over stray formatting (spaces/dashes) would be too punishing.
const sanitizePhoneInput = (value) => String(value || "").replace(/\D/g, "").slice(0, 15);

module.exports = {
  isValidEmail,
  isValidUrl,
  ensureArray,
  isValidPhone,
  sanitizePhoneInput,
};
