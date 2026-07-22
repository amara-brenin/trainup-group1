const crypto = require("crypto");
const Training = require("../models/Training");
const MediaAsset = require("../models/MediaAsset");
const Client = require("../models/Client");
const User = require("../models/User");
const { createReadUrl, isStorageConfigured } = require("../helpers/storage");
const {
  getCreditCosts,
  consumeClientCredits,
  ensureClientEntitlement,
  assertLifetimeQuota,
  assertSubscriptionActive,
} = require("../helpers/credits");
const { notifyRolesInClient, notifyTrainingOwner } = require("../helpers/notifications");
const { getTenantSetting, buildDefaultTenantAppSettings, syncClientMetrics } = require("../helpers/tenant");
const { ok, fail } = require("../helpers/response");
const { getBearerToken, verifyAuthToken } = require("../helpers/auth");
const { createGroqReply } = require("../helpers/groq");
const { signLaunchToken, verifyLaunchToken } = require("../helpers/launchToken");
const { deliverCompletionWebhook } = require("../helpers/clientDelivery");
const { deliverXapiStatement } = require("../helpers/xapi");
const { deliverLtiGrade } = require("../helpers/lti");
const { buildScormPackage } = require("../helpers/scorm");
const { buildPublicUrl } = require("../helpers/publicUrl");
const { getTenantClientId } = require("../helpers/tenant");
const config = require("../config");

const normalizeValue = (value) => String(value || "").trim();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const formatDateTime = (value = new Date()) =>
  value.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const formatSessionDateTime = (value) => {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return formatDateTime();
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return formatDateTime(parsed);
};
const formatTimeSpent = (seconds) => {
  const totalSeconds = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
};
const parseTimeSpentToSeconds = (value) => {
  const normalized = normalizeValue(value);
  const match = normalized.match(/(\d+)m\s+(\d+)s/i);

  if (!match) {
    return 0;
  }

  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
};
const parseSessionDate = (value) => {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return 0;
  }

  const direct = Date.parse(normalized);

  if (!Number.isNaN(direct)) {
    return direct;
  }

  const fallback = normalized.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2})$/,
  );

  if (!fallback) {
    return 0;
  }

  const [, day, month, year, hours, minutes] = fallback;
  const monthIndex = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].findIndex(
    (item) => item.toLowerCase() === String(month).toLowerCase(),
  );

  if (monthIndex < 0) {
    return 0;
  }

  return new Date(
    Number(year),
    monthIndex,
    Number(day),
    Number(hours),
    Number(minutes),
  ).getTime();
};
const clampProgress = (value, totalSlides) => {
  const safeTotal = Math.max(1, Number(totalSlides || 1));
  return Math.min(Math.max(Number(value || 0), 0), safeTotal);
};

const trulienceSessionStore = new Map();
const activeLaunchAskHistoryStore = new Map();

