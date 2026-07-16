export const isValidUrl = (value: string) => {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Strips everything except digits as the user types, so a phone field can
// never end up holding letters/symbols in the first place. Capped at 15
// digits (E.164 max length).
export const sanitizePhoneInput = (value: string) => value.replace(/\D/g, "").slice(0, 15);

export const isValidPhone = (value: string) => /^\d{7,15}$/.test(value);

export const ensureArray = (value: string | string[]) =>
  Array.isArray(value)
    ? value.filter(Boolean)
    : value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

export const isDeepEqual = (first: unknown, second: unknown) =>
  JSON.stringify(first) === JSON.stringify(second);
