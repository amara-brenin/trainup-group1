const { isStorageConfigured, createStorageKey, uploadPublicObject } = require("./storage");

// Matches "data:image/<subtype>;base64,<data>" — the format the frontend
// sends for user avatars, super admin avatars, and client branding images
// before this migration moved storage from inline base64 to S3 URLs.
const BASE64_IMAGE_PREFIX = /^data:image\/([a-zA-Z0-9.+-]+);base64,/i;

const isBase64Image = (value) => typeof value === "string" && BASE64_IMAGE_PREFIX.test(value);

const EXTENSION_BY_MIME_SUBTYPE = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  gif: "gif",
  webp: "webp",
  "svg+xml": "svg",
  svg: "svg",
};

const extensionForMimeSubtype = (subtype) => EXTENSION_BY_MIME_SUBTYPE[subtype.toLowerCase()] || "png";

// Uploads a base64 data URI to S3 (public-read) and returns the resulting URL.
// `category` groups objects under trainup/<category>/... in the bucket, e.g.
// "avatars", "super-admin-avatars", "client-logos", "client-dark-logos",
// "client-favicons", "client-email-signatures".
const uploadBase64Image = async ({ base64, category }) => {
  const match = base64.match(BASE64_IMAGE_PREFIX);
  if (!match) {
    return null;
  }

  const mimeSubtype = match[1];
  const data = base64.slice(match[0].length);
  const buffer = Buffer.from(data, "base64");
  const key = createStorageKey({ fileName: `image.${extensionForMimeSubtype(mimeSubtype)}`, category });

  return uploadPublicObject({ key, mimeType: `image/${mimeSubtype}`, body: buffer });
};

// Shared resolver used everywhere a User/SuperAdmin/Client image field is
// written: base64 input is uploaded to S3 and replaced with the resulting
// URL; an existing http(s) URL or any other value (empty string, local
// static path like "/branding/avatar.png") is returned unchanged.
const resolveImageField = async (value, category) => {
  const trimmed = String(value || "").trim();

  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (!isBase64Image(trimmed)) {
    return trimmed;
  }

  if (!isStorageConfigured) {
    // No S3 in this environment — keep the base64 value rather than
    // silently discarding the image the user just uploaded.
    return trimmed;
  }

  try {
    const url = await uploadBase64Image({ base64: trimmed, category });
    return url || trimmed;
  } catch (error) {
    // Upload failure shouldn't block the save — fall back to the original
    // value so the user doesn't lose their image.
    return trimmed;
  }
};

module.exports = {
  isBase64Image,
  uploadBase64Image,
  resolveImageField,
};
