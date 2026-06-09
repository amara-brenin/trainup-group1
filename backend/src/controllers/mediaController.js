const crypto = require("crypto");
const MediaAsset = require("../models/MediaAsset");
const config = require("../config");
const { ok, fail } = require("../helpers/response");
const { createStorageKey, createUploadUrl, uploadObject, createReadUrl, deleteObject, isStorageConfigured } = require("../helpers/storage");
const { getTenantClientId } = require("../helpers/tenant");

const createUploadSlot = async (req, res) => {
  if (!isStorageConfigured) {
    return fail(res, 503, "S3 storage is not configured on this deployment.");
  }

  const fileName = String(req.body.fileName || "").trim();
  const mimeType = String(req.body.mimeType || "application/octet-stream").trim();
  const fileSize = Number(req.body.fileSize || 0);

  if (!fileName) {
    return fail(res, 400, "File name is required.");
  }

  if (fileSize && fileSize > config.limits.maxUploadSizeMb * 1024 * 1024) {
    return fail(res, 400, `File must be ${config.limits.maxUploadSizeMb}MB or smaller.`);
  }

  const clientId = getTenantClientId(req.user);
  const assetId = `media-${crypto.randomUUID()}`;
  const key = createStorageKey({
    fileName,
    category: req.body.originalFile ? "originals" : "slides",
  });
  const uploadUrl = await createUploadUrl({ key, mimeType });

  await MediaAsset.create({
    appId: assetId,
    clientId,
    key,
    name: fileName,
    mimeType,
    source: req.body.source || "image",
    pageNumber: req.body.pageNumber || null,
    extractedText: Array.isArray(req.body.extractedText) ? req.body.extractedText : [],
    interactiveHotspots: Array.isArray(req.body.interactiveHotspots) ? req.body.interactiveHotspots : [],
    originalFile: Boolean(req.body.originalFile),
    uploadedBy: req.user.appId,
  });

  return ok(res, "Upload URL created.", {
    assetId,
    key,
    uploadUrl,
  });
};

const resolve = async (req, res) => {
  if (!isStorageConfigured) {
    return fail(res, 503, "S3 storage is not configured on this deployment.");
  }

  const clientId = getTenantClientId(req.user);
  const asset = await MediaAsset.findOne({ appId: req.params.id, clientId }).lean();

  if (!asset) {
    return fail(res, 404, "Media asset not found.");
  }

  const url = await createReadUrl({ key: asset.key });
  return ok(res, "Media asset resolved.", {
    id: asset.appId,
    name: asset.name,
    mimeType: asset.mimeType,
    source: asset.source,
    pageNumber: asset.pageNumber,
    extractedText: asset.extractedText || [],
    interactiveHotspots: asset.interactiveHotspots || [],
    url,
  });
};

const uploadBinary = async (req, res) => {
  if (!isStorageConfigured) {
    return fail(res, 503, "S3 storage is not configured on this deployment.");
  }

  const clientId = getTenantClientId(req.user);
  const asset = await MediaAsset.findOne({ appId: req.params.id, clientId });

  if (!asset) {
    return fail(res, 404, "Media asset not found.");
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return fail(res, 400, "Upload file body is required.");
  }

  if (req.body.length > config.limits.maxUploadSizeMb * 1024 * 1024) {
    return fail(res, 400, `File must be ${config.limits.maxUploadSizeMb}MB or smaller.`);
  }

  await uploadObject({
    key: asset.key,
    mimeType: asset.mimeType,
    body: req.body,
  });

  return ok(res, "Media uploaded successfully.", {
    id: asset.appId,
  });
};

const remove = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const asset = await MediaAsset.findOne({ appId: req.params.id, clientId });

  if (!asset) {
    return fail(res, 404, "Media asset not found.");
  }

  if (isStorageConfigured) {
    await deleteObject({ key: asset.key });
  }

  await MediaAsset.deleteOne({ appId: asset.appId });
  return ok(res, "Media asset removed successfully.", true);
};

module.exports = {
  createUploadSlot,
  uploadBinary,
  resolve,
  remove,
};
