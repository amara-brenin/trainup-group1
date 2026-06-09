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

export const ensureArray = (value: string | string[]) =>
  Array.isArray(value)
    ? value.filter(Boolean)
    : value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

export const isDeepEqual = (first: unknown, second: unknown) =>
  JSON.stringify(first) === JSON.stringify(second);
