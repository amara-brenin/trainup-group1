const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const config = require("../config");

const normalizeAwsCredentials = () => {
  const rawAccessKeyId = String(config.aws.accessKeyId || "").trim();
  const rawSecretAccessKey = String(config.aws.secretAccessKey || "").trim();

  if (rawAccessKeyId.startsWith("AKIA")) {
    return {
      accessKeyId: rawAccessKeyId,
      secretAccessKey: rawSecretAccessKey,
    };
  }

  if (rawSecretAccessKey.startsWith("AKIA")) {
    return {
      accessKeyId: rawSecretAccessKey,
      secretAccessKey: rawAccessKeyId,
    };
  }

  return {
    accessKeyId: rawAccessKeyId,
    secretAccessKey: rawSecretAccessKey,
  };
};

const credentials = normalizeAwsCredentials();
const isStorageConfigured = Boolean(
  config.aws.region && config.aws.bucketName && credentials.accessKeyId && credentials.secretAccessKey,
);

let s3Client = null;

const getS3Client = () => {
  if (!isStorageConfigured) {
    throw new Error("AWS S3 is not configured for this deployment.");
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      credentials,
    });
  }

  return s3Client;
};

const sanitizeFileName = (fileName) =>
  String(fileName || "asset.bin")
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const createStorageKey = ({ fileName, category = "slides" }) => {
  const uniqueId = crypto.randomUUID();
  return `trainup/${category}/${uniqueId}-${sanitizeFileName(fileName)}`;
};

const createUploadUrl = async ({ key, mimeType }) => {
  const command = new PutObjectCommand({
    Bucket: config.aws.bucketName,
    Key: key,
    ContentType: mimeType,
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: 60 * 5 });
};

const uploadObject = async ({ key, mimeType, body }) => {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: config.aws.bucketName,
      Key: key,
      ContentType: mimeType,
      Body: body,
    }),
  );
};

const createReadUrl = async ({ key }) => {
  const command = new GetObjectCommand({
    Bucket: config.aws.bucketName,
    Key: key,
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: 60 * 30 });
};

const deleteObject = async ({ key }) => {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: config.aws.bucketName,
      Key: key,
    }),
  );
};

module.exports = {
  isStorageConfigured,
  createStorageKey,
  createUploadUrl,
  uploadObject,
  createReadUrl,
  deleteObject,
};
