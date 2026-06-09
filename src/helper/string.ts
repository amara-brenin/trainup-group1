export const toTitleCase = (value: string) =>
  value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const isUuidSegment = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const isObjectIdSegment = (value: string) =>
  /^[0-9a-f]{24}$/i.test(value) || /^[a-z]+-\d+$/i.test(value);

export const maskKey = (value: string, visible = 12) => {
  if (value.length <= visible) {
    return value;
  }

  return `${value.slice(0, visible)}••••`;
};