const parseCustomJsonPayload = (message) => {
  const normalized = normalizeValue(message);
  const match = normalized.match(/<custom-json[^>]*json=(['"])([\s\S]*?)\1[^>]*\/?>/i);

  if (!match?.[2]) {
    return null;
  }

  try {
    return JSON.parse(match[2]);
  } catch (_error) {
    return null;
  }
};

const sanitizeLaunchScript = ({ script, trainingTitle, slideTitle, index }) => {
  const normalizedScript = normalizeValue(script);
  return normalizedScript;
};

const buildAskKnowledgeBase = (trainingPayload) => {
  const slides = Array.isArray(trainingPayload?.slides) ? trainingPayload.slides : [];
  const knowledgeDocuments = Array.isArray(trainingPayload?.knowledgeDocuments)
    ? trainingPayload.knowledgeDocuments
    : [];
  const knowledgeBase = slides
    .map((slide, index) => {
      const extractedText = Array.isArray(slide.mediaExtractedText)
        ? slide.mediaExtractedText.map((item) => normalizeValue(item)).filter(Boolean).join(" ")
        : "";
      const points = Array.isArray(slide.points)
        ? slide.points.map((item) => normalizeValue(item)).filter(Boolean).join(". ")
        : "";
      const summary = [
        `Slide ${index + 1}: ${normalizeValue(slide.title) || "Untitled slide"}`,
        points,
        normalizeValue(slide.additionalInfo),
        extractedText,
      ]
        .filter(Boolean)
        .join("\n");
      return summary;
    })
    .filter(Boolean)
    .join("\n\n");

  const documentKnowledgeBase = knowledgeDocuments
    .map((document, index) => {
      const documentName = normalizeValue(document?.name) || `Knowledge document ${index + 1}`;
      const documentText = normalizeValue(document?.text);

      if (!documentText) {
        return "";
      }

      return [`Document ${index + 1}: ${documentName}`, documentText].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return [
    `Training title: ${normalizeValue(trainingPayload?.title)}`,
    knowledgeBase ? `Module knowledge base:\n${knowledgeBase}` : "",
    documentKnowledgeBase ? `Uploaded knowledge documents:\n${documentKnowledgeBase}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const findTrainingById = async (trainingId) => {
  const normalizedId = normalizeValue(trainingId);

  if (!normalizedId) {
    return null;
  }

  return Training.findOne({
    appId: { $regex: `^${escapeRegex(normalizedId)}$`, $options: "i" },
  }).lean();
};

const resolveViewer = async (req) => {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const payload = verifyAuthToken(token);

  if (!payload?.sub) {
    return null;
  }

  return User.findOne({ appId: payload.sub }).lean();
};

const canPreviewTraining = (viewer, training) => {
  if (!viewer || !training) {
    return false;
  }

  if (viewer.role === "super_admin") {
    return true;
  }

  return normalizeValue(viewer.clientId) && normalizeValue(viewer.clientId) === normalizeValue(training.clientId);
};

const canAccessLaunch = (viewer, training) => {
  if (!viewer || !training) {
    return false;
  }

  if (normalizeValue(viewer.status).toLowerCase() === "inactive") {
    return false;
  }

  if (viewer.role === "super_admin") {
    return true;
  }

  return normalizeValue(viewer.clientId) && normalizeValue(viewer.clientId) === normalizeValue(training.clientId);
};

const canAccessPublicLaunch = (training, viewer) =>
  normalizeValue(training?.payload?.status) === "approved" &&
  normalizeValue(viewer?.role) === "trainee" &&
  canAccessLaunch(viewer, training);

const isMultipleAttemptAllowed = (training) => training?.payload?.options?.allowMultipleAttempts !== false;

const resolveMaxAttempts = (training) => {
  if (!isMultipleAttemptAllowed(training)) {
    return 1;
  }

  const configuredMaxAttempts = Number(training?.payload?.options?.maxAttempts || 0);
  return Number.isFinite(configuredMaxAttempts) && configuredMaxAttempts > 0
    ? Math.floor(configuredMaxAttempts)
    : 0;
};

// Count a learner's already-completed LMS-launch attempts for a training
// (matched by their identity key = email or name). Used to enforce maxAttempts
// on external launches, where learners are guests (no logged-in attempt history).
const countCompletedLmsAttempts = (training, identityKey, excludeSessionId = "") => {
  const key = normalizeValue(identityKey).toLowerCase();
  if (!key) return 0;
  const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];
  return sessions.filter(
    (s) =>
      s?.viaLmsLaunch === true &&
      normalizeValue(s?.id) !== normalizeValue(excludeSessionId) &&
      normalizeValue(s?.status).toLowerCase() === "completed" &&
      normalizeValue(s?.ssoId).toLowerCase() === key,
  ).length;
};

const hasViewerCompletedTraining = (training, viewer) => {
  if (!training || !viewer) {
    return false;
  }

  const viewerEmail = normalizeValue(viewer?.email).toLowerCase();
  const viewerName = normalizeValue(viewer?.fullname || viewer?.name).toLowerCase();
  const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];

  return sessions.some((session) => {
    if (normalizeValue(session?.mode || "public") !== "public") {
      return false;
    }

    if (Boolean(session?.resetByAdmin)) {
      return false;
    }

    if (normalizeValue(session?.status).toLowerCase() !== "completed") {
      return false;
    }

    const sessionEmail = normalizeValue(session?.learnerEmail).toLowerCase();
    const sessionName = normalizeValue(session?.learnerName).toLowerCase();

    if (viewerEmail && sessionEmail) {
      return sessionEmail === viewerEmail;
    }

    return Boolean(viewerName && sessionName && sessionName === viewerName);
  });
};

const getPublicLaunchAccessError = (training, viewer) => {
  if (normalizeValue(training?.payload?.status) !== "approved") {
    return "Approved training launch was not found.";
  }

  if (normalizeValue(viewer?.role) !== "trainee" || !canAccessLaunch(viewer, training)) {
    return "Approved training launch was not found.";
  }

  const completedSessions = getViewerCompletedSessions(training, viewer);
  const maxAttempts = resolveMaxAttempts(training);

  if (!isMultipleAttemptAllowed(training) && completedSessions.length) {
    return "You have already completed this training. Multiple attempts are not allowed for this session.";
  }

  if (maxAttempts > 0 && completedSessions.length >= maxAttempts) {
    return `You have already used ${maxAttempts} training attempt${maxAttempts === 1 ? "" : "s"}.`;
  }

  return null;
};

const buildViewerIdentity = (viewer, sessionId, preview) => ({
  ssoId:
    normalizeValue(viewer?.email) ||
    normalizeValue(viewer?.name) ||
    normalizeValue(viewer?.fullname) ||
    (preview ? `Preview:${sessionId.slice(-8)}` : `Launch:${sessionId.slice(-8)}`),
  learnerName: normalizeValue(viewer?.fullname || viewer?.name),
  learnerEmail: normalizeValue(viewer?.email),
});

const buildSessionReuseCandidates = ({
  sessions,
  viewerIdentity,
  preview,
  requestedStartedAt,
}) => {
  const normalizedSsoId = normalizeValue(viewerIdentity?.ssoId);
  const targetMode = preview ? "preview" : "public";
  const referenceTimestamp = parseSessionDate(requestedStartedAt) || Date.now();

  return sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) =>
      normalizeValue(session?.ssoId) === normalizedSsoId &&
      normalizeValue(session?.mode || "public") === targetMode,
    )
    .filter(({ session }) => {
      const sessionTimestamp = parseSessionDate(session?.startedAt);
      const isInProgress = normalizeValue(session?.status).toLowerCase() === "in-progress";
      if (isInProgress) {
        return !sessionTimestamp || Math.abs(referenceTimestamp - sessionTimestamp) <= 15 * 60 * 1000;
      }

      if (!sessionTimestamp) {
        return false;
      }

      return Math.abs(referenceTimestamp - sessionTimestamp) <= 15 * 60 * 1000;
    })
    .sort((left, right) => {
      const leftStatus = normalizeValue(left.session?.status).toLowerCase() === "in-progress" ? 1 : 0;
      const rightStatus = normalizeValue(right.session?.status).toLowerCase() === "in-progress" ? 1 : 0;

      if (leftStatus !== rightStatus) {
        return rightStatus - leftStatus;
      }

      return parseSessionDate(right.session?.startedAt) - parseSessionDate(left.session?.startedAt);
    });
};

const findLaunchSessionIndex = ({
  sessions,
  sessionId,
  viewerIdentity,
  preview,
  requestedStartedAt,
}) => {
  const normalizedSessionId = normalizeValue(sessionId);

  if (normalizedSessionId) {
    const exactIndex = sessions.findIndex((session) => normalizeValue(session.id) === normalizedSessionId);

    if (exactIndex >= 0) {
      return exactIndex;
    }
  }

  const candidates = buildSessionReuseCandidates({
    sessions,
    viewerIdentity,
    preview,
    requestedStartedAt,
  });

  return candidates.length ? candidates[0].index : -1;
};

const getAttemptSessionsForViewer = ({ sessions = [], viewerIdentity, preview }) => {
  const normalizedSsoId = normalizeValue(viewerIdentity?.ssoId);
  const normalizedEmail = normalizeValue(viewerIdentity?.learnerEmail).toLowerCase();
  const normalizedName = normalizeValue(viewerIdentity?.learnerName).toLowerCase();
  const targetMode = preview ? "preview" : "public";

  return sessions
    .filter((session) => normalizeValue(session?.mode || "public") === targetMode)
    .filter((session) => {
      const sessionSsoId = normalizeValue(session?.ssoId);
      const sessionEmail = normalizeValue(session?.learnerEmail).toLowerCase();
      const sessionName = normalizeValue(session?.learnerName).toLowerCase();

      return Boolean(
        (normalizedSsoId && sessionSsoId === normalizedSsoId) ||
        (normalizedEmail && sessionEmail === normalizedEmail) ||
        (normalizedName && sessionName === normalizedName),
      );
    })
    .sort((left, right) => parseSessionDate(left?.startedAt) - parseSessionDate(right?.startedAt));
};

const dedupeAskHistory = (entries = []) => {
  const seen = new Set();

  return entries.filter((entry) => {
    const question = normalizeValue(entry?.question);
    const answer = normalizeValue(entry?.answer);
    const slideId = normalizeValue(entry?.slideId);
    const key = `${question.toLowerCase()}__${answer.toLowerCase()}__${slideId}`;

    if (!question || !answer || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const getCachedLaunchAskHistory = (sessionId) => {
  const normalizedSessionId = normalizeValue(sessionId);

  if (!normalizedSessionId) {
    return [];
  }

  return Array.isArray(activeLaunchAskHistoryStore.get(normalizedSessionId))
    ? activeLaunchAskHistoryStore.get(normalizedSessionId)
    : [];
};

const setCachedLaunchAskHistory = (sessionId, entries = []) => {
  const normalizedSessionId = normalizeValue(sessionId);

  if (!normalizedSessionId) {
    return;
  }

  const dedupedEntries = dedupeAskHistory(entries);

  if (!dedupedEntries.length) {
    activeLaunchAskHistoryStore.delete(normalizedSessionId);
    return;
  }

  activeLaunchAskHistoryStore.set(normalizedSessionId, dedupedEntries);
};

const mergeSessionRecords = (existing, incoming) => {
  const mergedViewedSlideIds = Array.from(
    new Set(
      [
        ...(Array.isArray(existing?.viewedSlideIds) ? existing.viewedSlideIds : []),
        ...(Array.isArray(incoming?.viewedSlideIds) ? incoming.viewedSlideIds : []),
      ]
        .map((item) => normalizeValue(item))
        .filter(Boolean),
    ),
  );
  const existingStatus = normalizeValue(existing?.status).toLowerCase();
  const incomingStatus = normalizeValue(incoming?.status).toLowerCase();
  const nextStatus =
    existingStatus === "completed" || incomingStatus === "completed"
      ? "completed"
      : existingStatus === "in-progress" || incomingStatus === "in-progress"
        ? "in-progress"
        : incoming?.status || existing?.status || "not-started";
  const existingSlidesViewed = Number(existing?.slidesViewed || 0);
  const incomingSlidesViewed = Number(incoming?.slidesViewed || 0);
  const existingTotalSlides = Number(existing?.totalSlides || 0);
  const incomingTotalSlides = Number(incoming?.totalSlides || 0);
  const nextTotalSlides = Math.max(existingTotalSlides, incomingTotalSlides, 1);
  const nextSlidesViewed = Math.max(existingSlidesViewed, incomingSlidesViewed, mergedViewedSlideIds.length);
  const existingScore = existing?.score;
  const incomingScore = incoming?.score;
  const existingStartedAtTs = parseSessionDate(existing?.startedAt);
  const incomingStartedAtTs = parseSessionDate(incoming?.startedAt);
  const nextStartedAt =
    existingStartedAtTs && incomingStartedAtTs
      ? existingStartedAtTs <= incomingStartedAtTs
        ? existing.startedAt
        : incoming.startedAt
      : existing?.startedAt || incoming?.startedAt || null;
  const nextCompletedAt = incomingStatus === "completed"
    ? incoming?.completedAt || existing?.completedAt || null
    : existingStatus === "completed"
      ? existing?.completedAt || incoming?.completedAt || null
      : incoming?.completedAt || existing?.completedAt || null;
  const mergedAskHistory = dedupeAskHistory([
    ...(Array.isArray(existing?.askHistory) ? existing.askHistory : []),
    ...(Array.isArray(existing?.askTranscripts) ? existing.askTranscripts : []),
    ...(Array.isArray(incoming?.askHistory) ? incoming.askHistory : []),
    ...(Array.isArray(incoming?.askTranscripts) ? incoming.askTranscripts : []),
  ]);
  const existingProctoringTs = parseSessionDate(existing?.proctoringReport?.completedAt || existing?.proctoringReport?.startedAt);
  const incomingProctoringTs = parseSessionDate(incoming?.proctoringReport?.completedAt || incoming?.proctoringReport?.startedAt);

  return {
    ...existing,
    ...incoming,
    id: normalizeValue(existing?.id) || normalizeValue(incoming?.id),
    ssoId: normalizeValue(existing?.ssoId) || normalizeValue(incoming?.ssoId),
    learnerName: normalizeValue(incoming?.learnerName) || normalizeValue(existing?.learnerName) || "",
    learnerEmail: normalizeValue(incoming?.learnerEmail) || normalizeValue(existing?.learnerEmail) || "",
    status: nextStatus,
    timeSpent: formatTimeSpent(
      Math.max(parseTimeSpentToSeconds(existing?.timeSpent), parseTimeSpentToSeconds(incoming?.timeSpent)),
    ),
    slidesViewed: nextSlidesViewed,
    totalSlides: nextTotalSlides,
    viewedSlideIds: mergedViewedSlideIds,
    score:
      incomingScore !== null && incomingScore !== undefined
        ? incomingScore
        : existingScore !== null && existingScore !== undefined
          ? existingScore
          : null,
    startedAt: nextStartedAt,
    completedAt: nextCompletedAt,
    correctAnswers: Math.max(Number(existing?.correctAnswers || 0), Number(incoming?.correctAnswers || 0)),
    totalQuestions: Math.max(Number(existing?.totalQuestions || 0), Number(incoming?.totalQuestions || 0)),
    progressPercent: Math.max(
      Number(existing?.progressPercent || 0),
      Number(incoming?.progressPercent || 0),
      Math.round((nextSlidesViewed / Math.max(nextTotalSlides, 1)) * 100),
    ),
    mode: incoming?.mode || existing?.mode || "public",
    askHistory: mergedAskHistory,
    askTranscripts: mergedAskHistory,
    attemptNo: Number(existing?.attemptNo || incoming?.attemptNo || 1),
    maxAttempts: Number(incoming?.maxAttempts || existing?.maxAttempts || 0),
    isRetake: Boolean(incoming?.isRetake ?? existing?.isRetake),
    bestScore:
      [existing?.bestScore, incoming?.bestScore, existing?.score, incoming?.score]
        .filter((value) => typeof value === "number" && Number.isFinite(value))
        .reduce((max, value) => Math.max(max, value), -Infinity) === -Infinity
        ? null
        : [existing?.bestScore, incoming?.bestScore, existing?.score, incoming?.score]
          .filter((value) => typeof value === "number" && Number.isFinite(value))
          .reduce((max, value) => Math.max(max, value), -Infinity),
    latestScore:
      incoming?.latestScore !== null && incoming?.latestScore !== undefined
        ? incoming.latestScore
        : incomingScore !== null && incomingScore !== undefined
          ? incomingScore
          : existing?.latestScore ?? existingScore ?? null,
    resetByAdmin: Boolean(incoming?.resetByAdmin ?? existing?.resetByAdmin),
    resetAt: incoming?.resetAt || existing?.resetAt || null,
    resetBy: incoming?.resetBy || existing?.resetBy || null,
    proctoringReport:
      incoming?.proctoringReport && (!existing?.proctoringReport || incomingProctoringTs >= existingProctoringTs)
        ? incoming.proctoringReport
        : existing?.proctoringReport || incoming?.proctoringReport || null,
  };
};

const collapseDuplicateSessions = (sessions = []) => {
  const mergedSessions = [];

  sessions.forEach((session) => {
    const duplicateIndex = findLaunchSessionIndex({
      sessions: mergedSessions,
      sessionId: "",
      viewerIdentity: { ssoId: normalizeValue(session?.ssoId) },
      preview: normalizeValue(session?.mode) === "preview",
      requestedStartedAt: session?.startedAt,
    });

    if (duplicateIndex >= 0 && normalizeValue(mergedSessions[duplicateIndex]?.id) !== normalizeValue(session?.id)) {
      mergedSessions[duplicateIndex] = mergeSessionRecords(mergedSessions[duplicateIndex], session);
      return;
    }

    mergedSessions.push(session);
  });

  return mergedSessions.sort((left, right) => parseSessionDate(right?.startedAt) - parseSessionDate(left?.startedAt));
};

const buildResolvedSlide = async (slide, clientId, order) => {
  let mediaUrl = "";

  if (slide?.mediaAssetId && isStorageConfigured) {
    const asset = await MediaAsset.findOne({
      appId: slide.mediaAssetId,
      clientId,
    }).lean();

    if (asset?.key) {
      mediaUrl = await createReadUrl({ key: asset.key });
    }
  }

  return {
    id: slide?.id || `slide-${order + 1}`,
    order,
    title: slide?.title || `Slide ${order + 1}`,
    script: normalizeValue(slide?.script),
    mediaUrl,
    mediaName: normalizeValue(slide?.mediaName),
    interactiveHotspots: Array.isArray(slide?.interactiveHotspots) ? slide.interactiveHotspots : [],
    settings: slide?.settings || {},
    formFields: Array.isArray(slide?.formFields) ? slide.formFields : [],
    formConfig: slide?.formConfig || {},
    additionalInfo: normalizeValue(slide?.additionalInfo),
    narrationAudio: slide?.narrationAudio || null,
  };
};

const buildResolvedLocalizedSlide = async (slide, clientId) => {
  let mediaUrl = "";

  if (slide?.mediaAssetId && isStorageConfigured) {
    const asset = await MediaAsset.findOne({
      appId: slide.mediaAssetId,
      clientId,
    }).lean();

    if (asset?.key) {
      mediaUrl = await createReadUrl({ key: asset.key });
    }
  }

  return {
    slideId: normalizeValue(slide?.slideId),
    script: normalizeValue(slide?.script),
    narrationAudio: slide?.narrationAudio || null,
    translatedAt: slide?.translatedAt || null,
    audioUpdatedAt: slide?.audioUpdatedAt || null,
    mediaAssetId: normalizeValue(slide?.mediaAssetId) || null,
    mediaName: normalizeValue(slide?.mediaName) || null,
    mediaSource: slide?.mediaSource || null,
    mediaPageNumber: slide?.mediaPageNumber ?? null,
    mediaMimeType: normalizeValue(slide?.mediaMimeType) || null,
    mediaExtractedText: Array.isArray(slide?.mediaExtractedText) ? slide.mediaExtractedText : [],
    interactiveHotspots: Array.isArray(slide?.interactiveHotspots) ? slide.interactiveHotspots : [],
    mediaUrl,
  };
};

const normalizeLocalizedVoiceovers = async (value, clientId) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const languages = Array.isArray(value.languages)
    ? await Promise.all(
      value.languages.map(async (language, languageIndex) => ({
        code: normalizeValue(language?.code) || `language-${languageIndex + 1}`,
        locale: normalizeValue(language?.locale),
        label: normalizeValue(language?.label),
        isDefault: Boolean(language?.isDefault),
        provider: normalizeValue(language?.provider || "ElevenLabs"),
        voiceId: normalizeValue(language?.voiceId),
        voiceName: normalizeValue(language?.voiceName),
        buttonLabels: language?.buttonLabels || null,
        translatedSlides: Array.isArray(language?.translatedSlides)
          ? await Promise.all(
            language.translatedSlides.map((slide) => buildResolvedLocalizedSlide(slide, clientId)),
          )
          : [],
      })),
    )
    : [];

  if (!languages.length) {
    return null;
  }

  const defaultLanguageCode =
    normalizeValue(value.defaultLanguageCode) ||
    languages.find((language) => language.isDefault)?.code ||
    languages[0].code;

  return {
    defaultLanguageCode,
    languages: languages.map((language) => ({
      ...language,
      isDefault: language.code === defaultLanguageCode,
    })),
  };
};

const buildResolvedPreviewThumbnailUrl = async (assetId, clientId) => {
  const normalizedAssetId = normalizeValue(assetId);

  if (!normalizedAssetId || !isStorageConfigured) {
    return "";
  }

  const asset = await MediaAsset.findOne({
    appId: normalizedAssetId,
    clientId,
  }).lean();

  if (!asset?.key) {
    return "";
  }

  return createReadUrl({ key: asset.key });
};

const buildLearnerSessionHistory = async ({ training, viewer }) => {
  const viewerEmail = normalizeValue(viewer?.email).toLowerCase();
  const viewerName = normalizeValue(viewer?.fullname || viewer?.name).toLowerCase();

  if (!viewerEmail && !viewerName) {
    return [];
  }

  const trainings = await Training.find(
    { clientId: training.clientId },
    { appId: 1, "payload.title": 1, "payload.audience": 1, "payload.sessions": 1 },
  ).lean();

  return trainings
    .flatMap((record) => {
      const trainingTitle = normalizeValue(record?.payload?.title) || "Untitled Training";
      const trainingAudience = normalizeValue(record?.payload?.audience) || "";
      const sessions = Array.isArray(record?.payload?.sessions) ? record.payload.sessions : [];

      return sessions
        .filter((session) => {
          const sessionEmail = normalizeValue(session?.learnerEmail).toLowerCase();
          const sessionName = normalizeValue(session?.learnerName).toLowerCase();

          if (viewerEmail && sessionEmail) {
            return sessionEmail === viewerEmail;
          }

          return Boolean(viewerName && sessionName && sessionName === viewerName);
        })
        .map((session) => ({
          sessionId: normalizeValue(session?.id) || `launch-session-${crypto.randomUUID()}`,
          trainingId: normalizeValue(record?.appId),
          trainingTitle,
          trainingType: normalizeValue(record?.payload?.type) || "",
          trainingAudience,
          status: normalizeValue(session?.status) || "not-started",
          timeSpent: normalizeValue(session?.timeSpent) || "0m 00s",
          slidesViewed: Number(session?.slidesViewed || 0),
          totalSlides: Number(session?.totalSlides || 0),
          startedAt: normalizeValue(session?.startedAt) || "",
          completedAt: normalizeValue(session?.completedAt) || "",
        }));
    })
    .sort((left, right) => parseSessionDate(right.startedAt || right.completedAt) - parseSessionDate(left.startedAt || left.completedAt));
};

const buildLaunchBrandingPayload = async (training) => {
  const client = await Client.findOne({ appId: training.clientId }).lean();
  const tenantAppSettings = await getTenantSetting(training.clientId, "appSettings", {});
  const trainingBranding = training.payload?.branding || {};
  const branding = {
    ...(client ? buildDefaultTenantAppSettings(client) : {}),
    ...(tenantAppSettings || {}),
    application_name:
      trainingBranding.applicationName ||
      trainingBranding.application_name ||
      tenantAppSettings?.application_name ||
      client?.applicationName ||
      client?.name ||
      "Trainup",
    companyName: trainingBranding.companyName || client?.name || "",
    email: trainingBranding.supportEmail || tenantAppSettings?.email || client?.supportEmail || "support@trainup.ai",
    logo:
      trainingBranding.logoUrl ||
      tenantAppSettings?.logo ||
      client?.logoUrl ||
      "/branding/logo.png",
    logoUrl: trainingBranding.logoUrl || tenantAppSettings?.logo || client?.logoUrl || "",
    dark_logo:
      trainingBranding.darkLogoUrl ||
      tenantAppSettings?.dark_logo ||
      client?.darkLogoUrl ||
      client?.logoUrl ||
      "/branding/logo-dark.png",
    darkLogoUrl:
      trainingBranding.darkLogoUrl ||
      tenantAppSettings?.dark_logo ||
      client?.darkLogoUrl ||
      client?.logoUrl ||
      "",
    favicon:
      trainingBranding.faviconUrl ||
      tenantAppSettings?.favicon ||
      client?.faviconUrl ||
      "/branding/favicon.png",
    faviconUrl:
      trainingBranding.faviconUrl ||
      tenantAppSettings?.favicon ||
      client?.faviconUrl ||
      "",
    loaderTitle: trainingBranding.loaderTitle || "Preparing Training",
    loaderCaption:
      trainingBranding.loaderCaption || "Camera verification and session checks are in progress.",
    copyright:
      trainingBranding.companyName ||
      trainingBranding.applicationName ||
      trainingBranding.application_name ||
      client?.name ||
      client?.applicationName
        ? `© ${new Date().getFullYear()} ${
          trainingBranding.companyName ||
          trainingBranding.applicationName ||
          trainingBranding.application_name ||
          client?.name ||
          client?.applicationName
        }. All rights reserved.`
        : `© ${new Date().getFullYear()} Trainup. All rights reserved.`,
    primaryColor: client?.primaryColor || training.payload?.theme?.primaryBg || "#ff6200",
    secondaryColor: client?.secondaryColor || training.payload?.theme?.secondaryBg || "#dcdde0",
  };
  branding.copyright = `\u00A9 ${new Date().getFullYear()} ${
    trainingBranding.companyName ||
    trainingBranding.applicationName ||
    trainingBranding.application_name ||
    client?.name ||
      client?.applicationName ||
      "Trainup"
  }. All rights reserved.`;

  return branding;
};

const buildLaunchPayload = async ({ training, viewer, preview }) => {
  const branding = await buildLaunchBrandingPayload(training);

  const slides = await Promise.all(
    (Array.isArray(training.payload?.slides) ? training.payload.slides : []).map((slide, index) =>
      buildResolvedSlide(slide, training.clientId, index),
    ),
  );
  const previewThumbnailUrl = await buildResolvedPreviewThumbnailUrl(
    training.payload?.previewThumbnailAssetId,
    training.clientId,
  );
  const localizedVoiceovers = await normalizeLocalizedVoiceovers(
    training.payload?.localizedVoiceovers,
    training.clientId,
  );
  const learnerSessionHistory = preview || !viewer
    ? []
    : await buildLearnerSessionHistory({ training, viewer });

  return {
    id: training.appId,
    title: normalizeValue(training.payload?.title),
    type: normalizeValue(training.payload?.type),
    audience: normalizeValue(training.payload?.audience),
    trainer: normalizeValue(training.payload?.trainer),
    status: normalizeValue(training.payload?.status),
    isPublished: Boolean(training.payload?.isPublished),
    publishedOn: training.payload?.publishedOn || null,
    trainingMode: normalizeValue(training.payload?.trainingMode || "avatar"),
    avatarName: normalizeValue(training.payload?.avatarName),
    avatarId: normalizeValue(training.payload?.avatarId),
    ttsMode: normalizeValue(training.payload?.ttsMode || "auto"),
    ttsProvider: normalizeValue(training.payload?.ttsProvider || "ElevenLabs"),
    voiceName: normalizeValue(training.payload?.voiceName),
    voiceId: normalizeValue(training.payload?.voiceId),
    questionButtonLabel: normalizeValue(training.payload?.questionButtonLabel || "Ask Question"),
    askSystemPrompt: normalizeValue(training.payload?.askSystemPrompt),
    presenterNotes: normalizeValue(training.payload?.presenterNotes),
    previewSlideId: normalizeValue(training.payload?.previewSlideId) || null,
    previewThumbnailAssetId: normalizeValue(training.payload?.previewThumbnailAssetId) || null,
    previewThumbnailAssetName: normalizeValue(training.payload?.previewThumbnailAssetName) || null,
    previewThumbnailUrl,
    durationMins: Number(training.payload?.durationMins || 0),
    maxDurationMins: Number(training.payload?.maxDurationMins || 0),
    options: training.payload?.options || {},
    theme: training.payload?.theme || {},
    avatarEngine: training.payload?.avatarEngine || null,
    localizedVoiceovers,
    questionCheckpoints: Array.isArray(training.payload?.questionCheckpoints) ? training.payload.questionCheckpoints : [],
    questionSets: Array.isArray(training.payload?.questionSets) ? training.payload.questionSets : [],
    sessions: Array.isArray(training.payload?.sessions) ? training.payload.sessions : [],
    learnerSessionHistory,
    slides,
    branding,
    launchMode: preview ? "preview" : "public",
    viewerName: normalizeValue(viewer?.fullname || viewer?.name || viewer?.email),
  };
};

const getTrainingBranding = async (req, res) => {
  const training = await findTrainingById(req.params.id);

  if (!training) {
    return fail(res, 404, "Training launch was not found.");
  }

  return ok(res, "Training branding loaded.", {
    trainingId: training.appId,
    branding: await buildLaunchBrandingPayload(training),
  });
};

const getViewerCompletedSessions = (training, viewer) => {
  if (!training || !viewer) {
    return [];
  }

  const viewerEmail = normalizeValue(viewer?.email).toLowerCase();
  const viewerName = normalizeValue(viewer?.fullname || viewer?.name).toLowerCase();
  const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];

  return sessions.filter((session) => {
    if (normalizeValue(session?.mode || "public") !== "public" || Boolean(session?.resetByAdmin)) {
      return false;
    }

    if (normalizeValue(session?.status).toLowerCase() !== "completed") {
      return false;
    }

    const sessionEmail = normalizeValue(session?.learnerEmail).toLowerCase();
    const sessionName = normalizeValue(session?.learnerName).toLowerCase();

    if (viewerEmail && sessionEmail) {
      return sessionEmail === viewerEmail;
    }

    return Boolean(viewerName && sessionName && sessionName === viewerName);
  });
};

const getTraining = async (req, res) => {
  const training = await findTrainingById(req.params.id);

  if (!training) {
    return fail(res, 404, "Training launch was not found.");
  }

  const preview = ["1", "true", "preview"].includes(normalizeValue(req.query.preview).toLowerCase());
  const viewer = await resolveViewer(req);

  if (preview) {
    if (!canPreviewTraining(viewer, training)) {
      return fail(res, 403, "You do not have access to this preview launch.");
    }
  } else if (!viewer) {
    return fail(res, 401, "Launch login is required to access this training.");
  } else {
    const accessError = getPublicLaunchAccessError(training, viewer);

    if (accessError) {
      return fail(res, accessError.includes("already completed") ? 403 : 404, accessError);
    }
  }

  const payload = await buildLaunchPayload({ training, viewer, preview });
  return ok(res, `${preview ? "Preview" : "Approved"} training launch loaded successfully.`, payload);
};

const upsertLaunchSession = async (req, res) => {

  // console.log("Complete Request Body:");
  // console.log(JSON.stringify(req.body, null, 2));


  const training = await findTrainingById(req.params.id);

  if (!training) {
    return fail(res, 404, "Training launch was not found.");
  }

  const preview = Boolean(req.body.preview);
  const viewer = await resolveViewer(req);

  if (preview) {
    if (!canPreviewTraining(viewer, training)) {
      return fail(res, 403, "You do not have access to this preview launch.");
    }
  } else if (!viewer) {
    return fail(res, 401, "Launch login is required to access this training.");
  } else {
    const accessError = getPublicLaunchAccessError(training, viewer);

    if (accessError) {
      return fail(
        res,
        403,
        accessError.includes("already completed") ? accessError : "This training is not currently approved.",
      );
    }
  }

  const action = normalizeValue(req.body.action || "progress").toLowerCase();
  const slidesViewed = clampProgress(req.body.slidesViewed, req.body.totalSlides);
  const totalSlides = Math.max(1, Number(req.body.totalSlides || 1));
  const progressPercent = Math.round((slidesViewed / totalSlides) * 100);
  const explicitScore = req.body.score;
  const correctAnswers = Number(req.body.correctAnswers || 0);
  const totalQuestions = Number(req.body.totalQuestions || 0);
  const score =
    explicitScore === null || explicitScore === undefined || explicitScore === ""
      ? totalQuestions > 0
        ? Math.round((correctAnswers / Math.max(totalQuestions, 1)) * 100)
        : null
      : Number(explicitScore);
  const proctoringReport =
    req.body.proctoringReport && typeof req.body.proctoringReport === "object"
      ? req.body.proctoringReport
      : null;
  const viewedSlideIds = Array.from(
    new Set(
      (Array.isArray(req.body.viewedSlideIds) ? req.body.viewedSlideIds : [])
        .map((item) => normalizeValue(item))
        .filter(Boolean),
    ),
  );
  const requestedSessionId = normalizeValue(req.body.sessionId);
  const viewerIdentity = buildViewerIdentity(viewer, requestedSessionId, preview);
  const sessions = Array.isArray(training.payload?.sessions) ? [...training.payload.sessions] : [];
  const reusableSessionIndex = findLaunchSessionIndex({
    sessions,
    sessionId: requestedSessionId,
    viewerIdentity,
    preview,
    requestedStartedAt: req.body.startedAt,
  });
  const sessionId =
    requestedSessionId ||
    (reusableSessionIndex >= 0 ? normalizeValue(sessions[reusableSessionIndex]?.id) : "") ||
    `launch-session-${crypto.randomUUID()}`;
  const existingIndex = sessions.findIndex((session) => normalizeValue(session.id) === sessionId);
  const existingSession = existingIndex >= 0 ? sessions[existingIndex] : null;
  const viewerAttemptSessions = getAttemptSessionsForViewer({ sessions, viewerIdentity, preview });
  const existingAttemptNo = Number(existingSession?.attemptNo || 0);
  const attemptNo = existingAttemptNo || viewerAttemptSessions.length + 1;
  const completedAttemptScores = viewerAttemptSessions
    .filter((session) => normalizeValue(session?.status).toLowerCase() === "completed" && !session?.resetByAdmin)
    .map((session) => Number(session?.score))
    .filter((value) => Number.isFinite(value));
  const latestScore = typeof score === "number" && Number.isFinite(score) ? score : (existingSession?.latestScore ?? existingSession?.score ?? null);
  const bestScoreCandidates = [
    ...completedAttemptScores,
    typeof latestScore === "number" ? latestScore : null,
    typeof existingSession?.bestScore === "number" ? existingSession.bestScore : null,
  ].filter((value) => typeof value === "number" && Number.isFinite(value));
  const maxAttempts = resolveMaxAttempts(training);
  const nextStatus = action === "complete" ? "completed" : action === "start" ? "in-progress" : "in-progress";
  const askHistory = Array.isArray(req.body.askHistory)
    ? req.body.askHistory
      .map((entry) => ({
        question: normalizeValue(entry?.question),
        answer: normalizeValue(entry?.answer),
        askedAt: normalizeValue(entry?.askedAt) || formatDateTime(),
        inputMode: normalizeValue(entry?.inputMode) || "typed",
        sttProvider: normalizeValue(entry?.sttProvider) || null,
        language: normalizeValue(entry?.language) || null,
        slideId: normalizeValue(entry?.slideId) || null,
      }))
      .filter((entry) => entry.question && entry.answer)
    : [];
  const mergedAskHistory = dedupeAskHistory([
    ...getCachedLaunchAskHistory(sessionId),
    ...(Array.isArray(existingSession?.askTranscripts) ? existingSession.askTranscripts : []),
    ...askHistory,
  ]);
  const nextSessionRecord = {
    id: sessionId,
    ssoId: normalizeValue(req.body.ssoId) || viewerIdentity.ssoId,
    learnerName: viewerIdentity.learnerName,
    learnerEmail: viewerIdentity.learnerEmail,
    status: nextStatus,
    timeSpent: formatTimeSpent(req.body.timeSpentSeconds),
    slidesViewed,
    totalSlides,
    viewedSlideIds,
    score,
    startedAt: formatSessionDateTime(req.body.startedAt),
    completedAt: action === "complete" ? formatDateTime() : null,
    correctAnswers,
    totalQuestions,
    progressPercent,
    mode: preview ? "preview" : "public",
    askHistory: mergedAskHistory,
    askTranscripts: mergedAskHistory,
    attemptNo,
    maxAttempts,
    isRetake: attemptNo > 1,
    bestScore: bestScoreCandidates.length ? Math.max(...bestScoreCandidates) : null,
    latestScore,
    resetByAdmin: Boolean(existingSession?.resetByAdmin),
    resetAt: existingSession?.resetAt || null,
    resetBy: existingSession?.resetBy || null,
    proctoringReport,
  };
  const isNewCompletedSession =
    action === "complete" &&
    normalizeValue(existingSession?.status).toLowerCase() !== "completed";

  if (isNewCompletedSession) {
    const client = await Client.findOne({ appId: training.clientId });

    // Issue 1: expired subscriptions cannot consume a new session.
    const expiredError = assertSubscriptionActive(client);
    if (expiredError) {
      return fail(res, 402, expiredError);
    }

    // Issue 2: session limit is LIFETIME (total ever created), not current count
    // — deleting/resetting sessions never reclaims quota. Mirrors group sessions.
    if (client && !client.quotaInitialized) {
      const publishedCount = await Training.countDocuments({
        clientId: training.clientId,
        "payload.status": "approved",
      });
      await ensureClientEntitlement(client, {
        training: publishedCount,
        session: Number(client.sessions || 0),
        user: Number(client.activeUsers || 0),
      });
    }
    const usageError = client ? assertLifetimeQuota(client, "session", 1) : null;

    if (usageError) {
      return fail(res, 403, usageError);
    }

    const creditResult = await consumeClientCredits({
      clientId: training.clientId,
      credits: (await getCreditCosts(client)).session,
      reason: `Training session completed by ${viewerIdentity.learnerEmail || viewerIdentity.learnerName || "learner"}`,
    });

    if (!creditResult.ok) {
      return fail(res, 400, creditResult.message);
    }

    // Permanently record lifetime session usage (never decremented on delete).
    if (client) {
      client.sessionUsedLifetime = Number(client.sessionUsedLifetime || 0) + 1;
      await client.save();
    }
  }

  if (existingIndex >= 0) {
    sessions[existingIndex] = mergeSessionRecords(sessions[existingIndex], nextSessionRecord);
  } else {
    sessions.unshift(nextSessionRecord);
  }

  const normalizedSessions = collapseDuplicateSessions(sessions);

  await Training.updateOne(
    { appId: training.appId, clientId: training.clientId },
    {
      $set: {
        "payload.sessions": normalizedSessions,
        "payload.lastActivity": "Today",
      },
    },
  );

  activeLaunchAskHistoryStore.delete(sessionId);

  await syncClientMetrics(training.clientId);
  if (isNewCompletedSession) {
    const trainingTitle = normalizeValue(training.payload?.title) || "Training";
    const learnerLabel = viewerIdentity.learnerName || viewerIdentity.learnerEmail || "A learner";
    await Promise.allSettled([
      notifyRolesInClient({
        clientId: training.clientId,
        roles: ["admin"],
        payload: {
          title: "Training completed",
          message: `${learnerLabel} completed ${trainingTitle}.`,
          category: "training",
          severity: "success",
          link: "/dashboard",
        },
      }),
      notifyTrainingOwner({
        clientId: training.clientId,
        trainerName: normalizeValue(training.payload?.trainer),
        payload: {
          title: "Training completed",
          message: `${learnerLabel} completed ${trainingTitle}.`,
          category: "training",
          severity: "success",
          link: "/dashboard",
        },
      }),
    ]);

    // Auto Result Sync (Method E): push completion + score to the customer's
    // own system/LMS via their configured webhook. Fire-and-forget (NOT awaited)
    // so a slow/down customer endpoint never delays the learner's response.
    void deliverCompletionWebhook({
      clientId: training.clientId,
      event: "training.completed",
      training: { id: training.appId, title: trainingTitle },
      learner: {
        id: viewerIdentity.ssoId || viewerIdentity.learnerEmail || "",
        name: viewerIdentity.learnerName || "",
        email: viewerIdentity.learnerEmail || "",
      },
      session: {
        sessionId,
        score: nextSessionRecord.score ?? nextSessionRecord.latestScore ?? null,
        status: "completed",
        progressPercent: nextSessionRecord.progressPercent ?? null,
        timeSpentSeconds: nextSessionRecord.timeSpent ?? null,
        attemptNo: nextSessionRecord.attemptNo ?? 1,
      },
    });

    // xAPI (Method D): emit a learning statement to the tenant's LRS (if enabled).
    void deliverXapiStatement({
      clientId: training.clientId,
      training: { id: training.appId, title: trainingTitle },
      learner: {
        id: viewerIdentity.ssoId || viewerIdentity.learnerEmail || "",
        name: viewerIdentity.learnerName || "",
        email: viewerIdentity.learnerEmail || "",
      },
      session: {
        score: nextSessionRecord.score ?? nextSessionRecord.latestScore ?? null,
        timeSpentSeconds: nextSessionRecord.timeSpent ?? null,
      },
    });
  }
  return ok(res, "Training session updated successfully.", {
    sessionId,
    session: nextSessionRecord,
  });
};

const createTrainingReply = async ({ training, message, history = [] }) => {
  const trainingAskPrompt = normalizeValue(training.payload?.askSystemPrompt);
  const avatarEnginePrompt = normalizeValue(training.payload?.avatarEngine?.prompt);
  const avatarPrompt =
    trainingAskPrompt ||
    avatarEnginePrompt ||
    normalizeValue(config.groq.systemPrompt);
  const contextualPrompt = [
    avatarPrompt,
    "Answer only using the module knowledge base that is provided.",
    "Do not repeat slide narration verbatim unless the learner explicitly asks for an exact quote.",
    "Give a fresh explanatory answer based on the slide facts, not the presenter script wording.",
    "Use the assistant identity, company, role, and tone from the training prompt. Do not introduce yourself as Trainup or Amara unless this specific training prompt says so.",
    "Answer in 45 to 140 words unless a shorter answer is clearly enough.",
    "Be practical, clear, and directly helpful to the learner.",
    "If the answer is not in the module knowledge base, say that the learner should ask their manager or trainer for clarification.",
  ]
    .filter(Boolean)
    .join("\n");

  const context = buildAskKnowledgeBase(training.payload);
  return createGroqReply({
    systemPrompt: contextualPrompt,
    context,
    history,
    message,
  });
};

const askQuestion = async (req, res) => {
  const training = await findTrainingById(req.params.id);

  if (!training) {
    return fail(res, 404, "Training launch was not found.");
  }

  const preview = Boolean(req.body.preview);
  const viewer = await resolveViewer(req);

  if (preview) {
    if (!canPreviewTraining(viewer, training)) {
      return fail(res, 403, "You do not have access to this preview launch.");
    }
  } else if (!viewer) {
    return fail(res, 401, "Launch login is required to ask a question.");
  } else {
    const accessError = getPublicLaunchAccessError(training, viewer);

    if (accessError) {
      return fail(
        res,
        403,
        accessError.includes("already completed") ? accessError : "This training is not currently approved.",
      );
    }
  }

  const message = normalizeValue(req.body.message);

  if (!message) {
    return fail(res, 400, "Question is required.");
  }

  try {
    const reply = await createTrainingReply({
      training,
      message,
      history: Array.isArray(req.body.history) ? req.body.history : [],
    });

    const historyEntry = {
      question: message,
      answer: reply,
      askedAt: formatDateTime(),
      inputMode: normalizeValue(req.body.inputMode) || "typed",
      sttProvider: normalizeValue(req.body.sttProvider) || null,
      language: normalizeValue(req.body.language) || null,
      slideId: normalizeValue(req.body.slideId) || null,
    };
    const requestedSessionId = normalizeValue(req.body.sessionId);
    const resolvedSessionId = requestedSessionId || `launch-session-${crypto.randomUUID()}`;
    setCachedLaunchAskHistory(resolvedSessionId, [
      ...getCachedLaunchAskHistory(resolvedSessionId),
      historyEntry,
    ]);

    if (requestedSessionId && Array.isArray(training.payload?.sessions)) {
      const sessions = [...training.payload.sessions];
      const sessionIndex = sessions.findIndex((session) => normalizeValue(session?.id) === requestedSessionId);

      if (sessionIndex >= 0) {
        const mergedAskHistory = dedupeAskHistory([
          ...(Array.isArray(sessions[sessionIndex]?.askTranscripts) ? sessions[sessionIndex].askTranscripts : []),
          ...(Array.isArray(sessions[sessionIndex]?.askHistory) ? sessions[sessionIndex].askHistory : []),
          historyEntry,
        ]);
        sessions[sessionIndex] = {
          ...sessions[sessionIndex],
          askHistory: mergedAskHistory,
          askTranscripts: mergedAskHistory,
        };

        await Training.updateOne(
          { appId: training.appId, clientId: training.clientId },
          {
            $set: {
              "payload.sessions": sessions,
              "payload.lastActivity": "Today",
            },
          },
        );
      }
    }

    return ok(res, "Launch question answered successfully.", {
      reply,
      model: config.groq.model,
      sessionId: resolvedSessionId,
      historyEntry,
    });
  } catch (error) {
    return fail(res, 502, error instanceof Error ? error.message : "Unable to answer the question right now.");
  }
};

const handleTrulienceEvent = async (req, res) => {
  const expectedApiKey = normalizeValue(config.trulience.apiKey);
  const bearerToken = normalizeValue(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

  if (expectedApiKey && bearerToken !== expectedApiKey) {
    return fail(res, 401, "Unauthorized Trulience request.");
  }

  const action = normalizeValue(req.body.action).toUpperCase();
  const sessionId = normalizeValue(req.body.sessionId);

  if (!action || !sessionId) {
    return fail(res, 400, "Trulience action and sessionId are required.");
  }

  if (action === "LOGIN") {
    trulienceSessionStore.set(sessionId, {
      sessionId,
      authToken: normalizeValue(req.body.authToken),
      callbackUrl: normalizeValue(req.body.callbackUrl),
      userId: normalizeValue(req.body.userId),
      locale: normalizeValue(req.body.locale || config.trulience.language),
      history: [],
      trainingId: "",
      currentSlideId: "",
    });

    return res.json({
      sessionId,
      status: "OK",
      statusMessage: "Session Created",
    });
  }

  if (action === "LOGOUT") {
    trulienceSessionStore.delete(sessionId);
    return res.json({
      sessionId,
      status: "OK",
      statusMessage: "Session Ended",
    });
  }

  if (action !== "CHAT") {
    return fail(res, 400, "Unsupported Trulience action.");
  }

  const session = trulienceSessionStore.get(sessionId) || {
    sessionId,
    history: [],
    trainingId: "",
    currentSlideId: "",
  };
  const customPayload = parseCustomJsonPayload(req.body.message);

  if (customPayload?.type === "training-context") {
    session.trainingId = normalizeValue(customPayload.trainingId);
    session.currentSlideId = normalizeValue(customPayload.currentSlideId);
    trulienceSessionStore.set(sessionId, session);

    return res.json({
      sessionId,
      reply: "",
      status: "OK",
      statusMessage: "Training context stored",
    });
  }

  if (customPayload?.type === "speak" && normalizeValue(customPayload.text)) {
    if (customPayload.trainingId) {
      session.trainingId = normalizeValue(customPayload.trainingId);
    }

    if (customPayload.currentSlideId) {
      session.currentSlideId = normalizeValue(customPayload.currentSlideId);
    }

    trulienceSessionStore.set(sessionId, session);

    return res.json({
      sessionId,
      reply: normalizeValue(customPayload.text),
      status: "OK",
      statusMessage: "Reply Sent",
    });
  }

  if (!session.trainingId) {
    return res.json({
      sessionId,
      reply: "I am ready. Please start the slideshow or share the training context first.",
      status: "OK",
      statusMessage: "Reply Sent",
    });
  }

  try {
    const reply =
      "I can speak the training responses, but I do not answer from a separate Trulience knowledge source. Please use the training Ask mode so I can answer only from the slide and uploaded document knowledge base.";

    session.history = [...session.history, { role: "user", content: normalizeValue(req.body.message) }, { role: "assistant", content: reply }].slice(-10);
    trulienceSessionStore.set(sessionId, session);

    return res.json({
      sessionId,
      reply,
      status: "OK",
      statusMessage: "Reply Sent",
    });
  } catch (error) {
    return res.json({
      sessionId,
      reply: "I cannot answer that right now. Please try again shortly.",
      status: "OK",
      statusMessage: error instanceof Error ? error.message : "Reply failed",
    });
  }
};

// ---------------------------------------------------------------------------
// Public Demo Access — no auth, guest name/email in body, mode="demo"
// ---------------------------------------------------------------------------

const findTrainingByDemoToken = async (demoToken) => {
  const token = normalizeValue(demoToken);
  if (!token) return null;

  const demoTraining = await Training.findOne({
    "payload.options.allowPublicDemoAccess": true,
    "payload.options.demoToken": token,
  }).lean();
  if (demoTraining) return demoTraining;

  // LMS_INTEGRATION_RESEARCH.md (Method A/E): a signed external launch token is
  // self-authorizing — when it verifies, load that training directly. This lets
  // every existing demo endpoint (resolve/load/session/ask) serve secure links
  // without duplicating the player surface.
  const verified = verifyLaunchToken(token);
  if (verified) {
    return findTrainingById(verified.trainingId);
  }

  return null;
};

const resolveDemoTraining = async (req, res) => {
  const training = await findTrainingByDemoToken(req.params.demoToken);
  if (!training) return fail(res, 404, "Demo training not found or demo access is disabled.");
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "This training is not currently available for demo.");
  }
  const brandingPayload = await buildLaunchBrandingPayload(training);
  return ok(res, "Demo training resolved.", {
    trainingId: training.appId,
    title: normalizeValue(training.payload?.title),
    ...brandingPayload,
  });
};

// ---------------------------------------------------------------------------
// Signed external launch (LMS_INTEGRATION_RESEARCH.md — Method A / E)
// ---------------------------------------------------------------------------

// Admin-authenticated: mint a signed, expiring launch URL for a training owned
// by the caller's tenant. The link embeds in any LMS as a web link / iframe.
const createSecureLaunchUrl = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const trainingId = normalizeValue(req.params.id);

  const training = await Training.findOne({ appId: trainingId, clientId }).lean();
  if (!training) {
    return fail(res, 404, "Training not found for this tenant.");
  }
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 400, "Only approved trainings can be shared to an external LMS.");
  }

  const rawTtl = Number(req.body?.expiresInMinutes);
  // Clamp the lifetime to a sane window: 5 minutes … 365 days.
  const expiresInMinutes = Number.isFinite(rawTtl) && rawTtl > 0
    ? Math.min(Math.max(Math.round(rawTtl), 5), 60 * 24 * 365)
    : 60 * 24 * 7;

  const token = signLaunchToken({
    trainingId: training.appId,
    clientId,
    learnerId: normalizeValue(req.body?.learnerId),
    learnerName: normalizeValue(req.body?.learnerName),
    learnerEmail: normalizeValue(req.body?.learnerEmail),
    expiresInMinutes,
  });

  const referer = normalizeValue(req.headers.referer);
  const origin = normalizeValue(req.headers.origin) || (referer ? new URL(referer).origin : "");
  const client = await Client.findOne({ appId: clientId }).lean();
  // This link is shared with an external LMS — a tenant's custom domain must
  // win over the ambient admin-session origin, or the external system's
  // config would randomly point at whichever domain the admin last used.
  const resolvedOrigin = client?.domain
    ? `https://${client.domain}`
    : origin || `https://${client?.subdomain || "app"}.trainup.ai`;
  const launchUrl = buildPublicUrl(resolvedOrigin, `/secure-launch/${token}`, req.headers["x-app-base-path"]);

  // Save this link information in the database so it survives page reloads
  await Training.updateOne(
    { appId: trainingId, clientId },
    {
      $set: {
        "payload.lastLaunchLink": {
          launchUrl,
          token,
          expiresInMinutes,
          learnerName: normalizeValue(req.body?.learnerName),
          learnerEmail: normalizeValue(req.body?.learnerEmail),
          generatedAt: new Date().toISOString()
        }
      }
    }
  );

  return ok(res, "Secure launch link generated.", {
    trainingId: training.appId,
    token,
    launchUrl,
    expiresInMinutes,
  });
};

// Admin-authenticated: download a SCORM 1.2 dispatch package (Method C). The zip
// wraps the live player via a long-lived signed launch URL; the customer uploads
// it to their LMS, which then plays it and records completion/score.
const downloadScormPackage = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const trainingId = normalizeValue(req.params.id);

  const training = await Training.findOne({ appId: trainingId, clientId }).lean();
  if (!training) {
    return fail(res, 404, "Training not found for this tenant.");
  }
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 400, "Only approved trainings can be exported to SCORM.");
  }

  const client = await Client.findOne({ appId: clientId }).lean();
  if (client && client.scormEnabled === false) {
    return fail(res, 403, "SCORM delivery is disabled for this tenant.");
  }

  // One package serves many learners over a long period → anonymous token with a
  // long (1 year, the max) lifetime; the SCORM wrapper supplies each learner's
  // identity from the LMS at play time.
  const token = signLaunchToken({
    trainingId: training.appId,
    clientId,
    expiresInMinutes: 60 * 24 * 365,
  });

  const referer = normalizeValue(req.headers.referer);
  const origin = normalizeValue(req.headers.origin) || (referer ? new URL(referer).origin : "");
  // The SCORM zip is uploaded into the customer's own LMS and can't easily be
  // regenerated — the embedded launch URL must use the tenant's custom domain
  // whenever one is configured, not whichever origin the admin browsed from.
  const resolvedOrigin = client?.domain
    ? `https://${client.domain}`
    : origin || `https://${client?.subdomain || "app"}.trainup.ai`;
  const launchUrl = buildPublicUrl(resolvedOrigin, `/secure-launch/${token}`, req.headers["x-app-base-path"]);

  const title = normalizeValue(training.payload?.title) || "Training";
  const zipBuffer = buildScormPackage({ id: training.appId, title }, launchUrl);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "training";

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="scorm-${slug}.zip"`);
  res.setHeader("Content-Length", zipBuffer.length);
  return res.status(200).send(zipBuffer);
};

// Public: validate a signed launch token and return what the landing page needs
// to auto-start the player (no login form) — mirrors resolveDemoTraining.
const resolveSecureLaunch = async (req, res) => {
  const verified = verifyLaunchToken(req.params.token);
  if (!verified) {
    return fail(res, 404, "This launch link is invalid or has expired.");
  }

  const training = await findTrainingById(verified.trainingId);
  if (!training) {
    return fail(res, 404, "Training launch was not found.");
  }
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "This training is not currently available.");
  }

  // If the token carries learner identity (LTI/SCORM/per-learner link), tell them
  // up front when they've already used all their attempts — better than letting
  // them go through the whole training only to be blocked at completion.
  const identity = verified.learnerEmail || verified.learnerName;
  const maxAttempts = resolveMaxAttempts(training);
  if (identity && maxAttempts > 0 && countCompletedLmsAttempts(training, identity) >= maxAttempts) {
    return fail(
      res,
      403,
      `You have already completed this training the maximum of ${maxAttempts} time${maxAttempts === 1 ? "" : "s"}.`,
    );
  }

  const brandingPayload = await buildLaunchBrandingPayload(training);
  return ok(res, "Secure launch resolved.", {
    trainingId: training.appId,
    title: normalizeValue(training.payload?.title),
    learnerName: verified.learnerName,
    learnerEmail: verified.learnerEmail,
    expiresAt: verified.expiresAt,
    ...brandingPayload,
  });
};

const getDemoTraining = async (req, res) => {
  const training = await findTrainingByDemoToken(req.params.demoToken);
  if (!training) return fail(res, 404, "Demo training not found or demo access is disabled.");
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "This training is not currently available for demo.");
  }
  const guestName = normalizeValue(req.query.guestName || req.headers["x-guest-name"]);
  const guestEmail = normalizeValue(req.query.guestEmail || req.headers["x-guest-email"]);
  if (!guestName || !guestEmail) {
    return fail(res, 400, "Guest name and email are required for demo access.");
  }
  const demoViewer = { fullname: guestName, email: guestEmail, role: "guest", clientId: training.clientId };
  const payload = await buildLaunchPayload({ training, viewer: demoViewer, preview: false });
  payload.sessions = [];
  payload.learnerSessionHistory = [];
  return ok(res, "Demo training loaded successfully.", payload);
};

const buildDemoViewerIdentity = (guestName, guestEmail, sessionId) => ({
  ssoId: guestEmail || guestName || `Demo:${sessionId.slice(-8)}`,
  learnerName: guestName,
  learnerEmail: guestEmail,
});

const upsertDemoSession = async (req, res) => {
  const training = await findTrainingByDemoToken(req.params.demoToken);
  if (!training) return fail(res, 404, "Demo training not found or demo access is disabled.");
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "This training is not currently available for demo.");
  }

  const guestName = normalizeValue(req.body.guestName);
  const guestEmail = normalizeValue(req.body.guestEmail);
  if (!guestName || !guestEmail) {
    return fail(res, 400, "Guest name and email are required for demo session.");
  }

  const action = normalizeValue(req.body.action || "progress").toLowerCase();
  const slidesViewed = clampProgress(req.body.slidesViewed, req.body.totalSlides);
  const totalSlides = Math.max(1, Number(req.body.totalSlides || 1));
  const progressPercent = Math.round((slidesViewed / totalSlides) * 100);
  const explicitScore = req.body.score;
  const correctAnswers = Number(req.body.correctAnswers || 0);
  const totalQuestions = Number(req.body.totalQuestions || 0);
  const score =
    explicitScore === null || explicitScore === undefined || explicitScore === ""
      ? totalQuestions > 0
        ? Math.round((correctAnswers / Math.max(totalQuestions, 1)) * 100)
        : null
      : Number(explicitScore);
  const viewedSlideIds = Array.from(
    new Set(
      (Array.isArray(req.body.viewedSlideIds) ? req.body.viewedSlideIds : [])
        .map((item) => normalizeValue(item))
        .filter(Boolean),
    ),
  );
  // Demo sessions capture proctoring identically to authenticated launches and
  // the frontend posts the report here too — persist it (mirrors
  // upsertLaunchSession) so the Session Report shows attention/risk/events.
  const proctoringReport =
    req.body.proctoringReport && typeof req.body.proctoringReport === "object"
      ? req.body.proctoringReport
      : null;
  const requestedSessionId = normalizeValue(req.body.sessionId);
  const sessionId = requestedSessionId || `demo-session-${crypto.randomUUID()}`;
  const sessions = Array.isArray(training.payload?.sessions) ? [...training.payload.sessions] : [];
  const existingIndex = sessions.findIndex((s) => normalizeValue(s.id) === sessionId);
  const existingSession = existingIndex >= 0 ? sessions[existingIndex] : null;

  // A signed launch token means this came from an external LMS link (a real,
  // billable learner) — not a free public marketing demo. We treat the two
  // differently for billing (below) and result webhooks (further down).
  const ltiLaunch = verifyLaunchToken(req.params.demoToken);
  const isLmsLaunch = Boolean(ltiLaunch);
  const isNewCompletedSession =
    action === "complete" &&
    normalizeValue(existingSession?.status).toLowerCase() !== "completed";

  // Enforce per-learner attempt limit on LMS launches (raw link / SCORM / LTI).
  // Guests are matched by identity (email/name); block BEFORE billing so a
  // disallowed retake is neither charged nor recorded.
  if (isLmsLaunch && isNewCompletedSession) {
    const maxAttempts = resolveMaxAttempts(training);
    if (maxAttempts > 0) {
      const priorAttempts = countCompletedLmsAttempts(training, guestEmail || guestName, sessionId);
      if (priorAttempts >= maxAttempts) {
        return fail(
          res,
          403,
          `You have already used all ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"} for this training.`,
        );
      }
    }
  }

  // LMS launch completions consume credits + lifetime session quota, exactly like
  // authenticated launches, so external-LMS usage is never a free bypass. Public
  // demos remain free. Gate BEFORE persisting so an unpayable session isn't saved.
  if (isLmsLaunch && isNewCompletedSession) {
    const client = await Client.findOne({ appId: training.clientId });

    const expiredError = assertSubscriptionActive(client);
    if (expiredError) return fail(res, 402, expiredError);

    if (client && !client.quotaInitialized) {
      const publishedCount = await Training.countDocuments({
        clientId: training.clientId,
        "payload.status": "approved",
      });
      await ensureClientEntitlement(client, {
        training: publishedCount,
        session: Number(client.sessions || 0),
        user: Number(client.activeUsers || 0),
      });
    }

    const usageError = client ? assertLifetimeQuota(client, "session", 1) : null;
    if (usageError) return fail(res, 403, usageError);

    const creditResult = await consumeClientCredits({
      clientId: training.clientId,
      credits: (await getCreditCosts(client)).session,
      reason: `LMS launch session completed by ${guestEmail || guestName || "learner"}`,
    });
    if (!creditResult.ok) return fail(res, 400, creditResult.message);

    if (client) {
      client.sessionUsedLifetime = Number(client.sessionUsedLifetime || 0) + 1;
      await client.save();
    }
  }

  const now = formatDateTime();
  const sessionRecord = {
    ...(existingSession || {}),
    id: sessionId,
    ssoId: guestEmail || guestName,
    learnerName: guestName,
    learnerEmail: guestEmail,
    status: action === "complete" ? "completed" : "in_progress",
    timeSpent: Number(req.body.timeSpentSeconds ?? req.body.timeSpent ?? existingSession?.timeSpent ?? 0),
    slidesViewed,
    totalSlides,
    viewedSlideIds,
    score: action === "complete" ? score : (existingSession?.score ?? null),
    latestScore: score,
    bestScore: Math.max(
      typeof score === "number" ? score : -Infinity,
      typeof existingSession?.bestScore === "number" ? existingSession.bestScore : -Infinity,
    ) === -Infinity ? null : Math.max(score ?? -Infinity, existingSession?.bestScore ?? -Infinity),
    startedAt: existingSession?.startedAt || now,
    completedAt: action === "complete" ? now : (existingSession?.completedAt || null),
    correctAnswers,
    totalQuestions,
    progressPercent,
    mode: "demo",
    viaLmsLaunch: isLmsLaunch,
    role: "guest",
    attemptNo: existingSession?.attemptNo || 1,
    askHistory: existingSession?.askHistory || [],
    askTranscripts: existingSession?.askTranscripts || [],
    // Keep an earlier-captured report if a later sync omits it (e.g. a
    // progress ping after completion), so the report is never lost.
    proctoringReport: proctoringReport || existingSession?.proctoringReport || null,
  };

  if (existingIndex >= 0) {
    sessions[existingIndex] = sessionRecord;
  } else {
    sessions.push(sessionRecord);
  }

  await Training.updateOne(
    { appId: training.appId, clientId: training.clientId },
    { $set: { "payload.sessions": sessions, "payload.lastActivity": "Today" } },
  );

  // Auto Result Sync (Method E): push completion + score to the customer's
  // webhook ONLY for real LMS-launch learners — not free public marketing demos
  // (a random demo guest's result should not land in the customer's system).
  // Gate on isNewCompletedSession (not just action) so a re-synced/duplicate
  // "complete" of an already-finished session does not re-fire deliveries.
  if (isNewCompletedSession && isLmsLaunch) {
    const trainingTitle = normalizeValue(training.payload?.title) || "Training";
    void deliverCompletionWebhook({
      clientId: training.clientId,
      event: "training.completed",
      training: { id: training.appId, title: trainingTitle },
      learner: { id: guestEmail || guestName, name: guestName, email: guestEmail },
      session: {
        sessionId,
        score: sessionRecord.score ?? sessionRecord.latestScore ?? null,
        status: "completed",
        progressPercent,
        timeSpentSeconds: sessionRecord.timeSpent ?? null,
        attemptNo: sessionRecord.attemptNo ?? 1,
      },
    });
    // xAPI (Method D): emit a learning statement to the tenant's LRS (if enabled).
    void deliverXapiStatement({
      clientId: training.clientId,
      training: { id: training.appId, title: trainingTitle },
      learner: { id: guestEmail || guestName, name: guestName, email: guestEmail },
      session: {
        score: sessionRecord.score ?? sessionRecord.latestScore ?? null,
        timeSpentSeconds: sessionRecord.timeSpent ?? null,
      },
    });
    // LTI 1.3 (Method B): push the score to the LMS gradebook (AGS) if this
    // launch came from an LTI link carrying grade-service context.
    if (ltiLaunch?.ags) {
      void deliverLtiGrade({
        clientId: training.clientId,
        ags: ltiLaunch.ags,
        score: sessionRecord.score ?? sessionRecord.latestScore ?? null,
      });
    }
  }

  // Keep tenant metrics (session counts) in sync for billable LMS completions.
  if (isLmsLaunch && isNewCompletedSession) {
    await syncClientMetrics(training.clientId);
  }

  return ok(res, `Demo session ${action === "complete" ? "completed" : "updated"} successfully.`, {
    sessionId,
    status: sessionRecord.status,
    progressPercent,
    score: sessionRecord.score,
  });
};

