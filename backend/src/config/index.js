require("dotenv").config();

const defaultGoogleClientId =
  "1015361335506-ll9napmrgctu2slrmajpt43csje374tu.apps.googleusercontent.com";

const parseList = (value, fallback = []) => {
  const normalized = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length ? normalized : fallback;
};

module.exports = {
  port: Number(process.env.PORT || 3001),
  apiPrefix: String(process.env.API_PREFIX || "/api-v1").trim(),
  mongoUri: String(process.env.MONGO_URI || "").trim(),
  authSecret: String(process.env.AUTH_SECRET || "trainup-render-insecure-dev-secret").trim(),
  frontendBaseUrl: String(process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL || "").trim().replace(/\/+$/, ""),
  // Deployment subpath the admin SPA is served under (mirrors the frontend
  // VITE_BASE_URL). "" or "/" => root deployment (no prefix). e.g. "/trainup-demo".
  publicBasePath: (() => {
    let value = String(process.env.PUBLIC_BASE_PATH || "").trim();
    if (!value || value === "/") return "";
    if (!value.startsWith("/")) value = `/${value}`;
    return value.replace(/\/+$/, "");
  })(),
  adminAppUrl: String(process.env.ADMIN_APP_URL || process.env.FRONTEND_ADMIN_URL || "").trim().replace(/\/+$/, ""),
  superAdminAppUrl: String(process.env.SUPERADMIN_APP_URL || process.env.FRONTEND_SUPERADMIN_URL || "").trim().replace(/\/+$/, ""),
  platformEmail: {
    enabled: String(process.env.BRENIN_SMTP_ENABLED || process.env.PLATFORM_SMTP_ENABLED || "true").trim() !== "false",
    host: String(process.env.BRENIN_SMTP_HOST || process.env.PLATFORM_SMTP_HOST || "").trim(),
    port: Number(process.env.BRENIN_SMTP_PORT || process.env.PLATFORM_SMTP_PORT || 587),
    username: String(process.env.BRENIN_SMTP_USERNAME || process.env.PLATFORM_SMTP_USERNAME || "").trim(),
    password: String(process.env.BRENIN_SMTP_PASSWORD || process.env.PLATFORM_SMTP_PASSWORD || "").trim(),
    fromName: String(process.env.BRENIN_SMTP_FROM_NAME || process.env.PLATFORM_SMTP_FROM_NAME || "Brenin Trainup").trim(),
    fromEmail: String(process.env.BRENIN_SMTP_FROM_EMAIL || process.env.PLATFORM_SMTP_FROM_EMAIL || "").trim(),
    secure: String(process.env.BRENIN_SMTP_SECURE || process.env.PLATFORM_SMTP_SECURE || "false").trim() === "true",
  },
  corsOrigins: parseList(process.env.CORS_ORIGINS, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "https://trainup-gamma.vercel.app",
    "https://temp-trainup-frontend-deploy.vercel.app",
  ]),
  aws: {
    accessKeyId: String(process.env.AWS_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
    region: String(process.env.AWS_S3_REGION || process.env.AWS_REGION || "ap-south-1").trim(),
    bucketName: String(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "").trim(),
  },
  elevenlabs: {
    apiKey: String(process.env.ELEVENLABS_API_KEY || "").trim(),
    modelId: String(process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_flash_v2_5").trim(),
    voiceName: String(process.env.ELEVENLABS_TTS_VOICE_NAME || "Anurja - Auto Sales Follow-Ups (Female )").trim(),
    voiceId: String(process.env.ELEVENLABS_TTS_VOICE_ID || "").trim(),
  },
  groq: {
    baseUrl: String(process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1").trim().replace(/\/+$/, ""),
    apiKey: String(process.env.GROQ_API_KEY || "").trim(),
    model: String(process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim(),
    systemPrompt: String(
      process.env.GROQ_SYSTEM_PROMPT ||
        "You are a helpful assistant working for Samsung. Your name is Amara, a girl. Keep your responses between 16 and 35 words. Your words will be spoken by a voice agent so avoid the use of mark-up language, asterisks and emojis. Only speak in understandable sentences. Do not describe in words any facial expressions you might have. When talking about yourself always talk in the first person. your conversation always in female indian pronouciations.",
    ).trim(),
  },
  trulience: {
    avatarId: String(process.env.TRULIENCE_AVATAR_ID || "1647619895205577317").trim(),
    apiKey: String(process.env.TRULIENCE_REST_API_KEY || "").trim(),
    sttProvider: String(process.env.TRULIENCE_STT_PROVIDER || "Trulience").trim(),
    language: String(process.env.TRULIENCE_LANGUAGE || "english (india)(en-IN)").trim(),
    additionalLanguages: parseList(process.env.TRULIENCE_ADDITIONAL_LANGUAGES, ["Hindi (India)"]),
  },
  google: {
    clientId: String(process.env.GOOGLE_CLIENT_ID || defaultGoogleClientId).trim(),
    allowedDomains: parseList(process.env.GOOGLE_ALLOWED_DOMAINS),
  },
  limits: {
    maxUploadSizeMb: 50,
  },
};
