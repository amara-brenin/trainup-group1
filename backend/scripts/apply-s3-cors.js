require("dotenv").config();

const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");

const parseList = (value, fallback = []) => {
  const normalized = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length ? normalized : fallback;
};

const normalizeAwsCredentials = () => {
  const rawAccessKeyId = String(process.env.AWS_ACCESS_KEY_ID || "").trim();
  const rawSecretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY || "").trim();

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
const region = String(process.env.AWS_S3_REGION || process.env.AWS_REGION || "ap-south-1").trim();
const bucket = String(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "").trim();
const origins = parseList(process.env.CORS_ORIGINS, [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://trainup-gamma.vercel.app",
  "https://trainup-pi.vercel.app",
  "https://temp-trainup-frontend-deploy.vercel.app",
]);

if (!bucket || !credentials.accessKeyId || !credentials.secretAccessKey) {
  console.error("Missing AWS bucket or credentials. Check backend env vars before applying S3 CORS.");
  process.exit(1);
}

const client = new S3Client({
  region,
  credentials,
});

const command = new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedHeaders: ["*"],
        AllowedMethods: ["GET", "HEAD", "PUT"],
        AllowedOrigins: origins,
        ExposeHeaders: ["ETag", "Content-Length", "Content-Type", "Last-Modified", "x-amz-request-id", "x-amz-id-2"],
        MaxAgeSeconds: 3000,
      },
    ],
  },
});

(async () => {
  await client.send(command);
  console.log(`Applied S3 CORS rules to ${bucket} for ${origins.join(", ")}`);
})().catch((error) => {
  console.error("Failed to apply S3 CORS rules.", error);
  process.exit(1);
});