const askDemoQuestion = async (req, res) => {
  const training = await findTrainingByDemoToken(req.params.demoToken);
  if (!training) return fail(res, 404, "Demo training not found or demo access is disabled.");
  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "This training is not currently available for demo.");
  }

  const message = normalizeValue(req.body.message);
  if (!message) return fail(res, 400, "Question is required.");

  const guestName = normalizeValue(req.body.guestName);
  const guestEmail = normalizeValue(req.body.guestEmail);
  if (!guestName || !guestEmail) {
    return fail(res, 400, "Guest name and email are required.");
  }

  try {
    const reply = await createTrainingReply({
      training,
      message,
      history: Array.isArray(req.body.history) ? req.body.history : [],
    });

    const historyEntry = {
      question: message,
      answer: reply,
      askedAt: formatDateTime(),
      inputMode: normalizeValue(req.body.inputMode) || "typed",
      sttProvider: normalizeValue(req.body.sttProvider) || null,
      language: normalizeValue(req.body.language) || null,
      slideId: normalizeValue(req.body.slideId) || null,
    };
    const requestedSessionId = normalizeValue(req.body.sessionId);
    const resolvedSessionId = requestedSessionId || `demo-session-${crypto.randomUUID()}`;

    if (requestedSessionId && Array.isArray(training.payload?.sessions)) {
      const sessions = [...training.payload.sessions];
      const sessionIndex = sessions.findIndex((s) => normalizeValue(s?.id) === requestedSessionId);
      if (sessionIndex >= 0) {
        const mergedAskHistory = dedupeAskHistory([
          ...(Array.isArray(sessions[sessionIndex]?.askTranscripts) ? sessions[sessionIndex].askTranscripts : []),
          ...(Array.isArray(sessions[sessionIndex]?.askHistory) ? sessions[sessionIndex].askHistory : []),
          historyEntry,
        ]);
        sessions[sessionIndex] = {
          ...sessions[sessionIndex],
          askHistory: mergedAskHistory,
          askTranscripts: mergedAskHistory,
        };
        await Training.updateOne(
          { appId: training.appId, clientId: training.clientId },
          { $set: { "payload.sessions": sessions, "payload.lastActivity": "Today" } },
        );
      }
    }

    return ok(res, "Demo question answered successfully.", {
      reply,
      model: config.groq.model,
      sessionId: resolvedSessionId,
      historyEntry,
    });
  } catch (error) {
    return fail(res, 502, error instanceof Error ? error.message : "Unable to answer the question right now.");
  }
};

module.exports = {
  getTraining,
  getTrainingBranding,
  upsertLaunchSession,
  askQuestion,
  handleTrulienceEvent,
  createTrainingReply,
  buildLaunchPayload,
  findTrainingById,
  buildLaunchBrandingPayload,
  resolveDemoTraining,
  getDemoTraining,
  upsertDemoSession,
  askDemoQuestion,
  createSecureLaunchUrl,
  resolveSecureLaunch,
  downloadScormPackage,
};
