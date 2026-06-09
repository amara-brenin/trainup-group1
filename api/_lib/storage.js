import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const normalizeAwsCredentials = () => {
  const rawAccessKeyId = String(process.env.AWS_ACCESS_KEY_ID ?? "").trim();
  const rawSecretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();

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

const region = String(process.env.AWS_S3_REGION || process.env.AWS_REGION || "").trim();
const bucketName = String(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "").trim();
const credentials = normalizeAwsCredentials();

export const isStorageConfigured = Boolean(region && bucketName && credentials.accessKeyId && credentials.secretAccessKey);

let s3Client = null;

const getS3Client = () => {
  if (!isStorageConfigured) {
    throw new Error("AWS S3 is not configured for this deployment.");
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region,
      credentials,
    });
  }

  return s3Client;
};

const sanitizeFileName = (fileName) =>
  fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const createStorageKey = ({ fileName, category = "slides" }) => {
  const uniqueId = crypto.randomUUID();
  const safeName = sanitizeFileName(fileName || "asset.bin");
  return `trainup/${category}/${uniqueId}-${safeName}`;
};

export const createUploadUrl = async ({ key, mimeType }) => {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: mimeType,
  });

  return getSignedUrl(client, command, { expiresIn: 60 * 5 });
};

export const createReadUrl = async ({ key }) => {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: 60 * 30 });
};

export const deleteObject = async ({ key }) => {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );
};
