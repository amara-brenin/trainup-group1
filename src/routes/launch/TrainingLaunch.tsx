import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useParams } from "react-router-dom";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import axios from "axios";
import { useAppSelector } from "../../app/hooks";
import Loader from "../../component/common/Loader";
import Modal from "../../component/common/Modal";
import { DEFAULT_GOOGLE_CLIENT_ID } from "../../constant/googleAuth";
import type {
  AdminUser,
  TrainingInteractiveHotspot,
  TrainingAvatarEngineConfig,
  TrainingFormConfig,
  TrainingFormField,
  TrainingLocalizedVoiceLanguage,
  TrainingLocalizedVoiceovers,
  TrainingBrandingSettings,
  TrainingMode,
  TrainingNarrationAudioAsset,
  TrainingProctoringReport,
  TrainingQuestionCheckpoint,
  TrainingQuestionSetRecord,
  TrainingSessionRecord,
  TrainingSlideshowTheme,
} from "../../constant/interfaces";
import TrainingSlideForm, {
  type TrainingSlideFormSubmitResult,
} from "../../component/training-workspace/TrainingSlideForm";
import { isLaunchInputField } from "../../helper/trainingForm";
import type { ApiEnvelope } from "../../constant/interfaces";
import {
  clearLaunchSessionSnapshot,
  clearLaunchAuthToken,
  getAuthToken,
  getLaunchAuthToken,
  getLaunchSessionSnapshot,
  setLaunchSessionSnapshot,
  setLaunchAuthToken,
  getDemoSession,
} from "../../helper/authSession";
import { generateScriptAudioDataUri } from "../../helper/scriptAudio";
import { resolveSlideMediaAsset } from "../../helper/slideMediaStore";
import { getRequestUrl, isServerApiEnabled } from "../../helper/runtimeApi";
import { mockRequest } from "../../helper/mockApi";
import { sanitizeLaunchNarrationScript } from "../../helper/trainingNarration";
import { buildTrainingQuestionField } from "../../helper/trainingQuestions";
import TrainingLaunchAvatar, {
  type TrainingLaunchAvatarHandle,
  type TrainingLaunchAvatarStatus,
} from "../../component/launch/TrainingLaunchAvatar";
import TrainingLaunchTavusAvatar from "../../component/launch/TrainingLaunchTavusAvatar";
import TrainingLaunchProctoring, {
  type TrainingLaunchProctoringHandle,
} from "../../component/launch/TrainingLaunchProctoring";
import {
  getHotspotActionText,
  getHotspotTargetLabel,
  resolveHotspotPresentation,
  type HotspotPresentation,
} from "../../helper/interactiveHotspots";
import DefaultBrandLogo from "../../assets/images/logo.png";

type LaunchSlide = {
  id: string;
  order: number;
  title: string;
  script: string;
  mediaUrl: string;
  mediaName: string;
  interactiveHotspots?: TrainingInteractiveHotspot[];
  settings?: {
    avatarPosition?: string;
    waitForAudio?: boolean;
    disableAutoAdvance?: boolean;
    autoAdvanceDelayMs?: number;
    hidePauseButton?: boolean;
    hideAskQuestionButton?: boolean;
    hidePreviousButton?: boolean;
    hideAutoplayButton?: boolean;
  };
  formFields?: TrainingFormField[];
  formConfig?: TrainingFormConfig;
  additionalInfo?: string;
  narrationAudio?: TrainingNarrationAudioAsset | null;
};

type LaunchTrainingRecord = {
  id: string;
  title: string;
  type?: string;
  audience: string;
  trainer: string;
  status: string;
  isPublished: boolean;
  publishedOn?: string | null;
  trainingMode?: TrainingMode;
  avatarName: string;
  avatarId: string;
  ttsProvider: string;
  voiceName: string;
  voiceId: string;
  questionButtonLabel: string;
  askSystemPrompt?: string;
  presenterNotes: string;
  previewSlideId?: string | null;
  previewThumbnailAssetId?: string | null;
  previewThumbnailAssetName?: string | null;
  previewThumbnailUrl?: string;
  durationMins: number;
  options: {
    showSubtitles?: boolean;
    showFinalScore?: boolean;
    proctoringEnabled?: boolean;
  };
  logo?: string;
  theme: Partial<TrainingSlideshowTheme>;
  branding: Partial<TrainingBrandingSettings> & {
    application_name?: string;
    copyright?: string;
    logo?: string;
    logoUrl?: string;
    dark_logo?: string;
    darkLogoUrl?: string;
    email?: string;
    companyName?: string;
    favicon?: string;
    loaderTitle?: string;
    loaderCaption?: string;
  };
  localizedVoiceovers?: TrainingLocalizedVoiceovers | null;
  avatarEngine?: TrainingAvatarEngineConfig | null;
  launchMode: "preview" | "public";
  viewerName?: string;
  sessions?: TrainingSessionRecord[];
  learnerSessionHistory?: Array<{
    sessionId: string;
    trainingId: string;
    trainingTitle: string;
    trainingType?: string;
    trainingAudience: string;
    status: TrainingSessionRecord["status"];
    timeSpent: string;
    slidesViewed?: number;
    totalSlides?: number;
    startedAt?: string;
    completedAt?: string;
  }>;
  slides: LaunchSlide[];
  questionCheckpoints?: TrainingQuestionCheckpoint[];
  questionSets?: TrainingQuestionSetRecord[];
};

type LaunchResponse = LaunchTrainingRecord;
type SessionResponse = {
  sessionId: string;
};
type AskQuestionResponse = {
  reply: string;
  model: string;
  sessionId?: string;
};
type LaunchBrandingResponse = {
  trainingId: string;
  branding: LaunchTrainingRecord["branding"];
};

type QuestionHistoryItem = {
  question: string;
  answer: string;
  askedAt?: string | null;
  inputMode?: "typed" | "browser-voice" | "avatar" | string;
  sttProvider?: string | null;
  language?: string | null;
  slideId?: string | null;
};

type AskTranscriptMetadata = Pick<QuestionHistoryItem, "inputMode" | "sttProvider" | "language" | "slideId">;

type LaunchLoginResponse = {
  token: string;
  user: Pick<AdminUser, "name" | "fullname" | "email" | "role" | "image">;
};

type LearnerLaunchProfile = {
  name: string;
  email: string;
  role: string;
  trainingsCount: number;
  sessionsCount: number;
};

type SlideScoreState = {
  correctAnswers: number;
  totalQuestions: number;
  score: number | null;
};

type ActiveLaunchHotspotState = {
  hotspot: TrainingInteractiveHotspot;
  presentation: HotspotPresentation;
} | null;

type LaunchSequenceItem =
  | {
    kind: "slide";
    id: string;
    slide: LaunchSlide;
    slideIndex: number;
  }
  | {
    kind: "question_set";
    id: string;
    questionSet: TrainingQuestionSetRecord;
    questionSetIndex: number;
    anchorSlideIndex: number;
  };

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onresult:
  | ((event: {
    resultIndex?: number;
    results: ArrayLike<ArrayLike<{ transcript: string } & { isFinal?: boolean }> & { isFinal?: boolean }>;
  }) => void)
  | null;
  start: () => void;
  stop: () => void;
};

type LaunchNarrationTransport = "avatar_speech" | "audio" | null;
type LaunchSpeechActivity =
  | "idle"
  | "loading"
  | "speaking"
  | "listening"
  | "paused";

const clampIndex = (index: number, total: number) =>
  Math.min(Math.max(index, 0), Math.max(total - 1, 0));
const defaultLaunchAvatarId = "1647619895205577317";
const manualNavigationCompletionGuardMs = 300;
const getMockParams = (url: string) =>
  Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? ""));
const resolveSpeechRecognitionCtor = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };

  return (
    speechWindow.SpeechRecognition ||
    speechWindow.webkitSpeechRecognition ||
    null
  );
};
const resolveSpeechLocale = (language?: string) => {
  const match = String(language || "").match(/\(([a-z]{2}-[A-Z]{2})\)/);
  return match?.[1] || "en-IN";
};
const resolveLocalizedLaunchLocale = (
  language?: TrainingLocalizedVoiceLanguage | null,
  fallbackLanguage?: string,
) => language?.locale || resolveSpeechLocale(fallbackLanguage);
const findLocalizedLanguage = (
  config?: TrainingLocalizedVoiceovers | null,
  code?: string | null,
) => {
  if (!config?.languages?.length) {
    return null;
  }

  return (
    config.languages.find((language) => language.code === code) ||
    config.languages.find((language) => language.code === config.defaultLanguageCode) ||
    config.languages[0] ||
    null
  );
};
const getLanguageShortLabel = (language?: TrainingLocalizedVoiceLanguage | null) => {
  const normalizedCode = String(language?.code || "").trim().toUpperCase();

  if (normalizedCode) {
    return normalizedCode.slice(0, 2);
  }

  return "EN";
};

const getInitials = (value?: string | null) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "LR";

const buildFallbackQuestionSets = (
  training: LaunchTrainingRecord,
): TrainingQuestionSetRecord[] => {
  const checkpoints = Array.isArray(training.questionCheckpoints)
    ? training.questionCheckpoints
    : [];

  if (!checkpoints.length) {
    return [];
  }

  const groups = new Map<string, TrainingQuestionCheckpoint[]>();
  checkpoints.forEach((checkpoint, index) => {
    const groupKey =
      checkpoint.generationSetId ||
      `${checkpoint.placementMode}:${checkpoint.placementSlideId || "end"}:${checkpoint.generationSetLabel || index}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), checkpoint]);
  });

  return Array.from(groups.entries()).map(
    ([groupId, groupedCheckpoints], index) => {
      const firstCheckpoint = groupedCheckpoints[0];
      const linkedSlide =
        training.slides.find(
          (slide) => slide.id === firstCheckpoint?.placementSlideId,
        ) ?? null;

      return {
        id: groupId,
        label:
          firstCheckpoint?.generationSetLabel || `Question Set ${index + 1}`,
        placementMode: firstCheckpoint?.placementMode || "after_slide",
        slideId: firstCheckpoint?.placementSlideId || null,
        slideTitle: linkedSlide?.title || "",
        isMandatory: true,
        difficultyLevel:
          firstCheckpoint?.difficultyLevel === "easy" ||
            firstCheckpoint?.difficultyLevel === "medium" ||
            firstCheckpoint?.difficultyLevel === "hard"
            ? firstCheckpoint.difficultyLevel
            : "medium",
        topicTags: [...(firstCheckpoint?.topicTags ?? [])],
        sourceIds: Array.from(
          new Set(
            groupedCheckpoints.flatMap((checkpoint) => checkpoint.sourceIds),
          ),
        ),
        sourceLabels: Array.from(
          new Set(
            groupedCheckpoints.flatMap((checkpoint) => checkpoint.sourceLabels),
          ),
        ),
        questionCount: groupedCheckpoints.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: index === 0,
        checkpoints: groupedCheckpoints,
      };
    },
  );
};

const getLaunchQuestionSets = (training: LaunchTrainingRecord | null) => {
  if (!training) {
    return [];
  }

  const resolvedSets =
    Array.isArray(training.questionSets) && training.questionSets.length
      ? training.questionSets
      : buildFallbackQuestionSets(training);

  return resolvedSets.map((questionSet) => ({
    ...questionSet,
    isMandatory: questionSet.isMandatory ?? true,
  }));
};

const buildLaunchSequence = (
  training: LaunchTrainingRecord | null,
): LaunchSequenceItem[] => {
  if (!training) {
    return [];
  }

  const questionBuckets = new Map<string, TrainingQuestionSetRecord[]>();
  const endQuestionSets: TrainingQuestionSetRecord[] = [];

  getLaunchQuestionSets(training).forEach((questionSet) => {
    const normalizedPlacementMode: TrainingQuestionSetRecord["placementMode"] =
      questionSet.placementMode === "before_slide" ||
        questionSet.placementMode === "end_of_training"
        ? questionSet.placementMode
        : "after_slide";
    const normalizedSlideId =
      normalizedPlacementMode === "end_of_training"
        ? null
        : questionSet.slideId ||
        questionSet.checkpoints[0]?.placementSlideId ||
        training.slides[0]?.id ||
        null;
    const normalizedSlideTitle =
      normalizedPlacementMode === "end_of_training"
        ? ""
        : training.slides.find((slide) => slide.id === normalizedSlideId)
          ?.title ||
        questionSet.slideTitle ||
        "";
    const normalizedQuestionSet = {
      ...questionSet,
      placementMode: normalizedPlacementMode,
      slideId: normalizedSlideId,
      slideTitle: normalizedSlideTitle,
    };

    if (normalizedPlacementMode === "end_of_training" || !normalizedSlideId) {
      endQuestionSets.push(normalizedQuestionSet);
      return;
    }

    const key = `${normalizedPlacementMode}:${normalizedSlideId}`;
    questionBuckets.set(key, [
      ...(questionBuckets.get(key) ?? []),
      normalizedQuestionSet,
    ]);
  });

  const sequence: LaunchSequenceItem[] = [];
  let questionSetIndex = 0;

  training.slides.forEach((slide, slideIndex) => {
    (questionBuckets.get(`before_slide:${slide.id}`) ?? []).forEach(
      (questionSet) => {
        sequence.push({
          kind: "question_set",
          id: questionSet.id,
          questionSet,
          questionSetIndex,
          anchorSlideIndex: slideIndex,
        });
        questionSetIndex += 1;
      },
    );

    sequence.push({
      kind: "slide",
      id: slide.id,
      slide,
      slideIndex,
    });

    (questionBuckets.get(`after_slide:${slide.id}`) ?? []).forEach(
      (questionSet) => {
        sequence.push({
          kind: "question_set",
          id: questionSet.id,
          questionSet,
          questionSetIndex,
          anchorSlideIndex: slideIndex,
        });
        questionSetIndex += 1;
      },
    );
  });

  endQuestionSets.forEach((questionSet) => {
    sequence.push({
      kind: "question_set",
      id: questionSet.id,
      questionSet,
      questionSetIndex,
      anchorSlideIndex: Math.max(training.slides.length - 1, 0),
    });
    questionSetIndex += 1;
  });

  return sequence;
};

const getQuestionHistoryForApi = (history: QuestionHistoryItem[]) =>
  history.flatMap((item) => [
    { role: "user", content: item.question },
    { role: "assistant", content: item.answer },
  ]);

const normalizeTranscriptText = (value: string) =>
  String(value || "").replace(/\s+/g, " ").trim();

const mergeTranscriptText = (currentValue: string, nextValue: string) => {
  const current = normalizeTranscriptText(currentValue);
  const next = normalizeTranscriptText(nextValue);

  if (!current) return next;
  if (!next) return current;

  const currentLower = current.toLowerCase();
  const nextLower = next.toLowerCase();

  if (currentLower === nextLower) return current;
  if (nextLower.includes(currentLower)) return next;
  if (currentLower.includes(nextLower)) return current;

  const currentWords = current.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const maxOverlap = Math.min(currentWords.length, nextWords.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const currentTail = currentWords.slice(-overlap).join(" ").toLowerCase();
    const nextHead = nextWords.slice(0, overlap).join(" ").toLowerCase();

    if (currentTail === nextHead) {
      return normalizeTranscriptText([
        ...currentWords,
        ...nextWords.slice(overlap),
      ].join(" "));
    }
  }

  return normalizeTranscriptText(`${current} ${next}`);
};

const isLikelyIncompleteAskTranscript = (value: string) => {
  const normalized = normalizeTranscriptText(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [
    "uh",
    "uh tell",
    "uh tell me",
    "uh tell me about",
    "uh tell me about yourself",
    "uh tell me about yourself how",
  ].includes(normalized);
};

const getDurationSeconds = (startedAt: number) =>
  Math.max(0, Math.round((Date.now() - startedAt) / 1000));
const getLaunchAuthError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to sign in for this training.";

// const debugLaunch = (...args: unknown[]) => {
//   console.log("[TrainingLaunch]", ...args);
// };

// const debugLaunch = () => {};

const renderLaunchButtonLabel = (iconClass: string, text: string) => (
  <>
    <i className={`bi ${iconClass} training-launch-btn-icon`} aria-hidden="true" />
    <span className="training-launch-btn-text">{text}</span>
  </>
);

const resolveLaunchButtonClass = (active: boolean) =>
  active ? "btn btn-primary" : "btn btn-secondary";

const resolveLaunchButtonRadius = (radius?: TrainingSlideshowTheme["buttonRadius"]) => {
  switch (radius) {
    case "zero":
      return "0";
    case "small":
      return "0.7rem";
    case "medium":
      return "0.92rem";
    case "pill":
      return "999px";
    case "large":
    default:
      return "1.12rem";
  }
};

const resolveLaunchButtonFontFamily = (fontFamily?: TrainingSlideshowTheme["buttonFontFamily"]) => {
  switch (fontFamily) {
    case "Poppins":
      return "\"Poppins\", \"Segoe UI\", sans-serif";
    case "System":
      return "\"Segoe UI\", Arial, sans-serif";
    case "Manrope":
    default:
      return "\"Manrope\", \"Segoe UI\", sans-serif";
  }
};

const resolveLaunchButtonFontSize = (fontSize?: TrainingSlideshowTheme["buttonFontSize"]) => {
  switch (fontSize) {
    case "sm":
      return "0.92rem";
    case "lg":
      return "1.05rem";
    case "md":
    default:
      return "0.98rem";
  }
};

const TrainingLaunch = () => {
  const appSettings = useAppSelector((state) => state.settings);
  const { trainingId = "" } = useParams();
  const googleClientId =
    (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim() ||
    DEFAULT_GOOGLE_CLIENT_ID;
  const previewMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "1";
  const [forcePreviewMode, setForcePreviewMode] = useState(false);
  const effectivePreviewMode = previewMode || forcePreviewMode;
  const [demoSession] = useState(() => getDemoSession());
  const isDemoMode = Boolean(demoSession && demoSession.trainingId === trainingId);

  const audioRef = useRef<HTMLAudioElement>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const avatarAutoAdvanceWatchdogRef = useRef<number | null>(null);
  const submitAdvanceTimerRef = useRef<number | null>(null);
  const askConnectTimerRef = useRef<number | null>(null);
  const avatarRef = useRef<TrainingLaunchAvatarHandle | null>(null);
  const proctoringRef = useRef<TrainingLaunchProctoringHandle | null>(null);
  const autoPlayedSlideRef = useRef("");
  const autoplaySuspendedSlideRef = useRef("");
  const viewedSlideIdsRef = useRef<string[]>([]);
  const audioRequestIdRef = useRef(0);
  const audioPlaybackContextRef = useRef<{
    type: "slide" | "answer" | null;
    slideId: string | null;
  }>({
    type: null,
    slideId: null,
  });
  const resumeNarrationAfterAskRef = useRef<{
    active: boolean;
    slideId: string | null;
  }>({
    active: false,
    slideId: null,
  });
  const browserRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const pendingBrowserTranscriptRef = useRef("");
  const pendingAskTranscriptRef = useRef<{ text: string; metadata: AskTranscriptMetadata } | null>(null);
  const askTranscriptDebounceTimerRef = useRef<number | null>(null);
  const handledAskTranscriptRef = useRef("");
  // Lets long-lived callbacks (the browser speech-recognition instance is now
  // kept alive for the whole Ask session instead of being recreated per
  // question) read current state without closing over a stale value.
  const isQuestionLoadingRef = useRef(false);
  const isAskModeRef = useRef(false);
  // Invalidates an in-flight answer request when the trainee barges in with
  // a new question before the previous one has finished generating/speaking.
  const askRequestIdRef = useRef(0);
  // Distinguishes a deliberate stop (leaving Ask mode / "Go Back") from
  // recognition simply ending on its own, so the auto-restart in
  // fallbackToBrowserListening()'s onend doesn't re-arm the mic right as the
  // trainee is exiting Ask mode.
  const isStoppingAskRecognitionRef = useRef(false);
  // Repeatedly re-asserts the avatar's speaker-enabled state while it's
  // actively "talking". Several distinct things have turned out to leave the
  // avatar visibly speaking (lip-sync/animation) with no actual audio — a
  // stray mute call racing a reconnect, a browser audio-context suspension,
  // OS-level mic-triggered ducking, etc. Rather than continuing to chase each
  // new trigger individually, this heartbeat re-enables the speaker every
  // 400ms for the whole duration of any utterance, so whatever silences it
  // self-corrects within well under a second instead of staying muted for
  // the rest of the slide (or the rest of the session).
  const speakerHeartbeatIntervalRef = useRef<number | null>(null);
  const avatarSpeechContextRef = useRef<{
    type: "slide" | "answer" | null;
    slideId: string | null;
  }>({
    type: null,
    slideId: null,
  });
  const avatarSpeechTimingRef = useRef<{
    slideId: string | null;
    startedAt: number;
    wordCount: number;
    characterCount: number;
    watchdogDelayMs: number;
  }>({
    slideId: null,
    startedAt: 0,
    wordCount: 0,
    characterCount: 0,
    watchdogDelayMs: 0,
  });
  const previousLanguageCodeRef = useRef("");
  const lastAvatarStatusRef =
    useRef<TrainingLaunchAvatarStatus["state"]>("unknown");
  const pendingAvatarInteractionLogRef = useRef<string | null>(null);
  const skipNextPauseStatusLogRef = useRef(false);
  const isPlaybackPausedRef = useRef(false);
  const isStoppingAvatarRef = useRef(false);
  const avatarTalkingSlideIdRef = useRef<string | null>(null);
  // Tracks the question_set step id the avatar has already given guidance for,
  // so multiple question slides each speak once without repeating.
  const questionGuidanceSpokenRef = useRef<string>("");

  const [training, setTraining] = useState<LaunchTrainingRecord | null>(null);
  const [publicLaunchBranding, setPublicLaunchBranding] =
    useState<LaunchTrainingRecord["branding"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [launchAuthToken, setLaunchAuthTokenState] = useState(() =>
    getLaunchAuthToken(),
  );
  const [requiresLaunchLogin, setRequiresLaunchLogin] = useState(
    !previewMode && !isDemoMode && !getLaunchAuthToken(),
  );
  const [launchLoginEmail, setLaunchLoginEmail] = useState("");
  const [launchLoginPassword, setLaunchLoginPassword] = useState("");
  const [showLaunchLoginPassword, setShowLaunchLoginPassword] = useState(false);
  const [launchLoginError, setLaunchLoginError] = useState("");
  const [isLaunchLoginLoading, setIsLaunchLoginLoading] = useState(false);
  const [launchHeaderLogoFailed, setLaunchHeaderLogoFailed] = useState(false);
  const [isGoogleLoginLoading, setIsGoogleLoginLoading] = useState(false);
  const [learnerProfile, setLearnerProfile] = useState<LearnerLaunchProfile | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState<"overview" | "sessions">("overview");
  const [isLaunchActionsOpen, setIsLaunchActionsOpen] = useState(false);
  const [launchReloadKey, setLaunchReloadKey] = useState(0);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const currentSlideIndexRef = useRef(0);
  const manualNavigationNarrationRecoveryStepRef = useRef("");
  const pendingManualNavigationPlaybackGuardRef = useRef(false);
  const manualNavigationPlaybackGuardUntilRef = useRef(0);
  const [, setAudioSrc] = useState("");
  const [audioState, setAudioState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [audioMessage, setAudioMessage] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [isPreparingLaunch, setIsPreparingLaunch] = useState(false);
  const [hasCompletedRun, setHasCompletedRun] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);
  const [showQuestionPanel, setShowQuestionPanel] = useState(false);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const autoplayEnabledRef = useRef(true);
  const [submittedSlides, setSubmittedSlides] = useState<
    Record<string, boolean>
  >({});
  const [slideScores, setSlideScores] = useState<
    Record<string, SlideScoreState>
  >({});
  const [sessionId, setSessionId] = useState("");
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const sessionCreatePromiseRef = useRef<Promise<SessionResponse | null> | null>(null);
  const [headerNow, setHeaderNow] = useState(() => Date.now());
  const [isSubmittingTraining, setIsSubmittingTraining] = useState(false);
  const [isAdvancingAfterSubmit, setIsAdvancingAfterSubmit] = useState(false);
  const [, setQuestionDraft] = useState("");
  const [questionHistory, setQuestionHistory] = useState<QuestionHistoryItem[]>(
    [],
  );
  const questionHistoryRef = useRef<QuestionHistoryItem[]>([]);
  const [questionError, setQuestionError] = useState("");
  const [isQuestionLoading, setIsQuestionLoading] = useState(false);
  const [selectedLanguageCode, setSelectedLanguageCode] = useState("");
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  // Tracks whether the upfront microphone permission probe has resolved
  // (granted or denied) so "Preparing Training" can wait on it the same way
  // it waits on the camera and the avatar, instead of the screen dropping
  // away before the learner has even seen the mic prompt.
  const [micPermissionSettled, setMicPermissionSettled] = useState(false);
  // Blocks "Start Training" until camera + microphone access is confirmed
  // when this training has AI proctoring enabled, and holds the message to
  // show if either is unavailable/denied instead of letting training start.
  const [isVerifyingStartPermissions, setIsVerifyingStartPermissions] = useState(false);
  const [startPermissionError, setStartPermissionError] = useState("");
  // When a manual page refresh (or crash) leaves behind an in-progress,
  // not-yet-submitted session, we no longer auto-resume it silently. Instead
  // this holds the restored session details until the learner explicitly
  // chooses to resume or restart; hasStarted stays false in the meantime so
  // the normal "choose" screen shows instead of jumping straight back in.
  const [pendingResumeSession, setPendingResumeSession] = useState<{
    sessionId: string;
    sessionStartedAt: number | null;
    currentSlideIndex: number;
    questionHistory: QuestionHistoryItem[];
    viewedSlideIds: string[];
  } | null>(null);
  const [avatarVisible, setAvatarVisible] = useState(true);
  const [avatarMuted, setAvatarMuted] = useState(false);
  const [isAskConnecting, setIsAskConnecting] = useState(false);
  const [isAskListening, setIsAskListening] = useState(false);
  const [isAskMode, setIsAskMode] = useState(false);
  const [launchStatus, setLaunchStatus] = useState("");
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [typedLoadingMessage, setTypedLoadingMessage] = useState("");
  const [resolvedPreviewThumbnailUrl, setResolvedPreviewThumbnailUrl] = useState("");
  // const [isBrowserAskSupported] = useState(
  //   Boolean(resolveSpeechRecognitionCtor()),
  // );
  const [googleLoginError, setGoogleLoginError] = useState("");
  const [, setCurrentNarrationTransport] =
    useState<LaunchNarrationTransport>(null);
  const [speechActivity, setSpeechActivity] =
    useState<LaunchSpeechActivity>("idle");
  const [activeLaunchHotspot, setActiveLaunchHotspot] =
    useState<ActiveLaunchHotspotState>(null);
  const [proctoringStatus, setProctoringStatus] =
    useState<TrainingProctoringReport["status"]>("idle");
  const pendingCompletionReportRef = useRef<TrainingProctoringReport | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const launchActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const resumedLaunchBootstrappedRef = useRef(false);

  function clearPendingAskTranscriptCapture() {
    if (askTranscriptDebounceTimerRef.current) {
      window.clearTimeout(askTranscriptDebounceTimerRef.current);
      askTranscriptDebounceTimerRef.current = null;
    }
    pendingAskTranscriptRef.current = null;
  }
  const logAutoplay = useCallback(
    (_event: string, _payload?: Record<string, unknown>) => { },
    [],
  );

  const buildLaunchConfig = () => {
    if (isDemoMode && demoSession) {
      return {
        validateStatus: () => true,
      };
    }
    const token = effectivePreviewMode ? getAuthToken() : launchAuthToken;

    return {
      validateStatus: () => true,
      headers: token
        ? {
          Authorization: `Bearer ${token}`,
        }
        : undefined,
    };
  };

  const getLaunchData = useCallback(
    async <T,>(url: string) => {
      if (!isServerApiEnabled) {
        return mockRequest(
          "GET",
          url,
          undefined,
          getMockParams(url),
        ) as Promise<{ data: ApiEnvelope<T> }>;
      }

      return axios.get<ApiEnvelope<T>>(getRequestUrl(url), buildLaunchConfig());
    },
    [effectivePreviewMode, isDemoMode, launchAuthToken],
  );

  const postLaunchData = useCallback(
    async <T, P = Record<string, unknown>>(url: string, payload: P) => {
      if (!isServerApiEnabled) {
        return mockRequest(
          "POST",
          url,
          payload as Record<string, unknown>,
        ) as Promise<{ data: ApiEnvelope<T> }>;
      }

      return axios.post<ApiEnvelope<T>>(
        getRequestUrl(url),
        payload,
        buildLaunchConfig(),
      );
    },
    [effectivePreviewMode, isDemoMode, launchAuthToken],
  );

  const clearAutoAdvanceTimer = () => {
    if (autoAdvanceTimerRef.current) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  };

  const clearAvatarAutoAdvanceWatchdog = (reason?: string) => {
    if (avatarAutoAdvanceWatchdogRef.current) {
      logAutoplay("Avatar speech watchdog cleared", {
        currentIndex: currentSlideIndexRef.current,
        reason: reason ?? "unspecified",
        slideId: avatarSpeechTimingRef.current.slideId,
        elapsedMs:
          avatarSpeechTimingRef.current.startedAt
            ? Date.now() - avatarSpeechTimingRef.current.startedAt
            : null,
      });
      window.clearTimeout(avatarAutoAdvanceWatchdogRef.current);
      avatarAutoAdvanceWatchdogRef.current = null;
    }
  };

  const resetAudioPlayback = () => {
    audioRequestIdRef.current += 1;
    audioPlaybackContextRef.current = {
      type: null,
      slideId: null,
    };
    avatarSpeechContextRef.current = {
      type: null,
      slideId: null,
    };
  };

  const stopCurrentPlayback = (options?: {
    stopAvatar?: boolean;
    resetCurrentTime?: boolean;
  }) => {
    clearAutoAdvanceTimer();
    clearAvatarAutoAdvanceWatchdog("stop_current_playback");
    resetAudioPlayback();

    if (audioRef.current) {
      audioRef.current.pause();

      if (options?.resetCurrentTime ?? true) {
        audioRef.current.currentTime = 0;
      }
    }

    if (options?.stopAvatar ?? hasAvatarRuntime) {
      isStoppingAvatarRef.current = true;
      avatarTalkingSlideIdRef.current = null;
      avatarRef.current?.stopSpeaking();
      avatarRef.current?.stopListening();
    }
    setIsPlaying(false);
    setCurrentNarrationTransport(hasAvatarRuntime ? "avatar_speech" : "audio");
    setSpeechActivity((current) =>
      current === "listening" ? "listening" : "idle",
    );
  };

  const armManualNavigationPlaybackGuard = () => {
    pendingManualNavigationPlaybackGuardRef.current = true;
    manualNavigationPlaybackGuardUntilRef.current =
      Date.now() + manualNavigationCompletionGuardMs;
  };

  const activateManualNavigationPlaybackGuard = () => {
    if (!pendingManualNavigationPlaybackGuardRef.current) {
      return;
    }

    pendingManualNavigationPlaybackGuardRef.current = false;
    manualNavigationPlaybackGuardUntilRef.current =
      Date.now() + manualNavigationCompletionGuardMs;
  };

  const shouldIgnoreManualNavigationCompletion = (
    playback: {
      type: "slide" | "answer" | null;
      slideId: string | null;
    },
  ) => {
    if (
      playback.type !== "slide" ||
      Date.now() > manualNavigationPlaybackGuardUntilRef.current
    ) {
      return false;
    }

    manualNavigationPlaybackGuardUntilRef.current = 0;
    pendingManualNavigationPlaybackGuardRef.current = false;
    return true;
  };

  const queueAvatarInteractionLog = useCallback(
    (
      action:
        | "next"
        | "previous"
        | "autoplay_on"
        | "autoplay_off"
        | "play"
        | "pause"
        | "ask",
      options?: {
        extra?: Record<string, unknown>;
        immediate?: boolean;
        avatarStatusBeforeClick?: TrainingLaunchAvatarStatus["state"];
        speechActivityOverride?: LaunchSpeechActivity;
      },
    ) => {
      pendingAvatarInteractionLogRef.current = action;

      if (options?.immediate === false) {
        return;
      }

      // console.log("[TrainingLaunch] Avatar interaction", {
      //   action,
      //   avatarStatusBeforeClick:
      //     options?.avatarStatusBeforeClick ?? lastAvatarStatusRef.current,
      //   speechActivity: options?.speechActivityOverride ?? speechActivity,
      //   ...(options?.extra ?? {}),
      // });
    },
    [speechActivity],
  );

  const proctoringEnabled = training?.options?.proctoringEnabled ?? true;
  const isProctoringLive = !proctoringEnabled || proctoringStatus === "monitoring";
  const isVoiceTraining = training?.trainingMode === "voice";
  const learnerSessions = useMemo(() => {
    const profileEmail = learnerProfile?.email.trim().toLowerCase();
    const profileName = learnerProfile?.name.trim().toLowerCase();

    return (training?.sessions ?? []).filter((session) => {
      const sessionEmail = String(session.learnerEmail || "").trim().toLowerCase();
      const sessionName = String(session.learnerName || "").trim().toLowerCase();

      if (profileEmail && sessionEmail) {
        return sessionEmail === profileEmail;
      }

      if (profileName && sessionName) {
        return sessionName === profileName;
      }

      return false;
    });
  }, [learnerProfile?.email, learnerProfile?.name, training?.sessions]);
  const resolvedLearnerProfile = useMemo<LearnerLaunchProfile>(() => {
    const fallbackName = training?.viewerName || learnerProfile?.name || "Learner";
    const fallbackEmail = learnerProfile?.email || launchLoginEmail.trim().toLowerCase() || "Not available";
    const fallbackRole = learnerProfile?.role || "Trainee";
    const sessionsCount = learnerSessions.length || learnerProfile?.sessionsCount || 0;
    const trainingsCount = learnerProfile?.trainingsCount || 0;

    return {
      name: learnerProfile?.name || fallbackName,
      email: fallbackEmail,
      role: String(fallbackRole).replace(/_/g, " "),
      trainingsCount,
      sessionsCount,
    };
  }, [launchLoginEmail, learnerProfile, learnerSessions.length, training?.viewerName]);
  const learnerSessionHistory = useMemo(() => {
    if (training?.learnerSessionHistory?.length) {
      return training.learnerSessionHistory;
    }

    return learnerSessions.map((session) => ({
      sessionId: session.id,
      trainingId: training?.id || "",
      trainingTitle: training?.title || "Current Training",
      trainingType: training?.type || "Not available",
      trainingAudience: training?.audience || "Not available",
      status: session.status,
      timeSpent: session.timeSpent,
      slidesViewed: session.slidesViewed,
      totalSlides: session.totalSlides,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    }));
  }, [learnerSessions, training?.audience, training?.id, training?.learnerSessionHistory, training?.title, training?.type]);
  const sessionSummary = useMemo(() => {
    const uniqueTrainingMap = new Map<
      string,
      {
        completed: boolean;
      }
    >();

    learnerSessionHistory.forEach((session) => {
      const key = session.trainingId || session.trainingTitle;
      const current = uniqueTrainingMap.get(key) || { completed: false };
      uniqueTrainingMap.set(key, {
        completed: current.completed || session.status === "completed",
      });
    });

    const attendedTrainingsCount = uniqueTrainingMap.size;
    const totalSessionsCount = learnerSessionHistory.length;
    const completedTrainingsCount = Array.from(uniqueTrainingMap.values()).filter((item) => item.completed).length;
    const incompleteTrainingsCount = Math.max(attendedTrainingsCount - completedTrainingsCount, 0);

    return {
      attendedTrainingsCount,
      totalSessionsCount,
      completedTrainingsCount,
      incompleteTrainingsCount,
    };
  }, [learnerSessionHistory]);
  const overviewDetails = useMemo(
    () => [
      { label: "Current Training Name", value: training?.title || "Not available" },
      { label: "Training Type", value: training?.type || "Not available" },
      { label: "Training Duration", value: `${Math.max(Number(training?.durationMins || 0), 0)} min` },
      { label: "Training Mode", value: isVoiceTraining ? "Voice" : "Avatar" },
    ],
    [isVoiceTraining, training?.durationMins, training?.title, training?.type],
  );
  const loadingGuidanceMessages = useMemo(() => {
    const statusMessage = launchStatus?.trim();
    const leadingMessage =
      proctoringStatus === "error"
        ? statusMessage || "Proctoring could not go live. Please allow camera access and try again."
        : statusMessage || "Waiting for proctoring to go live.";

    return [
      leadingMessage,
      "Camera verification is running in the background.",
      "Please keep your face clearly visible on screen.",
      "Avoid switching tabs during the training session.",
      "Microphone and camera permissions should remain enabled.",
      "Stay attentive during training for a smooth assessment flow.",
      "Session checks are preparing your live training environment.",
    ];
  }, [launchStatus, proctoringStatus]);
  const activeLoadingGuidanceMessage =
    loadingGuidanceMessages[loadingMessageIndex % loadingGuidanceMessages.length] ||
    "Waiting for proctoring to go live.";

  useEffect(() => {
    return () => {
      clearAutoAdvanceTimer();
      clearAvatarAutoAdvanceWatchdog("component_unmount");
      if (submitAdvanceTimerRef.current) {
        window.clearTimeout(submitAdvanceTimerRef.current);
        submitAdvanceTimerRef.current = null;
      }
      if (askConnectTimerRef.current) {
        window.clearTimeout(askConnectTimerRef.current);
        askConnectTimerRef.current = null;
      }
      if (speakerHeartbeatIntervalRef.current) {
        window.clearInterval(speakerHeartbeatIntervalRef.current);
        speakerHeartbeatIntervalRef.current = null;
      }
      proctoringRef.current?.stopSession();
    };
  }, []);

  useEffect(() => {
    if (!isLanguageMenuOpen && !isLaunchActionsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setIsLanguageMenuOpen(false);
      }

      if (!launchActionsMenuRef.current?.contains(event.target as Node)) {
        setIsLaunchActionsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isLanguageMenuOpen, isLaunchActionsOpen]);

  useEffect(() => {
    setIsAdvancingAfterSubmit(false);

    if (submitAdvanceTimerRef.current) {
      window.clearTimeout(submitAdvanceTimerRef.current);
      submitAdvanceTimerRef.current = null;
    }
  }, [currentSlideIndex]);

  useEffect(() => {
    if (!hasStarted || !sessionStartedAt) {
      return undefined;
    }

    setHeaderNow(Date.now());
    const timer = window.setInterval(() => {
      setHeaderNow(Date.now());
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasStarted, sessionStartedAt]);

  useEffect(() => {
    let active = true;

    if (!effectivePreviewMode && !isDemoMode && !launchAuthToken) {
      setRequiresLaunchLogin(true);
      setTraining(null);
      setErrorMessage("");
      setIsLoading(true);

      void getLaunchData<LaunchBrandingResponse>(
        `/launch/trainings/${trainingId}/branding`,
      )
        .then((response) => {
          if (!active) {
            return;
          }

          if (!response.data.status) {
            throw new Error(
              response.data.message || "Unable to load training branding.",
            );
          }

          setPublicLaunchBranding(response.data.data.branding);
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }

          setPublicLaunchBranding(null);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load training branding.",
          );
        })
        .finally(() => {
          if (active) {
            setIsLoading(false);
          }
        });

      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    setErrorMessage("");
    setAvatarReady(false);
    setStartPermissionError("");
    setIsVerifyingStartPermissions(false);
    setLaunchLoginError("");
    setGoogleLoginError("");

    const trainingUrl = isDemoMode && demoSession
      ? `/demo/${demoSession.demoToken}?guestName=${encodeURIComponent(demoSession.guestName)}&guestEmail=${encodeURIComponent(demoSession.guestEmail)}`
      : `/launch/trainings/${trainingId}${effectivePreviewMode ? "?preview=1" : ""}`;

    void getLaunchData<LaunchResponse>(
      trainingUrl,
    )
      .then((response) => {
        if (!active) {
          return;
        }

        if (!response.data.status) {
          throw new Error(
            response.data.message || "Unable to load the training launch.",
          );
        }

        const nextTraining = response.data.data;
        setPublicLaunchBranding(nextTraining.branding ?? null);
        const restoredSession =
          !effectivePreviewMode && (launchAuthToken || isDemoMode)
            ? getLaunchSessionSnapshot(nextTraining.id)
            : null;
        const nextLaunchSequence = buildLaunchSequence(nextTraining);
        const restoredSlideIndex = restoredSession
          ? clampIndex(restoredSession.currentSlideIndex, nextLaunchSequence.length)
          : 0;
        const hasIncompleteRestoredSession = Boolean(
          restoredSession?.hasStarted && restoredSession.sessionId,
        );

        setTraining(nextTraining);
        setLearnerProfile((current) => ({
          name: current?.name || (isDemoMode && demoSession ? demoSession.guestName : "") || nextTraining.viewerName || "Learner",
          email: current?.email || (isDemoMode && demoSession ? demoSession.guestEmail : "") || launchLoginEmail.trim().toLowerCase(),
          role: current?.role || (isDemoMode ? "Guest" : "Trainee"),
          trainingsCount: current?.trainingsCount || 1,
          sessionsCount: current?.sessionsCount || 0,
        }));
        setRequiresLaunchLogin(false);
        setSubmittedSlides({});
        setSlideScores({});
        // Never auto-resume an in-progress session on load — hasStarted stays
        // false so the "Resume or Restart?" choice screen shows instead of
        // silently dropping the learner back into mid-training content before
        // the avatar/proctoring/mic have even had a chance to reconnect.
        setHasStarted(false);
        setHasCompletedRun(false);
        setQuestionDraft("");
        setQuestionError("");
        setShowQuestionPanel(false);
        setIsAskListening(false);
        setIsAskMode(false);
        setIsPlaybackPaused(false);
        isPlaybackPausedRef.current = false;
        setSelectedLanguageCode(
          nextTraining.localizedVoiceovers?.defaultLanguageCode ||
          nextTraining.localizedVoiceovers?.languages?.[0]?.code ||
          "",
        );
        setLaunchStatus("");
        setIsPreparingLaunch(false);
        setProctoringStatus("idle");
        resumedLaunchBootstrappedRef.current = false;

        if (hasIncompleteRestoredSession && restoredSession) {
          setCurrentSlideIndex(0);
          viewedSlideIdsRef.current = [];
          setSessionId("");
          setSessionStartedAt(null);
          setQuestionHistory([]);
          questionHistoryRef.current = [];
          setPendingResumeSession({
            sessionId: restoredSession.sessionId,
            sessionStartedAt: restoredSession.sessionStartedAt,
            currentSlideIndex: restoredSlideIndex,
            questionHistory: restoredSession.questionHistory ?? [],
            viewedSlideIds: restoredSession.viewedSlideIds ?? [],
          });
        } else {
          setPendingResumeSession(null);
          setCurrentSlideIndex(restoredSlideIndex);
          setSessionId("");
          setSessionStartedAt(null);
          setQuestionHistory([]);
          questionHistoryRef.current = [];
          viewedSlideIdsRef.current = [];
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Unable to load the training launch.";
        const normalizedMessage = message.toLowerCase();

        if (
          !effectivePreviewMode &&
          launchAuthToken &&
          (normalizedMessage.includes(
            "published training launch was not found",
          ) ||
            normalizedMessage.includes("not currently published"))
        ) {
          setForcePreviewMode(true);
          return;
        }

        if (
          !effectivePreviewMode &&
          (normalizedMessage.includes("launch login is required") ||
            normalizedMessage.includes("unauthorized") ||
            normalizedMessage.includes("invalid token") ||
            normalizedMessage.includes(
              "approved training launch was not found",
            ))
        ) {
          clearLaunchAuthToken();
          clearLaunchSessionSnapshot(trainingId);
          setLaunchAuthTokenState("");
          setRequiresLaunchLogin(true);
          setTraining(null);
          setErrorMessage("");
          setLaunchLoginError(
            normalizedMessage.includes("approved training launch was not found")
              ? "Only trainee accounts can open this training link."
              : "",
          );
          return;
        }

        setErrorMessage(message);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    effectivePreviewMode,
    getLaunchData,
    launchAuthToken,
    launchReloadKey,
    trainingId,
  ]);

  useEffect(() => {
    if (!training) {
      return;
    }

    if (!hasStarted || !sessionId || hasCompletedRun) {
      clearLaunchSessionSnapshot(training.id);
      return;
    }

    setLaunchSessionSnapshot(training.id, {
      trainingId: training.id,
      sessionId,
      sessionStartedAt,
      currentSlideIndex,
      viewedSlideIds: viewedSlideIdsRef.current,
      hasStarted,
      questionHistory: questionHistoryRef.current,
    });
  }, [
    currentSlideIndex,
    hasCompletedRun,
    hasStarted,
    questionHistory,
    sessionId,
    sessionStartedAt,
    training,
  ]);

  const launchSequence = useMemo(
    () => buildLaunchSequence(training),
    [training],
  );
  useEffect(() => {
    currentSlideIndexRef.current = currentSlideIndex;
  }, [currentSlideIndex]);
  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled;
  }, [autoplayEnabled]);
  useEffect(() => {
    isQuestionLoadingRef.current = isQuestionLoading;
  }, [isQuestionLoading]);
  useEffect(() => {
    isAskModeRef.current = isAskMode;
  }, [isAskMode]);
  useEffect(() => {
    const nextCode =
      training?.localizedVoiceovers?.defaultLanguageCode ||
      training?.localizedVoiceovers?.languages?.[0]?.code ||
      "";

    if (!nextCode) {
      if (selectedLanguageCode) {
        setSelectedLanguageCode("");
      }
      return;
    }

    const isValidSelection = training?.localizedVoiceovers?.languages?.some(
      (language) => language.code === selectedLanguageCode,
    );

    if (!selectedLanguageCode || !isValidSelection) {
      setSelectedLanguageCode(nextCode);
    }
  }, [selectedLanguageCode, training?.localizedVoiceovers]);
  const currentSequenceItem = useMemo(
    () =>
      launchSequence.length
        ? (launchSequence[
          clampIndex(currentSlideIndex, launchSequence.length)
        ] ?? null)
        : null,
    [currentSlideIndex, launchSequence],
  );
  const currentSlide = useMemo(() => {
    if (!training || !currentSequenceItem) {
      return null;
    }

    if (currentSequenceItem.kind === "slide") {
      return currentSequenceItem.slide;
    }

    const anchorSlide =
      training.slides[currentSequenceItem.anchorSlideIndex] ??
      training.slides.find(
        (slide) => slide.id === currentSequenceItem.questionSet.slideId,
      ) ??
      training.slides[0] ??
      null;

    return anchorSlide;
  }, [currentSequenceItem, training]);
  const previewCoverSlide = useMemo(() => {
    if (!training) {
      return null;
    }

    if (training.previewSlideId) {
      return (
        training.slides.find((slide) => slide.id === training.previewSlideId) ??
        training.slides[0] ??
        null
      );
    }

    return training.slides[0] ?? null;
  }, [training]);
  const previewMediaUrl =
    resolvedPreviewThumbnailUrl ||
    (training?.previewThumbnailUrl && training.previewThumbnailUrl.trim()
      ? training.previewThumbnailUrl
      : previewCoverSlide?.mediaUrl || "");
  const displaySlide = !hasStarted || isPreparingLaunch
    ? previewCoverSlide ?? currentSlide
    : currentSlide;
  const isQuestionSetStep = currentSequenceItem?.kind === "question_set";
  const currentQuestionSet =
    currentSequenceItem?.kind === "question_set"
      ? currentSequenceItem.questionSet
      : null;
  const questionSetFields = useMemo(
    () =>
      currentSequenceItem?.kind === "question_set"
        ? currentSequenceItem.questionSet.checkpoints.map((checkpoint) =>
          buildTrainingQuestionField(checkpoint),
        )
        : [],
    [currentSequenceItem],
  );
  const currentSlideRequiresSubmit = Boolean(
    isQuestionSetStep
      ? currentQuestionSet?.isMandatory !== false && questionSetFields.length
      : currentSlide?.formConfig?.waitForSubmit &&
      currentSlide.formFields?.some((field) =>
        isLaunchInputField(field.type),
      ),
  );
  const currentSlideHasForm = Boolean(
    hasStarted &&
    currentSequenceItem?.kind === "slide" &&
    currentSlide?.formFields?.length,
  );
  const currentSlideSubmitted = Boolean(
    currentSequenceItem && submittedSlides[currentSequenceItem.id],
  );
  const currentStepSubmitted = Boolean(
    currentSequenceItem && submittedSlides[currentSequenceItem.id],
  );
  const isLastStep = Boolean(
    launchSequence.length && currentSlideIndex >= launchSequence.length - 1,
  );
  const currentDisplaySlideCounter = launchSequence.length
    ? clampIndex(currentSlideIndex, launchSequence.length) + 1
    : 0;
  const elapsedMinutes = sessionStartedAt
    ? Math.max(1, Math.floor((headerNow - sessionStartedAt) / 60000))
    : 0;
  const totalTrainingMinutes = training?.durationMins ?? 0;
  const currentNarrationIndex =
    currentSequenceItem?.kind === "slide"
      ? currentSequenceItem.slideIndex
      : currentSequenceItem?.kind === "question_set"
        ? currentSequenceItem.anchorSlideIndex
        : 0;
  useEffect(() => {
    if (!training || !launchSequence.length) {
      return;
    }

    logAutoplay("Launch sequence built", {
      trainingId: training.id,
      totalSteps: launchSequence.length,
      totalSlides: training.slides.length,
      steps: launchSequence.map((item, index) => ({
        index,
        kind: item.kind,
        id: item.id,
        title:
          item.kind === "slide"
            ? item.slide.title
            : item.questionSet.label,
        requiresSubmit:
          item.kind === "question_set"
            ? item.questionSet.isMandatory !== false &&
            item.questionSet.checkpoints.length > 0
            : false,
      })),
    });
  }, [launchSequence, logAutoplay, training]);
  useEffect(() => {
    if (!hasStarted || !currentSequenceItem) {
      return;
    }

    logAutoplay("Entered step", {
      index: currentSlideIndex,
      kind: currentSequenceItem.kind,
      id: currentSequenceItem.id,
      title:
        currentSequenceItem.kind === "slide"
          ? currentSequenceItem.slide.title
          : currentSequenceItem.questionSet.label,
      autoplayEnabled,
      requiresSubmit: currentSlideRequiresSubmit,
      submitted: currentSlideSubmitted,
      isQuestionSetStep,
    });

    if (autoplayEnabled && currentSequenceItem.kind === "question_set") {
      // console.warn(
      //   "[TrainingLaunch][Autoplay] Reached question_set step. Autoplay will wait for manual submit/continue.",
      //   {
      //     index: currentSlideIndex,
      //     id: currentSequenceItem.id,
      //     label: currentSequenceItem.questionSet.label,
      //     requiresSubmit: currentSlideRequiresSubmit,
      //   },
      // );
    }
  }, [
    autoplayEnabled,
    currentSequenceItem,
    currentSlideIndex,
    currentSlideRequiresSubmit,
    currentSlideSubmitted,
    hasStarted,
    isQuestionSetStep,
    logAutoplay,
  ]);
  const assistantLabel =
    training?.trainingMode === "voice"
      ? "Assistant"
      : training?.avatarName || "Amara";
  const resolvedAvatarId =
    training?.avatarEngine?.avatarId || training?.avatarId || defaultLaunchAvatarId;
  const hasAvatarRuntime = Boolean(
    training?.trainingMode !== "voice" && resolvedAvatarId,
  );
  // Only "provider-TV" (Tavus) routes to the Tavus runtime; anything else
  // (missing, "Trulience", "provider-TL") keeps the existing Trulience path.
  const isTavusAvatarProvider = training?.avatarEngine?.provider === "provider-TV";
  const resolvedTavusReplicaId = training?.avatarEngine?.replicaId || resolvedAvatarId;
  const resolvedTavusPersonaId = training?.avatarEngine?.personaId;
  const isLaunchRuntimeReady = Boolean(
    isProctoringLive && (!hasAvatarRuntime || avatarReady),
  );
  // Requests (and immediately releases) the microphone up front, at the same
  // time as the camera permission prompt, so both prompts appear together
  // before the learner sees any training content, instead of the mic only
  // being requested later when a voice feature first needs it.
  const primeMicrophonePermission = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicPermissionSettled(true);
      return;
    }

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.getTracks().forEach((track) => track.stop());
    } catch {
      // Denied/unavailable mic shouldn't block the whole launch by itself;
      // voice features that actually need it will surface their own error.
    } finally {
      setMicPermissionSettled(true);
    }
  }, []);
  useEffect(() => {
    if (!training || !hasStarted || hasCompletedRun || !sessionId || !sessionStartedAt) {
      resumedLaunchBootstrappedRef.current = false;
      return;
    }

    if (proctoringStatus !== "idle" && proctoringStatus !== "connecting") {
      return;
    }

    if (resumedLaunchBootstrappedRef.current) {
      return;
    }

    resumedLaunchBootstrappedRef.current = true;
    setIsPreparingLaunch(true);
    setLaunchStatus(
      hasAvatarRuntime
        ? "Waiting for proctoring to go live."
        : "Waiting for camera feed to go live.",
    );
    setMicPermissionSettled(false);
    avatarRef.current?.primeAudio();
    void primeMicrophonePermission();
    void proctoringRef.current?.startSession();
  }, [
    hasAvatarRuntime,
    hasCompletedRun,
    hasStarted,
    primeMicrophonePermission,
    proctoringStatus,
    sessionId,
    sessionStartedAt,
    training,
  ]);
  useEffect(() => {
    if (!hasStarted || !hasAvatarRuntime || typeof document === "undefined") {
      return;
    }

    // Browsers only allow an AudioContext to move from "suspended" to
    // "running" inside a genuine user-gesture call stack. The click that
    // starts training satisfies that for the first slide, but autoplay and
    // Ask-mode answers are triggered from timers/network callbacks with no
    // gesture behind them — and every time the avatar's connection drops and
    // reconnects (their SDK does this every 20-40s or so per its own logs),
    // it spins up a fresh internal audio context that starts suspended again.
    // Lip-sync/animation doesn't depend on that context, so the avatar
    // visibly "talks" while producing no sound. Re-priming on every click
    // anywhere in the page (not just the dedicated controls) maximizes the
    // chance a freshly-suspended context gets unlocked by the very next
    // interaction instead of staying silently muted for the rest of the run.
    const unlockAvatarAudio = () => {
      avatarRef.current?.primeAudio();
    };

    document.addEventListener("click", unlockAvatarAudio);
    document.addEventListener("touchstart", unlockAvatarAudio, { passive: true });
    document.addEventListener("keydown", unlockAvatarAudio);

    return () => {
      document.removeEventListener("click", unlockAvatarAudio);
      document.removeEventListener("touchstart", unlockAvatarAudio);
      document.removeEventListener("keydown", unlockAvatarAudio);
    };
  }, [hasStarted, hasAvatarRuntime]);
  const selectedLocalizedLanguage = useMemo(
    () => findLocalizedLanguage(training?.localizedVoiceovers, selectedLanguageCode),
    [selectedLanguageCode, training?.localizedVoiceovers],
  );
  const selectedSpeechLocale = useMemo(
    () => resolveLocalizedLaunchLocale(selectedLocalizedLanguage, training?.avatarEngine?.language),
    [selectedLocalizedLanguage, training?.avatarEngine?.language],
  );
  const currentLanguageLabels = selectedLocalizedLanguage?.buttonLabels;
  const getLocalizedSlideVoiceover = useCallback(
    (slide: LaunchSlide | null) => {
      if (!slide || !selectedLocalizedLanguage || selectedLocalizedLanguage.isDefault) {
        return null;
      }

      return (
        selectedLocalizedLanguage.translatedSlides.find(
          (translatedSlide) => translatedSlide.slideId === slide.id,
        ) || null
      );
    },
    [selectedLocalizedLanguage],
  );
  const currentLocalizedSlideVoiceover = currentSlide
    ? getLocalizedSlideVoiceover(currentSlide)
    : null;
  const displayLocalizedSlideVoiceover = displaySlide
    ? getLocalizedSlideVoiceover(displaySlide)
    : null;
  const displayMediaUrl = !hasStarted || isPreparingLaunch
    ? previewMediaUrl || displayLocalizedSlideVoiceover?.mediaUrl || displaySlide?.mediaUrl || ""
    : currentLocalizedSlideVoiceover?.mediaUrl || currentSlide?.mediaUrl || "";
  const activeSlideHotspots = hasStarted
    ? currentLocalizedSlideVoiceover?.interactiveHotspots?.length
      ? currentLocalizedSlideVoiceover.interactiveHotspots
      : currentSlide?.interactiveHotspots ?? []
    : [];
  const showLaunchChrome = hasStarted && !isPreparingLaunch;
  const areLaunchControlsLocked = hasStarted && !isLaunchRuntimeReady;
  const getSlideScript = useCallback(
    (slide: LaunchSlide | null, index: number) =>
      sanitizeLaunchNarrationScript({
        script: getLocalizedSlideVoiceover(slide)?.script || slide?.script || "",
        trainingTitle: training?.title || "",
        slideTitle: slide?.title || "",
        index,
      }),
    [getLocalizedSlideVoiceover, training?.title],
  );
  const currentSlideScript = useMemo(
    () =>
      getSlideScript(
        currentSlide,
        currentNarrationIndex,
      ),
    [currentNarrationIndex, currentSlide, getSlideScript],
  );

  const currentSlideHasPlayableNarration = useMemo(() => {
    if (!currentSlide || currentSequenceItem?.kind !== "slide") {
      return false;
    }

    if (training?.trainingMode === "voice") {
      return Boolean(
        currentLocalizedSlideVoiceover?.narrationAudio?.src ||
        String(currentSlideScript || "").trim() ||
        currentSlide.narrationAudio?.src ||
        String(currentSlide.script || "").trim(),
      );
    }

    return Boolean(String(currentSlideScript || "").trim());
  }, [
    currentLocalizedSlideVoiceover,
    currentSequenceItem,
    currentSlide,
    currentSlideScript,
    training?.trainingMode,
  ]);

  const isSlidePlaybackActive = Boolean(
    hasStarted &&
    !isQuestionSetStep &&
    !isPlaybackPaused &&
    (speechActivity === "speaking" || isPlaying),
  );
  const playbackButtonLabel = isQuestionSetStep
    ? "Question"
    : !hasAvatarRuntime && audioState === "loading" && !isPlaybackPaused
      ? training?.trainingMode === "voice"
        ? "Loading..."
        : "Generating..."
      : isSlidePlaybackActive
        ? "Pause"
        : "Play";
  const autoplayButtonLabel = autoplayEnabled ? "Autoplay Off" : "Autoplay On";
  const autoplayButtonIcon = autoplayEnabled
    ? "bi-skip-forward-fill"
    : "bi-pause-circle";
  const autoplayButtonClass = autoplayEnabled
    ? "btn-secondary"
    : "btn-primary";
  const playbackButtonIcon = isSlidePlaybackActive
    ? "bi-pause-fill"
    : "bi-play-fill";
  const launchAskButtonLabel = isAskConnecting
    ? "Connecting..."
    : isQuestionLoading
      ? "Replying..."
      : isAskListening
        ? "Listening..."
        : currentLanguageLabels?.ask || training?.questionButtonLabel || "Ask Question";
  const previousButtonLabel = currentLanguageLabels?.previous || "Previous";
  const nextButtonLabel = currentLanguageLabels?.next || "Next";
  const launchAskButtonIcon = isAskConnecting
    ? "bi-arrow-repeat"
    : isQuestionLoading
      ? "bi-hourglass-split"
      : isAskListening
        ? "bi-mic-fill"
        : "bi-chat-dots-fill";
  const askModeListenButtonLabel = isQuestionLoading
    ? "Replying..."
    : isAskListening
      ? "Listening..."
      : "Start Listening";
  const askModeListenButtonIcon = isQuestionLoading
    ? "bi-hourglass-split"
    : isAskListening
      ? "bi-stop-circle-fill"
      : "bi-mic-fill";
  const launchScoreSummary = useMemo(() => {
    const values = Object.values(slideScores);
    const correctAnswers = values.reduce(
      (sum, item) => sum + item.correctAnswers,
      0,
    );
    const totalQuestions = values.reduce(
      (sum, item) => sum + item.totalQuestions,
      0,
    );
    const score =
      totalQuestions > 0
        ? Math.round((correctAnswers / totalQuestions) * 100)
        : null;

    return {
      correctAnswers,
      totalQuestions,
      score,
    };
  }, [slideScores]);

  const playAudioSource = useCallback(
    async (
      src: string,
      options: {
        type: "slide" | "answer";
        slideId?: string | null;
        loadingMessage?: string;
        errorMessage: string;
      },
    ) => {
      if (!audioRef.current || !src) {
        return false;
      }

      const requestId = audioRequestIdRef.current + 1;
      audioRequestIdRef.current = requestId;
      clearAutoAdvanceTimer();

      // prevent duplicate replay of same thing
      if (
        audioPlaybackContextRef.current.type === options.type &&
        audioPlaybackContextRef.current.slideId === (options.slideId ?? null) &&
        !audioRef.current.paused
      ) {
        return true;
      }

      audioPlaybackContextRef.current = {
        type: options.type,
        slideId: options.slideId ?? null,
      };

      setCurrentNarrationTransport("audio");
      setSpeechActivity("loading");
      setAudioState("ready");
      setAudioMessage("");

      try {
        if (requestId !== audioRequestIdRef.current || !audioRef.current) {
          return false;
        }

        // only set src if different
        if (audioRef.current.src !== src) {
          audioRef.current.src = src;
        }

        await audioRef.current.play();
        return true;
      } catch (error) {
        if (requestId !== audioRequestIdRef.current) {
          return false;
        }

        audioPlaybackContextRef.current = {
          type: null,
          slideId: null,
        };
        setAudioState("error");
        setAudioMessage(
          error instanceof Error ? error.message : options.errorMessage,
        );
        setIsPlaying(false);
        setSpeechActivity("idle");
        return false;
      }
    },
    [],
  );

  const playTrainingTextAudio = useCallback(
    async (
      text: string,
      options: {
        type: "slide" | "answer";
        slideId?: string | null;
        errorMessage: string;
      },
    ) => {
      const normalizedText = String(text || "").trim();

      if (!training || !normalizedText) {
        return false;
      }

      try {
        const requestId = audioRequestIdRef.current + 1;
        audioRequestIdRef.current = requestId;
        clearAutoAdvanceTimer();
        audioPlaybackContextRef.current = {
          type: options.type,
          slideId: options.slideId ?? null,
        };
        setCurrentNarrationTransport("audio");
        setAudioState("loading");
        setAudioMessage("");
        setSpeechActivity("loading");

        const src = await generateScriptAudioDataUri(normalizedText, {
          provider: selectedLocalizedLanguage?.provider || training.ttsProvider,
          voiceName: selectedLocalizedLanguage?.voiceName || training.voiceName,
          voiceId: selectedLocalizedLanguage?.voiceId || training.voiceId,
          trainingId: training.id,
        });

        if (requestId !== audioRequestIdRef.current) {
          return false;
        }

        return playAudioSource(src, {
          ...options,
          loadingMessage: "Generating audio...",
        });
      } catch (error) {
        setAudioSrc("");
        setAudioState("error");
        setAudioMessage(
          error instanceof Error ? error.message : options.errorMessage,
        );
        setIsPlaying(false);
        setSpeechActivity("idle");
        return false;
      }
    },
    [playAudioSource, selectedLocalizedLanguage, training],
  );

  const speakAvatarText = useCallback(
    async (
      text: string,
      options: {
        type: "slide" | "answer";
        slideId?: string | null;
        errorMessage: string;
      },
    ) => {
      const plainText = String(text || "").trim();
      const wordCount = plainText.split(/\s+/).filter(Boolean).length;
      const characterCount = plainText.length;

      // Trulience's sendMessageToAvatar() goes through its own conversational
      // agent, which will paraphrase/respond to plain text instead of just
      // saying it — hence the "repeat exact text" instruction prefix. Tavus's
      // speakText() drives the Interactions Protocol's echo event instead,
      // which already speaks whatever text it's given verbatim with no LLM in
      // the loop, so wrapping it in an instruction just makes the avatar say
      // the instruction out loud too.
      const normalizedText = isTavusAvatarProvider
        ? plainText
        : options.type === "slide"
          ? 'Please repeat the exact this same text: ' + plainText
          : 'repeat exact text: ' + plainText;

      if (!normalizedText || !training) {
        return false;
      }

      if (!avatarReady) {
        // Callers already check avatarReady before calling this, but if the
        // avatar drops/hasn't finished (re)connecting right in that narrow
        // window — e.g. right after resuming a training, before its
        // connection has fully settled — this used to bail out silently
        // with zero cleanup: no error shown, and isPlaying/speechActivity
        // left however they were. That's exactly what makes the avatar look
        // permanently "muted": nothing ever spoke, but nothing ever told the
        // trainee why or reset the stuck loading/listening state either.
        setCurrentNarrationTransport(null);
        setSpeechActivity("idle");
        setIsPlaying(false);
        setQuestionError(
          "The avatar isn't connected yet. Please wait a moment and try again.",
        );
        return false;
      }

      resetAudioPlayback();
      avatarSpeechContextRef.current = {
        type: options.type,
        slideId: options.slideId ?? null,
      };
      setCurrentNarrationTransport("avatar_speech");
      setSpeechActivity("loading");
      setIsPlaying(true);
      setAudioState("idle");
      setAudioMessage("");

      const didStart = avatarRef.current?.speakText({
        text: normalizedText,
        trainingId: training.id,
        currentSlideId: options.slideId ?? currentSlide?.id ?? null,
      }) ?? false;

      if (didStart && options.type === "slide") {
        avatarSpeechTimingRef.current = {
          slideId: options.slideId ?? currentSlide?.id ?? null,
          startedAt: Date.now(),
          wordCount,
          characterCount,
          watchdogDelayMs: 0,
        };
        logAutoplay("Avatar slide speech started", {
          currentIndex: currentSlideIndexRef.current,
          slideId: options.slideId ?? currentSlide?.id ?? null,
          startedAt: avatarSpeechTimingRef.current.startedAt,
          wordCount,
          characterCount,
        });
        scheduleAvatarAutoAdvanceWatchdog();
      }

      if (!didStart) {
        avatarSpeechContextRef.current = {
          type: null,
          slideId: null,
        };
        setCurrentNarrationTransport(null);
        setSpeechActivity("idle");
        setIsPlaying(false);
        setQuestionError(options.errorMessage);
      }

      return didStart;
    },
    [avatarReady, currentSlide?.id, isTavusAvatarProvider, logAutoplay, training],
  );

  const playCurrentSlideNarration = useCallback(
    async (options?: { force?: boolean }) => {
      const isVoiceMode = training?.trainingMode === "voice";
      const canProceed = options?.force || hasStarted;

      // debugLaunch("playCurrentSlideNarration called", {
      //   force: options?.force,
      //   canProceed,
      //   isVoiceMode,
      //   hasStarted,
      //   currentSequenceItemKind: currentSequenceItem?.kind,
      //   currentSequenceItemId: currentSequenceItem?.id,
      //   currentSlideId: currentSlide?.id,
      //   currentSlideTitle: currentSlide?.title,
      //   currentSlideScript,
      //   narrationSrc: currentSlide?.narrationAudio?.src,
      //   autoPlayedSlideRef: autoPlayedSlideRef.current,
      // });

      // Identify the target script depending on the mode.
      const targetScript = currentSlideScript;

      if (
        !canProceed ||
        !currentSequenceItem ||
        currentSequenceItem.kind !== "slide" ||
        !currentSlide ||
        (!isVoiceMode && !targetScript) ||
        !isLaunchRuntimeReady
      ) {
        // debugLaunch("playCurrentSlideNarration blocked");
        setAudioSrc("");
        setAudioState("idle");
        if (!isLaunchRuntimeReady) {
          setIsPlaying(false);
          setSpeechActivity("idle");
          setLaunchStatus(
            isVoiceMode
              ? "Waiting for camera feed to go live."
              : "Waiting for proctoring to go live.",
          );
        }
        return false;
      }

      if (
        !options?.force &&
        autoPlayedSlideRef.current === currentSequenceItem.id
      ) {
        // debugLaunch("playCurrentSlideNarration skipped: already auto played", {
        //   id: currentSequenceItem.id,
        // });
        return true;
      }

      autoPlayedSlideRef.current = currentSequenceItem.id;
      setIsPlaybackPaused(false);
      isPlaybackPausedRef.current = false;

      if (isVoiceMode) {
        if (currentLocalizedSlideVoiceover?.narrationAudio?.src) {
          return await playAudioSource(currentLocalizedSlideVoiceover.narrationAudio.src, {
            type: "slide",
            slideId: currentSlide.id,
            errorMessage: "Localized narration audio is missing for this slide.",
          });
        }

        if (targetScript) {
          return await playTrainingTextAudio(targetScript, {
            type: "slide",
            slideId: currentSlide.id,
            errorMessage: "Narration audio could not be generated for this slide.",
          });
        }

        if (currentSlide.narrationAudio?.src) {
          return await playAudioSource(currentSlide.narrationAudio.src, {
            type: "slide",
            slideId: currentSlide.id,
            errorMessage:
              "Stored narration audio is missing for this voice-mode slide.",
          });
        }

        if (String(currentSlide.script || "").trim()) {
          return await playTrainingTextAudio(currentSlide.script, {
            type: "slide",
            slideId: currentSlide.id,
            errorMessage: "Fallback narration audio could not be generated.",
          });
        }

        setAudioState("error");
        setAudioMessage(
          "Stored narration audio is missing for this voice-mode slide.",
        );
        autoPlayedSlideRef.current = "";
        return false;
      }

      // debugLaunch("playCurrentSlideNarration -> speakAvatarText", {
      //   slideId: currentSlide.id,
      // });

      return await speakAvatarText(targetScript as string, {
        type: "slide",
        slideId: currentSlide.id,
        errorMessage: "Avatar narration could not be started for this slide.",
      });
    },
    [
      avatarReady,
      currentSequenceItem,
      currentLocalizedSlideVoiceover,
      currentSlide,
      currentSlideScript,
      hasAvatarRuntime,
      hasStarted,
      isLaunchRuntimeReady,
      playAudioSource,
      playTrainingTextAudio,
      speakAvatarText,
      training?.trainingMode,
    ],
  );

  const resumeCurrentSlideNarration = useCallback(() => {
    const shouldResume = resumeNarrationAfterAskRef.current.active;

    resumeNarrationAfterAskRef.current = {
      active: false,
      slideId: null,
    };
    autoplaySuspendedSlideRef.current = "";

    if (
      !shouldResume ||
      !hasStarted ||
      !currentSlide?.id ||
      !currentSlideScript
    ) {
      return;
    }

    autoPlayedSlideRef.current = "";
    setIsPlaybackPaused(false);
    isPlaybackPausedRef.current = false;
    setLaunchStatus("");
    void playCurrentSlideNarration({ force: true });
  }, [
    currentSlide?.id,
    currentSlideScript,
    hasStarted,
    playCurrentSlideNarration,
  ]);

  useEffect(() => {
    if (!hasStarted || !currentSlide?.id) {
      previousLanguageCodeRef.current = selectedLanguageCode;
      return;
    }

    if (previousLanguageCodeRef.current === selectedLanguageCode) {
      return;
    }

    previousLanguageCodeRef.current = selectedLanguageCode;
    autoPlayedSlideRef.current = "";
    setIsPlaybackPaused(false);
    isPlaybackPausedRef.current = false;
    void playCurrentSlideNarration({ force: true });
  }, [currentSlide?.id, hasStarted, playCurrentSlideNarration, selectedLanguageCode]);

  useEffect(() => {
    if (!training || !currentSlide || !hasStarted) {
      resetAudioPlayback();
      setAudioSrc("");
      setAudioState("idle");
      setAudioMessage("");
      autoPlayedSlideRef.current = "";
      setIsAskListening(false);
      setLaunchStatus("");
      setCurrentNarrationTransport(null);
      setSpeechActivity("idle");
      return;
    }

    if (!hasAvatarRuntime || !avatarReady) {
      return;
    }

    avatarRef.current?.pushTrainingContext({
      trainingId: training.id,
      currentSlideId: currentSlide.id,
    });
  }, [avatarReady, currentSlide, hasAvatarRuntime, hasStarted, training]);

  useEffect(() => {
    if (!hasStarted) {
      return;
    }


    // stopCurrentPlayback();
    autoPlayedSlideRef.current = "";
    setIsPlaybackPaused(false);
    isPlaybackPausedRef.current = false;
    autoplaySuspendedSlideRef.current = "";
    resumeNarrationAfterAskRef.current = {
      active: false,
      slideId: null,
    };
    setIsAskListening(false);
    setIsAskMode(false);
    setQuestionError("");
    setLaunchStatus("");
    setShowQuestionPanel(false);
    browserRecognitionRef.current?.stop();
    browserRecognitionRef.current = null;
    clearPendingAskTranscriptCapture();
    pendingBrowserTranscriptRef.current = "";
    handledAskTranscriptRef.current = "";
  }, [currentSequenceItem?.id, hasStarted]);

  useEffect(() => {
    if (!autoplayEnabled) {
      clearAutoAdvanceTimer();
    }
  }, [autoplayEnabled]);

  useEffect(() => {
    if (!isPreparingLaunch || !hasStarted) {
      return;
    }

    const avatarReadyToShow = !hasAvatarRuntime || avatarReady;
    const micReadyToShow = micPermissionSettled;
    // "Settled" means proctoring reached a terminal state either way — live,
    // or a definitive error — not just "not yet live". Gating on isProctoringLive
    // alone (as this used to) meant a fast proctoring error (no camera on the
    // machine, a previously-blocked permission, connection refused, etc.) could
    // never satisfy the condition, so a separate effect had to force-clear
    // isPreparingLaunch on error — but it did so unconditionally, without
    // checking avatarReadyToShow/micReadyToShow, which is exactly what let the
    // "Preparing Training" screen disappear before the avatar had loaded and
    // before the mic/camera prompts had resolved. Folding the error case into
    // this single gate means every path waits on the same three conditions.
    const proctoringSettled = isProctoringLive || proctoringStatus === "error";

    if (!avatarReadyToShow || !micReadyToShow || !proctoringSettled) {
      return;
    }

    if (proctoringStatus === "error") {
      setIsPlaying(false);
      setSpeechActivity("idle");
      setAudioState("idle");
      setLaunchStatus(
        isVoiceTraining
          ? "Camera could not go live. Please allow access and restart training."
          : "Proctoring could not go live. Please check your camera/connection and restart training.",
      );
    } else {
      setLaunchStatus("");
    }

    setIsPreparingLaunch(false);
  }, [
    avatarReady,
    hasAvatarRuntime,
    hasStarted,
    isPreparingLaunch,
    isProctoringLive,
    isVoiceTraining,
    micPermissionSettled,
    proctoringStatus,
  ]);

  useEffect(() => {
    if (!isPreparingLaunch || !hasStarted) {
      return;
    }

    // Safety net: no matter what stalls (proctoring cold start, a socket
    // that never fires open/error/close, an avatar that never reports
    // ready, etc.), never leave the learner staring at "Preparing Training"
    // indefinitely.
    const timeoutId = window.setTimeout(() => {
      setIsPreparingLaunch((current) => {
        if (!current) {
          return current;
        }

        setLaunchStatus(
          "Training is taking longer than expected to start. You can continue, or refresh and try again.",
        );
        return false;
      });
    }, 45000);

    return () => window.clearTimeout(timeoutId);
  }, [hasStarted, isPreparingLaunch]);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | null = null;

    if (!training?.previewThumbnailAssetId || (training.previewThumbnailUrl && training.previewThumbnailUrl.trim())) {
      setResolvedPreviewThumbnailUrl("");
      return () => undefined;
    }

    void resolveSlideMediaAsset(training.previewThumbnailAssetId)
      .then((asset) => {
        if (!active) {
          asset?.revoke();
          return;
        }

        if (!asset?.url) {
          setResolvedPreviewThumbnailUrl("");
          return;
        }

        revoke = asset.revoke;
        setResolvedPreviewThumbnailUrl(asset.url);
      })
      .catch(() => {
        if (active) {
          setResolvedPreviewThumbnailUrl("");
        }
      });

    return () => {
      active = false;
      if (revoke) {
        revoke();
      }
    };
  }, [training?.previewThumbnailAssetId, training?.previewThumbnailUrl]);

  useEffect(() => {
    if (!hasStarted || !currentSequenceItem?.id) {
      return;
    }

    if (!viewedSlideIdsRef.current.includes(currentSequenceItem.id)) {
      viewedSlideIdsRef.current = [
        ...viewedSlideIdsRef.current,
        currentSequenceItem.id,
      ];
    }
  }, [currentSequenceItem, hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;
    if (!training) return;
    if (!currentSequenceItem || currentSequenceItem.kind !== "slide") return;
    if (!currentSlide) return;
    if (isAskListening || isQuestionLoading || showQuestionPanel) return;
    if (isPlaybackPaused) return;
    if (autoplaySuspendedSlideRef.current === currentSlide.id) return;
    if (audioPlaybackContextRef.current.type === "answer") return;
    if (avatarSpeechContextRef.current.type === "answer") return;
    if (hasAvatarRuntime && !avatarReady) return;
    if (hasAvatarRuntime && !isProctoringLive) return;

    // prevent same slide from auto-triggering twice
    if (autoPlayedSlideRef.current === currentSequenceItem.id) {
      return;
    }

    // Navigating away from a slide force-disables the avatar's speaker (see
    // stopSpeaking() in TrainingLaunchAvatar, called from stopCurrentPlayback
    // on every next/previous/auto-advance) so the previous utterance doesn't
    // bleed into the new slide. That's only meant to be a momentary silence:
    // it's supposed to get re-enabled by primeAudio() inside speakText() once
    // this slide's narration actually starts. But if this slide has no
    // narration script, or the avatar/proctoring connection hiccups (their own
    // reconnect logs show frequent socket timeouts) so speakText never fires,
    // that re-enable never happens and the avatar is left silently muted from
    // here on. Proactively re-arming the speaker for every new slide —
    // whether or not it ends up speaking — closes that gap.
    if (hasAvatarRuntime) {
      avatarRef.current?.primeAudio();
    }

    const playTimer = window.setTimeout(() => {
      void (async () => {
        const didStart = await playCurrentSlideNarration({ force: true });

        if (
          didStart ||
          currentSlideHasPlayableNarration ||
          !autoplayEnabledRef.current ||
          currentSlide.settings?.disableAutoAdvance ||
          isLastStep ||
          (currentSlideRequiresSubmit && !currentSlideSubmitted) ||
          autoplaySuspendedSlideRef.current === currentSlide.id ||
          isAskMode ||
          currentSequenceItem.id !==
          (launchSequence[currentSlideIndexRef.current]?.id ?? "")
        ) {
          return;
        }

        if (
          manualNavigationNarrationRecoveryStepRef.current ===
          currentSequenceItem.id
        ) {
          logAutoplay("Skipped auto-advance after manual navigation because narration did not start", {
            currentIndex: currentSlideIndexRef.current,
            currentId: currentSequenceItem.id,
          });
          return;
        }

        clearAutoAdvanceTimer();
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          if (!autoplayEnabledRef.current) {
            return;
          }

          navigateToSequenceIndex(currentSlideIndexRef.current + 1);
        }, Number(currentSlide.settings?.autoAdvanceDelayMs || 0));
      })();
    }, 100);

    return () => {
      window.clearTimeout(playTimer);
    };
  }, [
    currentSlideIndex,
    hasStarted,
    training,
    currentSequenceItem,
    currentSlide,
    currentSlideHasPlayableNarration,
    currentSlideRequiresSubmit,
    currentSlideSubmitted,
    isAskListening,
    isAskMode,
    isLastStep,
    isQuestionLoading,
    launchSequence,
    showQuestionPanel,
    isPlaybackPaused,
    hasAvatarRuntime,
    avatarReady,
    isProctoringLive,
    playCurrentSlideNarration,
  ]);

  // Knowledge Check guidance: when a question_set step is shown, the avatar
  // (or audio narrator) speaks a short instruction once. Uses the "answer"
  // speech type so it neither triggers slide auto-advance nor conflicts with
  // the slide auto-play effect above (both gate out type === "answer").
  useEffect(() => {
    if (!hasStarted || !training) return;
    if (!isQuestionSetStep || !currentQuestionSet || !currentSequenceItem) return;
    if (!isLaunchRuntimeReady) return;
    if (currentStepSubmitted) return;
    if (isAskMode || showQuestionPanel || isPlaybackPaused) return;
    if (questionGuidanceSpokenRef.current === currentSequenceItem.id) return;

    const stepId = currentSequenceItem.id;
    questionGuidanceSpokenRef.current = stepId;
    let guidanceFired = false;

    const isMandatory = currentQuestionSet.isMandatory !== false;
    const multiple = (currentQuestionSet.checkpoints?.length ?? 0) > 1;
    const guidanceText = isMandatory
      ? multiple
        ? "Please answer the questions before continuing. This knowledge check is mandatory."
        : "Please answer the question before continuing. This question is mandatory."
      : multiple
        ? "You may answer these questions, or continue without them if you wish."
        : "You may answer this question, or continue without it if you wish.";

    const guidanceTimer = window.setTimeout(() => {
      guidanceFired = true;
      if (hasAvatarRuntime && avatarReady) {
        void speakAvatarText(guidanceText, {
          type: "answer",
          slideId: currentSlide?.id ?? null,
          errorMessage: "Knowledge check guidance could not be spoken.",
        });
      } else {
        void playTrainingTextAudio(guidanceText, {
          type: "answer",
          slideId: currentSlide?.id ?? null,
          errorMessage: "Knowledge check guidance audio could not be generated.",
        });
      }
    }, 120);

    return () => {
      window.clearTimeout(guidanceTimer);
      // If the step changed before guidance actually played, roll back the
      // dedup marker so this (or the next) question step can speak when stable.
      if (!guidanceFired && questionGuidanceSpokenRef.current === stepId) {
        questionGuidanceSpokenRef.current = "";
      }
    };
  }, [
    avatarReady,
    currentQuestionSet,
    currentSequenceItem,
    currentSlide?.id,
    currentStepSubmitted,
    hasAvatarRuntime,
    hasStarted,
    isAskMode,
    isLaunchRuntimeReady,
    isPlaybackPaused,
    isQuestionSetStep,
    playTrainingTextAudio,
    showQuestionPanel,
    speakAvatarText,
    training,
  ]);

  const navigateToSequenceIndex = (
    index: number,
    options?: { logNavigation?: boolean },
  ) => {
    if (!launchSequence.length) {
      return;
    }

    const nextIndex = clampIndex(index, launchSequence.length);
    const nextSequenceItem = launchSequence[nextIndex] ?? null;

    if (options?.logNavigation) {
      const navigationAction =
        nextIndex > currentSlideIndexRef.current
          ? "next"
          : nextIndex < currentSlideIndexRef.current
            ? "previous"
            : null;

      if (navigationAction) {
        queueAvatarInteractionLog(navigationAction, {
          extra: {
            fromSlideIndex: currentSlideIndexRef.current,
            toSlideIndex: nextIndex,
          },
        });
      }
    }

    logAutoplay("Navigate to step", {
      fromIndex: currentSlideIndexRef.current,
      toIndex: nextIndex,
      triggeredBy: options?.logNavigation ? "manual" : "autoplay",
      nextKind: nextSequenceItem?.kind ?? null,
      nextId: nextSequenceItem?.id ?? null,
      nextTitle:
        nextSequenceItem?.kind === "slide"
          ? nextSequenceItem.slide.title
          : nextSequenceItem?.kind === "question_set"
            ? nextSequenceItem.questionSet.label
            : null,
    });

    if (
      options?.logNavigation &&
      (audioPlaybackContextRef.current.type === "slide" ||
        avatarSpeechContextRef.current.type === "slide")
    ) {
      armManualNavigationPlaybackGuard();
      manualNavigationNarrationRecoveryStepRef.current =
        nextSequenceItem?.kind === "slide" ? nextSequenceItem.id : "";
    } else if (!options?.logNavigation) {
      pendingManualNavigationPlaybackGuardRef.current = false;
      manualNavigationPlaybackGuardUntilRef.current = 0;
      manualNavigationNarrationRecoveryStepRef.current = "";
    }

    stopCurrentPlayback();
    autoPlayedSlideRef.current = "";
    resumeNarrationAfterAskRef.current = {
      active: false,
      slideId: null,
    };
    setIsPlaybackPaused(false);
    isPlaybackPausedRef.current = false;
    setIsAskListening(false);
    setIsAskMode(false);
    setQuestionError("");
    setLaunchStatus("");
    setShowQuestionPanel(false);
    browserRecognitionRef.current?.stop();
    browserRecognitionRef.current = null;
    clearPendingAskTranscriptCapture();
    pendingBrowserTranscriptRef.current = "";
    handledAskTranscriptRef.current = "";

    setCurrentSlideIndex(nextIndex);
  };

  const queueSlideAdvance = (delay: number) => {
    if (!launchSequence.length) {
      return;
    }

    const nextIndex = clampIndex(currentSlideIndexRef.current + 1, launchSequence.length);
    const nextSequenceItem = launchSequence[nextIndex] ?? null;

    logAutoplay("Queue next step", {
      currentIndex: currentSlideIndexRef.current,
      nextIndex,
      delay,
      nextKind: nextSequenceItem?.kind ?? null,
      nextId: nextSequenceItem?.id ?? null,
      nextTitle:
        nextSequenceItem?.kind === "slide"
          ? nextSequenceItem.slide.title
          : nextSequenceItem?.kind === "question_set"
            ? nextSequenceItem.questionSet.label
            : null,
    });

    clearAutoAdvanceTimer();
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      if (!autoplayEnabledRef.current) {
        logAutoplay("Skipped queued next step because autoplay is off", {
          currentIndex: currentSlideIndexRef.current,
        });
        return;
      }

      navigateToSequenceIndex(currentSlideIndexRef.current + 1);
    }, delay);
  };

  const getAutoplayBlockers = () => {
    const blockers: string[] = [];

    if (!training) blockers.push("training_missing");
    if (currentSequenceItem?.kind !== "slide") blockers.push("not_slide_step");
    if (!currentSlide) blockers.push("current_slide_missing");
    if (!autoplayEnabled) blockers.push("autoplay_disabled");
    if (currentSlide?.settings?.disableAutoAdvance) blockers.push("slide_auto_advance_disabled");
    if (isLastStep) blockers.push("last_step");
    if (currentSlideRequiresSubmit && !currentSlideSubmitted) blockers.push("submit_required");
    if (currentSlide && autoplaySuspendedSlideRef.current === currentSlide.id) blockers.push("autoplay_suspended_for_slide");
    if (isAskMode) blockers.push("ask_mode_active");
    if (isPlaybackPausedRef.current) blockers.push("playback_paused");

    return blockers;
  };

  const queueCurrentSlideAdvance = () => {
    const blockers = getAutoplayBlockers();

    if (blockers.length) {
      logAutoplay("Autoplay blocked", {
        currentIndex: currentSlideIndexRef.current,
        currentKind: currentSequenceItem?.kind ?? null,
        currentId: currentSequenceItem?.id ?? null,
        blockers,
      });
      return;
    }

    const delay = Number(currentSlide?.settings?.autoAdvanceDelayMs || 0);
    queueSlideAdvance(delay);
  };

  function scheduleAvatarAutoAdvanceWatchdog() {
    clearAvatarAutoAdvanceWatchdog("schedule_new_watchdog");

    if (
      !currentSlide ||
      currentSequenceItem?.kind !== "slide" ||
      avatarSpeechContextRef.current.type !== "slide" ||
      avatarSpeechContextRef.current.slideId !== currentSlide.id
    ) {
      return;
    }

    const scriptText = String(currentSlideScript || currentSlide.script || "");
    const wordCount = scriptText.trim().split(/\s+/).filter(Boolean).length;
    const characterCount = scriptText.length;
    const estimatedSpeechMs = Math.max(
      15000,
      Math.min(120000, Math.max(wordCount * 520, characterCount * 75)),
    );
    const delay = estimatedSpeechMs + Number(currentSlide.settings?.autoAdvanceDelayMs || 0);
    const watchedSlideId = currentSlide.id;
    const watchedSequenceId = currentSequenceItem.id;
    const watchdogScheduledAt = Date.now();

    avatarSpeechTimingRef.current = {
      slideId: watchedSlideId,
      startedAt:
        avatarSpeechTimingRef.current.slideId === watchedSlideId
          ? avatarSpeechTimingRef.current.startedAt
          : watchdogScheduledAt,
      wordCount,
      characterCount,
      watchdogDelayMs: delay,
    };

    logAutoplay("Avatar speech watchdog scheduled", {
      currentIndex: currentSlideIndexRef.current,
      slideId: watchedSlideId,
      wordCount,
      characterCount,
      delay,
      startedAt: avatarSpeechTimingRef.current.startedAt,
      watchdogScheduledAt,
      watchdogExpectedAt: watchdogScheduledAt + delay,
    });

    avatarAutoAdvanceWatchdogRef.current = window.setTimeout(() => {
      avatarAutoAdvanceWatchdogRef.current = null;

      const activeSequenceItem = launchSequence[currentSlideIndexRef.current] ?? null;
      if (
        !autoplayEnabledRef.current ||
        activeSequenceItem?.id !== watchedSequenceId ||
        avatarSpeechContextRef.current.type !== "slide" ||
        avatarSpeechContextRef.current.slideId !== watchedSlideId
      ) {
        logAutoplay("Avatar speech watchdog skipped", {
          currentIndex: currentSlideIndexRef.current,
          watchedSlideId,
          activeSequenceId: activeSequenceItem?.id ?? null,
          autoplayEnabled: autoplayEnabledRef.current,
          avatarSpeechContext: avatarSpeechContextRef.current,
          elapsedMs:
            avatarSpeechTimingRef.current.slideId === watchedSlideId &&
              avatarSpeechTimingRef.current.startedAt
              ? Date.now() - avatarSpeechTimingRef.current.startedAt
              : null,
        });
        return;
      }

      logAutoplay("Avatar speech watchdog advancing slide", {
        currentIndex: currentSlideIndexRef.current,
        slideId: watchedSlideId,
        elapsedMs:
          avatarSpeechTimingRef.current.slideId === watchedSlideId &&
            avatarSpeechTimingRef.current.startedAt
            ? Date.now() - avatarSpeechTimingRef.current.startedAt
            : null,
        watchdogDelayMs: avatarSpeechTimingRef.current.watchdogDelayMs || delay,
      });

      avatarSpeechContextRef.current = {
        type: null,
        slideId: null,
      };
      setIsPlaying(false);
      setSpeechActivity("idle");
      queueCurrentSlideAdvance();
    }, delay);
  }


  const syncLaunchSession = async (
    action: "start" | "progress" | "complete",
    overrides: Partial<{
      sessionId: string;
      slidesViewed: number;
      score: number | null;
      correctAnswers: number;
      totalQuestions: number;
      proctoringReport: TrainingProctoringReport | null;
      askHistory: QuestionHistoryItem[];
    }> = {},
  ) => {
    if (!training) {
      return null;
    }

    const sessionUrl = isDemoMode && demoSession
      ? `/demo/${demoSession.demoToken}/session`
      : `/launch/trainings/${training.id}/session`;
    const demoGuestFields = isDemoMode && demoSession
      ? { guestName: demoSession.guestName, guestEmail: demoSession.guestEmail }
      : {};

    const response = await postLaunchData<
      SessionResponse,
      Record<string, unknown>
    >(sessionUrl, {
      action,
      preview: effectivePreviewMode,
      sessionId: overrides.sessionId ?? sessionId,
      slidesViewed: overrides.slidesViewed ?? viewedSlideIdsRef.current.length,
      totalSlides: launchSequence.length,
      score: overrides.score ?? launchScoreSummary.score,
      correctAnswers:
        overrides.correctAnswers ?? launchScoreSummary.correctAnswers,
      totalQuestions:
        overrides.totalQuestions ?? launchScoreSummary.totalQuestions,
      askHistory: overrides.askHistory ?? questionHistoryRef.current,
      proctoringReport:
        overrides.proctoringReport ??
        (proctoringEnabled
          ? proctoringRef.current?.getSnapshot() ?? null
          : {
            status: "stopped",
            attentionScore: 100,
            riskScore: 0,
            attentionLabel: "Low Risk",
            eventCounts: { reading: 0, talking: 0, lookingAway: 0, tabSwitch: 0, noFace: 0, multipleFaces: 0, returnedToInterview: 0, anotherDevice: 0 },
            timeline: [],
            events: [],
          }),
      viewedSlideIds: viewedSlideIdsRef.current,
      timeSpentSeconds: sessionStartedAt
        ? getDurationSeconds(sessionStartedAt)
        : 0,
      startedAt: sessionStartedAt
        ? new Date(sessionStartedAt).toISOString()
        : undefined,
      ...demoGuestFields,
    });

    if (!response.data.status) {
      throw new Error(
        response.data.message || "Unable to update the training session.",
      );
    }

    if (response.data.data.sessionId) {
      setSessionId(response.data.data.sessionId);
    }

    // When embedded inside a SCORM wrapper (or any iframe host), notify the
    // parent on completion so it can report status/score to the LMS gradebook.
    if (action === "complete" && typeof window !== "undefined" && window.parent !== window) {
      try {
        window.parent.postMessage(
          {
            source: "trainup",
            type: "completed",
            status: "completed",
            score: overrides.score ?? launchScoreSummary.score ?? null,
            trainingId: training.id,
          },
          "*",
        );
      } catch {
        /* parent unreachable (cross-origin restrictions) — ignore */
      }
    }

    return response.data.data;
  };

  const ensureLaunchSession = useCallback(async () => {
    if (!training) {
      return "";
    }

    if (sessionId) {
      return sessionId;
    }

    if (sessionCreatePromiseRef.current) {
      const pendingSession = await sessionCreatePromiseRef.current;
      return pendingSession?.sessionId ?? "";
    }

    const nextSessionStartedAt = sessionStartedAt ?? Date.now();

    if (!sessionStartedAt) {
      setSessionStartedAt(nextSessionStartedAt);
    }

    sessionCreatePromiseRef.current = syncLaunchSession(hasStarted ? "progress" : "start", {
      slidesViewed: viewedSlideIdsRef.current.length,
      score: hasStarted ? launchScoreSummary.score : null,
    });

    const response = await sessionCreatePromiseRef.current.finally(() => {
      sessionCreatePromiseRef.current = null;
    });
    const nextSessionId = response?.sessionId ?? "";

    if (nextSessionId) {
      setSessionId(nextSessionId);
    }

    return nextSessionId;
  }, [
    hasStarted,
    launchScoreSummary.score,
    sessionId,
    sessionStartedAt,
    training,
  ]);

  useEffect(() => {
    if (!hasStarted || !training) {
      return;
    }

    if (!sessionId || sessionCreatePromiseRef.current) {
      return;
    }

    void syncLaunchSession("progress").catch(() => undefined);
  }, [currentSlideIndex, hasStarted, sessionId, training]);

  useEffect(() => {
    avatarRef.current?.setMuted(avatarMuted);

    if (audioRef.current) {
      audioRef.current.muted = avatarMuted;
    }
  }, [avatarMuted, avatarReady]);

  const goToSlide = (index: number) => {
    if (!launchSequence.length) {
      // debugLaunch("goToSlide blocked: no launchSequence");
      return;
    }

    navigateToSequenceIndex(index, { logNavigation: true });
  };

  const handleAudioPlay = () => {
    if (audioPlaybackContextRef.current.type === "slide") {
      activateManualNavigationPlaybackGuard();
      if (
        audioPlaybackContextRef.current.slideId &&
        manualNavigationNarrationRecoveryStepRef.current ===
        audioPlaybackContextRef.current.slideId
      ) {
        manualNavigationNarrationRecoveryStepRef.current = "";
      }
    }

    setIsPlaying(true);
    setAudioState("ready");
    setCurrentNarrationTransport("audio");
    setSpeechActivity("speaking");

    logAutoplay("Audio speech started", {
      currentIndex: currentSlideIndexRef.current,
      slideId: audioPlaybackContextRef.current.slideId,
      type: audioPlaybackContextRef.current.type,
    });

    if (
      !hasAvatarRuntime &&
      audioPlaybackContextRef.current.type === "slide" &&
      !(currentSlide?.settings?.waitForAudio ?? true)
    ) {
      queueCurrentSlideAdvance();
    }
  };

  const handleAudioPause = () => {
    const endedNaturally = Boolean(audioRef.current?.ended);
    const completedPlayback = audioPlaybackContextRef.current;

    if (
      endedNaturally &&
      shouldIgnoreManualNavigationCompletion(completedPlayback)
    ) {
      return;
    }

    // Let the queued auto-advance survive when playback pauses because the
    // slide audio reached its natural end.
    if (!endedNaturally) {
      clearAutoAdvanceTimer();
    }

    setIsPlaying(false);
    setAudioState((current) =>
      current === "error"
        ? "error"
        : audioPlaybackContextRef.current.type
          ? "ready"
          : "idle",
    );
    setSpeechActivity((current) =>
      isPlaybackPausedRef.current ? "paused" : current === "loading" ? "loading" : "idle",
    );
  };

  const handleAudioEnded = () => {
    const completedPlayback = audioPlaybackContextRef.current;

    if (shouldIgnoreManualNavigationCompletion(completedPlayback)) {
      return;
    }

    logAutoplay("Audio speech ended", {
      currentIndex: currentSlideIndexRef.current,
      slideId: completedPlayback.slideId,
      type: completedPlayback.type,
    });
    audioPlaybackContextRef.current = {
      type: null,
      slideId: null,
    };
    setIsPlaying(false);
    setAudioState("ready");
    setSpeechActivity("idle");

    if (completedPlayback.type === "answer") {
      // resumeCurrentSlideNarration();
      setLaunchStatus("");
      restartAskListening();
      return;
    }

    if (
      completedPlayback.type !== "slide" ||
      !currentSlide ||
      completedPlayback.slideId !== currentSlide.id ||
      !(currentSlide.settings?.waitForAudio ?? true)
    ) {
      return;
    }

    // logAutoplay("Slide audio ended", {
    //   currentIndex: currentSlideIndexRef.current,
    //   slideId: currentSlide.id,
    //   waitForAudio: currentSlide.settings?.waitForAudio ?? true,
    // });

    queueCurrentSlideAdvance();
  };

  const handleAudioLoadStart = () => {
    if (!audioPlaybackContextRef.current.type || isPlaybackPaused) {
      return;
    }

    setAudioState("loading");
    setSpeechActivity("loading");
  };

  const handleAudioWaiting = () => {
    if (!audioPlaybackContextRef.current.type || isPlaybackPaused) {
      return;
    }

    setAudioState("loading");
    setSpeechActivity("loading");
  };

  const handleAudioCanPlay = () => {
    setAudioState((current) => (current === "error" ? "error" : "ready"));
  };

  const handleAudioEmptied = () => {
    setIsPlaying(false);
    setAudioState("idle");
    setSpeechActivity((current) =>
      current === "listening" ? "listening" : isPlaybackPaused ? "paused" : "idle",
    );
  };

  const handleAudioError = () => {
    const element = audioRef.current;
    const mediaError = element?.error;
    const message =
      mediaError?.message ||
      (mediaError?.code ? `Audio playback failed (code ${mediaError.code}).` : "") ||
      "Audio playback failed.";

    setIsPlaying(false);
    setAudioState("error");
    setAudioMessage(message);
    setSpeechActivity("idle");
  };

  // When AI proctoring is enabled, camera + microphone access must be
  // confirmed *before* training is allowed to start — not requested best-effort
  // in the background while the learner is already inside the training (that
  // was the previous behaviour: startTraining() marked hasStarted true and
  // created the session immediately, and camera/mic were only sorted out
  // afterwards). Requesting both together means a missing camera, a missing
  // mic, or either being blocked fails this check as a whole, matching AI
  // proctoring's requirement that both be working before the training begins.
  const verifyProctoringStartPermissions = async (): Promise<{
    ok: boolean;
    message?: string;
  }> => {
    if (!proctoringEnabled) {
      return { ok: true };
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        message:
          "This browser does not support camera/microphone access, which AI proctoring requires to start this training.",
      };
    }

    // The Trulience avatar SDK independently tries to access the microphone
    // as part of its own connect/load sequence (visible in its console logs
    // as "Error unmute() microphone"), completely separate from anything this
    // probe requests. If that happens to land at the same moment as this
    // probe's own getUserMedia call, one of the two loses the race with
    // NotReadableError even though nothing is genuinely holding the device
    // long-term. Retry through a couple of these collisions with a short
    // backoff before treating it as a real "camera/mic unavailable" failure.
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let probeStream: MediaStream | null = null;

      try {
        probeStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        probeStream.getTracks().forEach((track) => track.stop());
        probeStream = null;
        // Give the OS/driver a brief moment to actually release the camera and
        // mic before the real, persistent acquisitions (proctoring's camera
        // feed) try to grab them again right after this. Re-acquiring the same
        // hardware within milliseconds of releasing it is a common source of
        // NotReadableError on some webcam/mic drivers, even though permission
        // was already granted and nothing else is actually using the device.
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        return { ok: true };
      } catch (error) {
        probeStream?.getTracks().forEach((track) => track.stop());

        const domErrorName = error instanceof DOMException ? error.name : "";

        if (domErrorName === "NotFoundError" || domErrorName === "DevicesNotFoundError") {
          return {
            ok: false,
            message:
              "No camera or microphone was found on this device. AI proctoring for this training requires both to start.",
          };
        }

        if (
          domErrorName === "NotAllowedError" ||
          domErrorName === "PermissionDeniedError" ||
          domErrorName === "SecurityError"
        ) {
          return {
            ok: false,
            message:
              "Camera and microphone access was blocked. Please allow access for this site and try starting the training again.",
          };
        }

        if (domErrorName === "NotReadableError" || domErrorName === "TrackStartError") {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => window.setTimeout(resolve, 700 * attempt));
            continue;
          }

          return {
            ok: false,
            message:
              "Your camera or microphone could not be accessed — they may be in use by another app. Close it and try again.",
          };
        }

        return {
          ok: false,
          message:
            "Camera and microphone access is required for this training's AI proctoring and could not be verified.",
        };
      }
    }

    return {
      ok: false,
      message:
        "Camera and microphone access is required for this training's AI proctoring and could not be verified.",
    };
  };

  const startTraining = async () => {
    setStartPermissionError("");

    if (proctoringEnabled) {
      setIsVerifyingStartPermissions(true);
      const permissionResult = await verifyProctoringStartPermissions();
      setIsVerifyingStartPermissions(false);

      if (!permissionResult.ok) {
        setStartPermissionError(
          permissionResult.message ||
          "Camera and microphone access is required to start this training.",
        );
        return;
      }
    }

    const firstSequenceItem = launchSequence[0] ?? null;

    stopCurrentPlayback();
    setIsPreparingLaunch(true);
    autoplaySuspendedSlideRef.current = "";
    setCurrentSlideIndex(0);
    setSubmittedSlides({});
    setSlideScores({});
    autoPlayedSlideRef.current = "";
    questionGuidanceSpokenRef.current = "";
    resumeNarrationAfterAskRef.current = {
      active: false,
      slideId: null,
    };
    setQuestionHistory([]);
    questionHistoryRef.current = [];
    setQuestionError("");
    setQuestionDraft("");
    setLaunchStatus("");
    setActiveLaunchHotspot(null);
    setIsAskListening(false);
    setIsAskMode(false);
    setShowQuestionPanel(false);
    browserRecognitionRef.current?.stop();
    browserRecognitionRef.current = null;
    clearPendingAskTranscriptCapture();
    pendingBrowserTranscriptRef.current = "";
    handledAskTranscriptRef.current = "";
    setIsPlaybackPaused(false);
    isPlaybackPausedRef.current = false;
    setAutoplayEnabled(true);
    setAvatarVisible(true);
    setCurrentNarrationTransport(hasAvatarRuntime ? "avatar_speech" : "audio");
    setSpeechActivity(hasAvatarRuntime ? "idle" : "loading");
    setHasStarted(true);
    setSessionStartedAt(Date.now());
    setProctoringStatus("connecting");
    setMicPermissionSettled(false);
    viewedSlideIdsRef.current = firstSequenceItem?.id
      ? [firstSequenceItem.id]
      : [];
    avatarRef.current?.primeAudio();
    if (proctoringEnabled) {
      // verifyProctoringStartPermissions() above already requested camera +
      // mic together and confirmed both work. Requesting the mic again here
      // — concurrently with proctoring's own camera acquisition just below —
      // was a second, near-simultaneous re-acquisition of the same
      // microphone right after releasing it from the pre-flight probe,
      // which is exactly the kind of back-to-back getUserMedia race that
      // throws NotReadableError even though permission was already granted.
      setMicPermissionSettled(true);
    } else {
      void primeMicrophonePermission();
    }
    void proctoringRef.current?.startSession();

    if (hasAvatarRuntime) {
      avatarRef.current?.pushTrainingContext({
        trainingId: training?.id,
        currentSlideId:
          firstSequenceItem?.kind === "slide"
            ? firstSequenceItem.slide.id
            : currentSlide?.id,
      });
      setLaunchStatus("Waiting for proctoring to go live.");
    } else {
      setLaunchStatus("");
      void playCurrentSlideNarration({ force: true });
    }

    try {
      sessionCreatePromiseRef.current = syncLaunchSession("start", {
        slidesViewed: firstSequenceItem?.kind === "slide" ? 1 : 0,
        score: null,
      });
      const data = await sessionCreatePromiseRef.current.finally(() => {
        sessionCreatePromiseRef.current = null;
      });
      if (data?.sessionId) {
        setSessionId(data.sessionId);
      }
    } catch (error) {
      setAudioMessage(
        error instanceof Error ? error.message : "Unable to start the session.",
      );
    }
  };

  // "Resume Training" from the reload choice screen: apply the restored
  // session fields and mark the training started. This intentionally does
  // NOT flip isPreparingLaunch/proctoringStatus itself — setting hasStarted
  // (with sessionId/sessionStartedAt already in place) is exactly what the
  // existing "resumed launch" bootstrap effect below watches for, and that
  // effect + the isPreparingLaunch-clearing effect already keep the loader up
  // until the avatar, proctoring, and mic are all actually ready before
  // revealing training content — so resuming gets the same "wait for the
  // avatar to fully load" guarantee as a fresh start.
  const handleResumeIncompleteTraining = () => {
    if (!pendingResumeSession) {
      return;
    }

    const resume = pendingResumeSession;
    setPendingResumeSession(null);

    setCurrentSlideIndex(resume.currentSlideIndex);
    viewedSlideIdsRef.current = resume.viewedSlideIds;
    setQuestionHistory(resume.questionHistory);
    questionHistoryRef.current = resume.questionHistory;
    setSessionId(resume.sessionId);
    setSessionStartedAt(resume.sessionStartedAt);
    // Unlike startTraining(), which calls this synchronously in the same
    // click handler, the resumed-launch bootstrap effect below only calls
    // primeAudio() later, from inside a useEffect — one render cycle removed
    // from this click. Calling it here too means "Resume Training" gets the
    // exact same direct, gesture-linked audio unlock as a fresh start,
    // rather than relying solely on the effect-triggered one.
    if (hasAvatarRuntime) {
      avatarRef.current?.primeAudio();
    }
    setHasStarted(true);
  };

  // "Restart Training" from the reload choice screen: discard the abandoned
  // session entirely and begin a completely fresh run via the normal
  // startTraining() flow (including its own camera/mic pre-flight check).
  const handleRestartIncompleteTraining = () => {
    setPendingResumeSession(null);

    if (training) {
      clearLaunchSessionSnapshot(training.id);
    }

    void startTraining();
  };

  const completeTraining = async () => {
    if (!training || isSubmittingTraining) {
      return;
    }

    stopCurrentPlayback();
    pendingCompletionReportRef.current =
      proctoringEnabled
        ? proctoringRef.current?.stopSession() ?? null
        : {
          status: "stopped",
          attentionScore: 100,
          riskScore: 0,
          attentionLabel: "Low Risk",
          eventCounts: { reading: 0, talking: 0, lookingAway: 0, tabSwitch: 0, noFace: 0, multipleFaces: 0, returnedToInterview: 0, anotherDevice: 0 },
          timeline: [],
          events: [],
        };
    setIsSubmittingTraining(true);

    try {
      await syncLaunchSession("complete", {
        slidesViewed: launchSequence.length,
        proctoringReport: pendingCompletionReportRef.current,
      });

      setHasStarted(false);
      setHasCompletedRun(true);
      setCurrentSlideIndex(0);
      setSubmittedSlides({});
      setSlideScores({});
      autoplaySuspendedSlideRef.current = "";
      autoPlayedSlideRef.current = "";
      resumeNarrationAfterAskRef.current = {
        active: false,
        slideId: null,
      };
      setQuestionDraft("");
      setQuestionError("");
      setIsAskListening(false);
      setIsAskMode(false);
      setIsPlaybackPaused(false);
      isPlaybackPausedRef.current = false;
      setShowQuestionPanel(false);
      browserRecognitionRef.current?.stop();
      browserRecognitionRef.current = null;
      clearPendingAskTranscriptCapture();
      pendingBrowserTranscriptRef.current = "";
      handledAskTranscriptRef.current = "";
      setLaunchStatus("");
      viewedSlideIdsRef.current = [];
      setProctoringStatus("idle");
      setIsPreparingLaunch(false);
      setSessionId("");
      setSessionStartedAt(null);
      pendingCompletionReportRef.current = null;
    } catch (error) {
      setAudioMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete this training session.",
      );
    } finally {
      setIsSubmittingTraining(false);
    }
  };

  const handleSlideSubmit = (result: TrainingSlideFormSubmitResult) => {
    if (!currentSequenceItem) {
      return;
    }

    logAutoplay("Step submitted", {
      currentIndex: currentSlideIndexRef.current,
      kind: currentSequenceItem.kind,
      id: currentSequenceItem.id,
      score: result.score,
      correctAnswers: result.correctAnswers,
      totalQuestions: result.totalQuestions,
      autoplayEnabled: autoplayEnabledRef.current,
    });

    setSubmittedSlides((current) => ({
      ...current,
      [currentSequenceItem.id]: true,
    }));
    setSlideScores((current) => ({
      ...current,
      [currentSequenceItem.id]: {
        correctAnswers: result.correctAnswers,
        totalQuestions: result.totalQuestions,
        score: result.score,
      },
    }));

    if (isLastStep) {
      setIsAdvancingAfterSubmit(false);
      return;
    }

    setIsAdvancingAfterSubmit(true);

    if (submitAdvanceTimerRef.current) {
      window.clearTimeout(submitAdvanceTimerRef.current);
    }

    submitAdvanceTimerRef.current = window.setTimeout(() => {
      submitAdvanceTimerRef.current = null;
      setIsAdvancingAfterSubmit(false);
      goToSlide(currentSlideIndex + 1);
    }, 900);
  };

  const submitLaunchQuestion = async (
    question: string,
    metadata: AskTranscriptMetadata = {},
  ) => {
    const trimmedQuestion = String(question || "").trim();

    if (!training || !trimmedQuestion) {
      return;
    }

    // Each call claims the next request id. If a barge-in starts a newer
    // question before this one's answer comes back, isStaleRequest() below
    // lets this older call quietly drop its result instead of speaking an
    // answer for a question the trainee already moved past.
    const requestId = (askRequestIdRef.current += 1);
    const isStaleRequest = () => askRequestIdRef.current !== requestId;

    setIsQuestionLoading(true);
    setQuestionError("");
    setLaunchStatus(`${assistantLabel} is preparing an answer.`);

    try {
      const activeSessionId = await ensureLaunchSession();

      const askUrl = isDemoMode && demoSession
        ? `/demo/${demoSession.demoToken}/ask`
        : `/launch/trainings/${training.id}/ask`;
      const askDemoFields = isDemoMode && demoSession
        ? { guestName: demoSession.guestName, guestEmail: demoSession.guestEmail }
        : {};

      const response = await postLaunchData<
        AskQuestionResponse,
        Record<string, unknown>
      >(askUrl, {
        message: trimmedQuestion,
        preview: effectivePreviewMode,
        sessionId: activeSessionId,
        history: getQuestionHistoryForApi(questionHistoryRef.current),
        inputMode: metadata.inputMode ?? "typed",
        sttProvider: metadata.sttProvider ?? null,
        language: metadata.language ?? selectedSpeechLocale,
        slideId: metadata.slideId ?? currentSlide?.id ?? null,
        ...askDemoFields,
      });

      if (isStaleRequest()) {
        return;
      }

      if (!response.data.status) {
        throw new Error(
          response.data.message || "Unable to answer the question.",
        );
      }

      const reply = response.data.data.reply;
      if (response.data.data.sessionId) {
        setSessionId(response.data.data.sessionId);
      }
      const historyEntry = {
        question: trimmedQuestion,
        answer: reply,
        askedAt: new Date().toISOString(),
        inputMode: metadata.inputMode ?? "typed",
        sttProvider: metadata.sttProvider ?? null,
        language: metadata.language ?? selectedSpeechLocale,
        slideId: metadata.slideId ?? currentSlide?.id ?? null,
      };
      const nextQuestionHistory = [...questionHistoryRef.current, historyEntry];
      questionHistoryRef.current = nextQuestionHistory;
      setQuestionHistory(nextQuestionHistory);
      setQuestionDraft("");
      setLaunchStatus(`${assistantLabel} answered your question.`);
      void syncLaunchSession("progress", {
        sessionId: activeSessionId,
        askHistory: nextQuestionHistory,
      }).catch(() => undefined);

      if (hasAvatarRuntime && avatarReady) {
        await speakAvatarText(reply, {
          type: "answer",
          slideId: resumeNarrationAfterAskRef.current.slideId,
          errorMessage: "Avatar answer failed",
        });
      } else {
        await playTrainingTextAudio(reply, {
          type: "answer",
          slideId: resumeNarrationAfterAskRef.current.slideId,
          errorMessage: "Audio answer failed",
        });
      }
    } catch (error) {
      if (isStaleRequest()) {
        return;
      }

      setQuestionError(
        error instanceof Error
          ? error.message
          : "Unable to answer the question.",
      );
      setLaunchStatus("");
      resumeCurrentSlideNarration();
    } finally {
      if (!isStaleRequest()) {
        setIsQuestionLoading(false);
      }
    }
  };

  const stopBrowserQuestion = useCallback(
    (options?: { keepQuestionPanel?: boolean }) => {
      clearPendingAskTranscriptCapture();
      isStoppingAskRecognitionRef.current = true;
      browserRecognitionRef.current?.stop();
      browserRecognitionRef.current = null;
      pendingBrowserTranscriptRef.current = "";
      handledAskTranscriptRef.current = "";
      setIsAskListening(false);
      setSpeechActivity((current) =>
        current === "paused" ? "paused" : "idle",
      );

      if (!options?.keepQuestionPanel) {
        setIsAskMode(false);
        setShowQuestionPanel(false);
      }
    },
    [],
  );

  const queueUnifiedTranscript = (
    text: string,
    metadata: AskTranscriptMetadata = {},
    delayMs?: number,
  ) => {
    const normalizedTranscript = normalizeTranscriptText(text);

    if (!normalizedTranscript) {
      return;
    }

    if (handledAskTranscriptRef.current === normalizedTranscript) {
      return;
    }

    const currentPending = pendingAskTranscriptRef.current?.text || "";
    const nextText = mergeTranscriptText(currentPending, normalizedTranscript);

    pendingAskTranscriptRef.current = {
      text: nextText,
      metadata,
    };
    setQuestionDraft(nextText);

    // While an answer is being generated or spoken, new speech is a
    // potential barge-in rather than the primary question — use a shorter
    // debounce so interrupting the avatar feels responsive instead of
    // waiting out the normal end-of-question pause.
    const isAnswering =
      isQuestionLoadingRef.current || avatarSpeechContextRef.current.type === "answer";

    setLaunchStatus(
      isAnswering
        ? "Listening — speak to interrupt."
        : "Listening for your question...",
    );
    setSpeechActivity("listening");

    if (askTranscriptDebounceTimerRef.current) {
      window.clearTimeout(askTranscriptDebounceTimerRef.current);
    }

    const resolvedDelayMs = delayMs ?? (isAnswering ? 900 : 1800);

    askTranscriptDebounceTimerRef.current = window.setTimeout(() => {
      askTranscriptDebounceTimerRef.current = null;
      const pending = pendingAskTranscriptRef.current;
      pendingAskTranscriptRef.current = null;

      if (!pending) {
        return;
      }

      handleUnifiedTranscript(pending.text, pending.metadata);
    }, resolvedDelayMs);
  };

  const handleAvatarTranscript = (transcript: string) => {
    const normalizedTranscript = String(transcript || "").trim();

    if (
      !normalizedTranscript ||
      handledAskTranscriptRef.current === normalizedTranscript
    ) {
      return;
    }
    const isAvatarActive = hasAvatarRuntime && avatarReady;
    queueUnifiedTranscript(normalizedTranscript, {
      inputMode: isAvatarActive ? "avatar" : "browser-voice",
      sttProvider: "trulience",
      language: selectedSpeechLocale,
      slideId: currentSlide?.id ?? null,
    });
  };

  const handleAvatarStatusChange = (status: TrainingLaunchAvatarStatus) => {
    const previousStatus = lastAvatarStatusRef.current;
    lastAvatarStatusRef.current = status.state;

    if (status.state !== "talking" && speakerHeartbeatIntervalRef.current) {
      window.clearInterval(speakerHeartbeatIntervalRef.current);
      speakerHeartbeatIntervalRef.current = null;
    }

    if (
      pendingAvatarInteractionLogRef.current &&
      previousStatus !== status.state
    ) {
      if (
        pendingAvatarInteractionLogRef.current === "pause" &&
        skipNextPauseStatusLogRef.current
      ) {
        skipNextPauseStatusLogRef.current = false;
        pendingAvatarInteractionLogRef.current = null;
      } else {
        // console.log("[TrainingLaunch] Avatar status change", {
        //   action: pendingAvatarInteractionLogRef.current,
        //   previousStatus,
        //   nextStatus: status.state,
        // });
        pendingAvatarInteractionLogRef.current = null;
      }
    }

    if (status.state === "listening") {
      // Trulience can report a "listening" status for reasons that have
      // nothing to do with the trainee wanting to ask a question — e.g. as
      // part of its own connection/lifecycle housekeeping right after the
      // avatar (re)connects, which happens on every page load and on every
      // reconnect (their SDK does this fairly often per its own logs).
      // Treating every occurrence as "enter Ask mode" used to flip the whole
      // app into Ask mode immediately on page refresh, and could also fire
      // right after leaving Ask mode and silence slide narration the moment
      // it tried to resume. Only actually react to this if we're already in
      // Ask mode (entered deliberately via the "Ask Question" button) —
      // otherwise ignore it entirely.
      if (!isAskModeRef.current) {
        return;
      }

      if (avatarSpeechContextRef.current.type === "slide") {
        stopCurrentPlayback();
      }
      setIsAskListening(true);
      setSpeechActivity("listening");
      setLaunchStatus("Listening for your question.");
      return;
    }

    if (status.state === "thinking") {
      setIsAskListening(false);
      setSpeechActivity("loading");
      setLaunchStatus(`${assistantLabel} is preparing an answer.`);
      return;
    }

    if (status.state === "loading") {
      setSpeechActivity("loading");
      return;
    }

    if (status.state !== "idle" && status.state !== "unknown") {
      isStoppingAvatarRef.current = false;
    }

    if (status.state === "talking") {
      if (avatarSpeechContextRef.current.type === "slide") {
        activateManualNavigationPlaybackGuard();
        avatarTalkingSlideIdRef.current = avatarSpeechContextRef.current.slideId;
        if (
          avatarSpeechContextRef.current.slideId &&
          manualNavigationNarrationRecoveryStepRef.current ===
          avatarSpeechContextRef.current.slideId
        ) {
          manualNavigationNarrationRecoveryStepRef.current = "";
        }
      }

      setIsPlaying(true);
      setSpeechActivity("speaking");
      if (!speakerHeartbeatIntervalRef.current) {
        speakerHeartbeatIntervalRef.current = window.setInterval(() => {
          avatarRef.current?.primeAudio();
        }, 400);
      }
      // logAutoplay("Avatar speech started", {
      //   currentIndex: currentSlideIndexRef.current,
      //   slideId: avatarSpeechContextRef.current.slideId,
      //   type: avatarSpeechContextRef.current.type,
      // });
      if (
        avatarSpeechContextRef.current.type === "slide" &&
        !avatarAutoAdvanceWatchdogRef.current
      ) {
        scheduleAvatarAutoAdvanceWatchdog();
      }
      return;
    }

    if (status.state === "idle" && isAskListening) {
      setIsAskListening(false);
    }

    if (status.state === "idle" && previousStatus === "talking") {
      const reportedTalkingSlideId = avatarTalkingSlideIdRef.current;
      avatarTalkingSlideIdRef.current = null;
      const completedSpeech = avatarSpeechContextRef.current;

      if (shouldIgnoreManualNavigationCompletion(completedSpeech)) {
        return;
      }

      if (isStoppingAvatarRef.current) {
        isStoppingAvatarRef.current = false;
        clearAvatarAutoAdvanceWatchdog("manual_stop_idle");
        avatarSpeechContextRef.current = { type: null, slideId: null };
        setIsPlaying(false);
        setSpeechActivity(isPlaybackPausedRef.current ? "paused" : "idle");
        return;
      }

      if (reportedTalkingSlideId && currentSlide?.id !== reportedTalkingSlideId) {
        return;
      }

      clearAvatarAutoAdvanceWatchdog("avatar_status_idle");
      // logAutoplay("Avatar speech ended", {
      //   currentIndex: currentSlideIndexRef.current,
      //   slideId: completedSpeech.slideId,
      //   type: completedSpeech.type,
      //   elapsedMs,
      // });
      avatarSpeechContextRef.current = {
        type: null,
        slideId: null,
      };
      setIsPlaying(false);
      setSpeechActivity(isPlaybackPausedRef.current ? "paused" : "idle");
      const activeSequenceItem = launchSequence[currentSlideIndexRef.current] ?? null;
      const matchesActiveSlide =
        completedSpeech.type === "slide" &&
        activeSequenceItem?.kind === "slide" &&
        completedSpeech.slideId === activeSequenceItem.id;

      if (completedSpeech.type === "answer") {
        // resumeCurrentSlideNarration();
        setLaunchStatus("");
        restartAskListening();
        return;
      }

      if (
        matchesActiveSlide &&
        autoplayEnabled &&
        !isPlaybackPausedRef.current
      ) {
        // logAutoplay("Avatar slide speech ended", {
        //   currentIndex: currentSlideIndexRef.current,
        //   slideId: completedSpeech.slideId,
        //   elapsedMs,
        // });
        queueCurrentSlideAdvance();
        return;
      }

      // if (completedSpeech.type === "slide") {
      //   logAutoplay("Avatar slide speech ignored", {
      //     currentIndex: currentSlideIndexRef.current,
      //     completedSlideId: completedSpeech.slideId,
      //     activeSequenceKind: activeSequenceItem?.kind ?? null,
      //     activeSequenceId: activeSequenceItem?.id ?? null,
      //     currentSlideId: currentSlide?.id ?? null,
      //     autoplayEnabled,
      //     isPlaybackPaused,
      //     elapsedMs,
      //   });
      // }
    }
  };

  const submitLaunchLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const email = launchLoginEmail.trim().toLowerCase();
    const password = launchLoginPassword.trim();

    if (!email || !password) {
      setLaunchLoginError("Email and password are required.");
      return;
    }

    setIsLaunchLoginLoading(true);
    setLaunchLoginError("");

    try {
      const response = isServerApiEnabled
        ? await axios.post<ApiEnvelope<LaunchLoginResponse>>(
          getRequestUrl("/auth/login"),
          { email, password },
          { validateStatus: () => true },
        )
        : ((await mockRequest("POST", "/auth/login", { email, password })) as {
          data: ApiEnvelope<LaunchLoginResponse>;
        });

      if (!response.data.status) {
        throw new Error(
          response.data.message || "Unable to sign in for this training.",
        );
      }

      setLaunchAuthToken(response.data.data.token);
      setLaunchAuthTokenState(response.data.data.token);
      setLearnerProfile({
        name: response.data.data.user.fullname || response.data.data.user.name || "Learner",
        email: response.data.data.user.email || email,
        role: response.data.data.user.role || "trainee",
        trainingsCount: 1,
        sessionsCount: 0,
      });
      setRequiresLaunchLogin(false);
      setLaunchLoginPassword("");
      setLaunchReloadKey((current) => current + 1);
    } catch (error) {
      setLaunchLoginError(getLaunchAuthError(error));
    } finally {
      setIsLaunchLoginLoading(false);
    }
  };

  const submitGoogleLaunchLogin = useCallback(
    async (credential: string) => {
      if (!credential) {
        setGoogleLoginError("Google did not return a login credential.");
        return;
      }

      setIsGoogleLoginLoading(true);
      setGoogleLoginError("");
      setLaunchLoginError("");

      try {
        const response = isServerApiEnabled
          ? await axios.post<ApiEnvelope<LaunchLoginResponse>>(
            getRequestUrl("/auth/google"),
            { credential, trainingId },
            { validateStatus: () => true },
          )
          : ((await mockRequest("POST", "/auth/google", {
            credential,
            trainingId,
          })) as { data: ApiEnvelope<LaunchLoginResponse> });

        if (!response.data.status) {
          throw new Error(
            response.data.message || "Google sign-in could not be completed.",
          );
        }

        setLaunchAuthToken(response.data.data.token);
        setLaunchAuthTokenState(response.data.data.token);
        setLearnerProfile({
          name: response.data.data.user.fullname || response.data.data.user.name || "Learner",
          email: response.data.data.user.email || "trainee@samsung.com",
          role: response.data.data.user.role || "trainee",
          trainingsCount: 1,
          sessionsCount: 0,
        });
        setRequiresLaunchLogin(false);
        setLaunchReloadKey((current) => current + 1);
      } catch (error) {
        setGoogleLoginError(getLaunchAuthError(error));
      } finally {
        setIsGoogleLoginLoading(false);
      }
    },
    [trainingId],
  );

  const stopAskMode = () => {
    if (askConnectTimerRef.current) {
      window.clearTimeout(askConnectTimerRef.current);
      askConnectTimerRef.current = null;
    }

    setIsAskConnecting(false);
    avatarRef.current?.stopListening();
    stopBrowserQuestion({ keepQuestionPanel: false });

    setIsAskListening(false);
    setIsAskMode(false);
    setSpeechActivity(isPlaybackPaused ? "paused" : "idle");
    setLaunchStatus("");
    setQuestionError("");
    setShowQuestionPanel(false);
    handledAskTranscriptRef.current = "";
    pendingBrowserTranscriptRef.current = "";
    clearPendingAskTranscriptCapture();

    // "Go Back" is a direct click, so it's a genuine user gesture — the best
    // chance to re-unlock audio output if entering Ask mode (which activates
    // the mic) left the avatar's audio suspended/ducked. Do this
    // unconditionally rather than relying on resumeCurrentSlideNarration()
    // below, which can bail out early (e.g. no narration to resume) without
    // ever getting a chance to re-prime audio.
    if (hasAvatarRuntime) {
      avatarRef.current?.primeAudio();
    }

    resumeCurrentSlideNarration();
  };

  const openInteractiveHotspot = (hotspot: TrainingInteractiveHotspot) => {
    if (hotspot.kind === "link") {
      window.open(hotspot.url, "_blank", "noopener,noreferrer");
      return;
    }

    const presentation = resolveHotspotPresentation(hotspot);

    if (presentation.mode === "external") {
      window.open(presentation.openUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setActiveLaunchHotspot({
      hotspot,
      presentation,
    });
  };

  const restartAskListening = useCallback(() => {
    if (!isAskModeRef.current) {
      return;
    }

    setIsAskConnecting(false);
    handledAskTranscriptRef.current = "";
    pendingBrowserTranscriptRef.current = "";
    clearPendingAskTranscriptCapture();
    setQuestionError("");
    setLaunchStatus("Listening for your question...");
    setIsAskListening(true);
    setSpeechActivity("listening");

    // Tavus's mic is left on its own native pipeline (see below) so Ask mode
    // stays fast and natural — its per-conversation conversational_context
    // (set at session creation from this training's Ask Assistant Prompt +
    // knowledge base) grounds its answers instead of routing through our own
    // /ask endpoint.
    if (hasAvatarRuntime) {
      avatarRef.current?.startListening();
    } else {
      fallbackToBrowserListening();
    }
  }, [hasAvatarRuntime]);

  const toggleAutoplay = () => {
    setAutoplayEnabled((current) => {
      const next = !current;
      queueAvatarInteractionLog(next ? "autoplay_on" : "autoplay_off", {
        extra: {
          autoplayEnabledBeforeClick: current,
          autoplayEnabledAfterClick: next,
        },
      });

      if (!next) {
        clearAutoAdvanceTimer();
        return next;
      }

      if (
        !hasAvatarRuntime &&
        audioPlaybackContextRef.current.type === "slide" &&
        !isPlaybackPaused &&
        !(currentSlide?.settings?.waitForAudio ?? true)
      ) {
        queueCurrentSlideAdvance();
      }

      return next;
    });
  };

  const togglePlayback = () => {
    if (!hasAvatarRuntime && !audioRef.current) {
      return;
    }

    if (areLaunchControlsLocked) {
      return;
    }

    if (!isPlaybackPaused && isSlidePlaybackActive) {
      queueAvatarInteractionLog("pause", { immediate: false });
      // console.log("[TrainingLaunch] Avatar status change", {
      //   action: "pause",
      //   previousStatus: "talking",
      //   nextStatus: "idle",
      // });

      skipNextPauseStatusLogRef.current = true;
      setIsPlaybackPaused(true);
      isPlaybackPausedRef.current = true;
      clearAutoAdvanceTimer();

      if (hasAvatarRuntime) {
        avatarRef.current?.speakText({
          text: ". say ok .",
          trainingId: training?.id,
          currentSlideId: currentSlide?.id,
        });
        handleAvatarStatusChange({
          raw: 0,
          code: 0,
          state: "idle",
        });
      } else {
        audioRef.current?.pause();
        setAudioState("ready");
        setSpeechActivity("paused");
      }
      return;
    }

    queueAvatarInteractionLog("play", { immediate: false });
    setIsPlaybackPaused(false);
    isPlaybackPausedRef.current = false;
    setSpeechActivity("loading");

    if (
      !hasAvatarRuntime &&
      audioRef.current?.src &&
      audioPlaybackContextRef.current.type === "slide"
    ) {
      void audioRef.current.play();
      return;
    }

    autoPlayedSlideRef.current = "";
    setLaunchStatus("");
    void playCurrentSlideNarration({ force: true });
  };

  const isAssistantPromptTranscript = (value: string) => {
    const normalized = value.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return [
      "how can i help you",
      "what can i help you",
      "how can help you",
      "what can help you",
    ].some((phrase) => normalized === phrase || normalized.includes(phrase));
  };

  const handleUnifiedTranscript = (
    text: string,
    metadata: AskTranscriptMetadata = {},
  ) => {
    const question = String(text || "").trim();

    if (askTranscriptDebounceTimerRef.current) {
      window.clearTimeout(askTranscriptDebounceTimerRef.current);
      askTranscriptDebounceTimerRef.current = null;
    }
    pendingAskTranscriptRef.current = null;

    if (!question) {
      setIsAskListening(false);
      setLaunchStatus("");
      setSpeechActivity("idle");
      return;
    }

    if (isAssistantPromptTranscript(question)) {
      handledAskTranscriptRef.current = "";
      pendingBrowserTranscriptRef.current = "";
      pendingAskTranscriptRef.current = null;
      setQuestionDraft("");
      setLaunchStatus("Listening for your question...");
      return;
    }

    if (metadata.sttProvider === "browser" && isLikelyIncompleteAskTranscript(question)) {
      handledAskTranscriptRef.current = "";
      pendingBrowserTranscriptRef.current = "";
      pendingAskTranscriptRef.current = null;
      setQuestionDraft("");
      setLaunchStatus("Listening for your full question...");
      setSpeechActivity("listening");
      return;
    }

    if (handledAskTranscriptRef.current === question) {
      return;
    }

    // If this new question arrives while the previous one is still being
    // answered (generating a reply, or the avatar is speaking it), treat it
    // as a barge-in: cut the current answer off and move straight to this
    // one instead of waiting for the old answer to finish and only then
    // requiring a manual restart.
    const isBargeIn =
      isQuestionLoadingRef.current || avatarSpeechContextRef.current.type === "answer";

    handledAskTranscriptRef.current = question;
    pendingBrowserTranscriptRef.current = "";
    pendingAskTranscriptRef.current = null;
    setQuestionError("");
    setQuestionDraft(question);

    if (isBargeIn) {
      stopCurrentPlayback();
    } else {
      // Not interrupting anything, so there's no need to keep listening while
      // the answer is prepared — restartAskListening()/the barge-in path
      // above are what re-arm the mic afterward. The recognition instance
      // itself is left running either way; it's created once per Ask session
      // and kept alive so the trainee never has to press "Start Listening"
      // again mid-conversation.
      setIsAskListening(false);
    }

    setLaunchStatus(`${assistantLabel} is preparing an answer.`);
    setSpeechActivity("idle");

    void submitLaunchQuestion(question, {
      inputMode: metadata.inputMode ?? "browser-voice",
      sttProvider: metadata.sttProvider ?? "browser",
      language: metadata.language ?? selectedSpeechLocale,
      slideId: metadata.slideId ?? currentSlide?.id ?? null,
    });
  };

  const fallbackToBrowserListening = (options?: { silent?: boolean }) => {
    // Idempotent: Ask mode now keeps a single recognition instance alive for
    // the whole session (started once, restarted only if it actually ends)
    // instead of tearing it down and recreating it around every question, so
    // a barge-in during the avatar's answer can be picked up without the
    // trainee needing to press "Start Listening" again.
    if (browserRecognitionRef.current) {
      if (!options?.silent) {
        setIsAskListening(true);
      }
      return true;
    }

    const SpeechRecognitionCtor = resolveSpeechRecognitionCtor();

    if (!SpeechRecognitionCtor) {
      if (!options?.silent) {
        setQuestionError("Speech recognition not supported.");
        setIsAskListening(false);
      }
      return false;
    }

    const recognition = new SpeechRecognitionCtor();
    browserRecognitionRef.current = recognition;
    isStoppingAskRecognitionRef.current = false;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedSpeechLocale;

    recognition.onresult = (event) => {
      const resultIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;
      const transcript = Array.from(event.results)
        .slice(resultIndex)
        .map((result) => result[0]?.transcript || "")
        .filter(Boolean)
        .join(" ");

      pendingBrowserTranscriptRef.current = mergeTranscriptText(
        pendingBrowserTranscriptRef.current,
        transcript,
      );
      queueUnifiedTranscript(transcript, {
        inputMode: "browser-voice",
        sttProvider: "browser",
        language: selectedSpeechLocale,
        slideId: currentSlide?.id ?? null,
      });
    };

    recognition.onerror = (event) => {
      const errorName = event?.error;

      // "no-speech"/"aborted" fire routinely during ordinary pauses with
      // continuous recognition — they aren't real failures. Let onend (which
      // follows) handle restarting instead of surfacing them as errors.
      if (errorName === "no-speech" || errorName === "aborted") {
        return;
      }

      if (!options?.silent) {
        setQuestionError("Could not capture voice.");
        setIsAskListening(false);
        setLaunchStatus("");
      }
    };

    recognition.onend = () => {
      browserRecognitionRef.current = null;

      if (isStoppingAskRecognitionRef.current) {
        isStoppingAskRecognitionRef.current = false;
        if (!options?.silent) {
          setIsAskListening(false);
        }
        return;
      }

      // Browser speech recognition can end on its own (silence timeout, etc.)
      // even with continuous=true. Previously this just switched off
      // isAskListening and left the mic off until the trainee manually
      // clicked "Start Listening" again. Auto-restart it so the conversation
      // stays hands-free for as long as we're still meant to be listening.
      if (!options?.silent && isAskModeRef.current) {
        // A short delay before restarting avoids immediately calling start()
        // while the browser's speech-recognition service is still tearing
        // down the previous session — doing that back-to-back can throw
        // synchronously (see the try/catch around start() below), and this
        // reduces how often that race gets hit in the first place.
        window.setTimeout(() => {
          fallbackToBrowserListening();
        }, 250);
        return;
      }

      if (!options?.silent) {
        setIsAskListening(false);
      }
    };

    try {
      recognition.start();
    } catch {
      // Starting immediately after a previous session just ended can throw
      // (InvalidStateError) if the browser's speech-recognition service
      // hasn't fully released yet. Without this, the failed instance stayed
      // in browserRecognitionRef.current, and the idempotent check at the
      // top of this function treated that dead reference as "already
      // listening" forever — the UI kept showing "Listening..." while
      // nothing was actually capturing audio, permanently, from that point
      // on. Drop the dead instance and retry shortly instead.
      if (browserRecognitionRef.current === recognition) {
        browserRecognitionRef.current = null;
      }

      if (!options?.silent && isAskModeRef.current) {
        window.setTimeout(() => {
          fallbackToBrowserListening();
        }, 300);
      } else if (!options?.silent) {
        setIsAskListening(false);
      }

      return false;
    }

    return true;
  };

  const startUnifiedAskMode = () => {
    if (askConnectTimerRef.current) {
      window.clearTimeout(askConnectTimerRef.current);
      askConnectTimerRef.current = null;
    }

    queueAvatarInteractionLog("ask", {
      extra: {
        currentSlideId: currentSlide?.id || null,
      },
    });
    stopCurrentPlayback();

    // Clicking "Ask Question" is a genuine user gesture — re-prime audio
    // right here (in addition to the priming already inside speakText()
    // below) so entering Ask mode gets the same fresh unlock opportunity as
    // any other click, rather than relying solely on whatever happens a
    // moment later inside the greeting's speakText call.
    if (hasAvatarRuntime) {
      avatarRef.current?.primeAudio();
    }

    autoplaySuspendedSlideRef.current = currentSlide?.id || "";

    resumeNarrationAfterAskRef.current = {
      active: Boolean(
        hasStarted &&
        currentSequenceItem?.kind === "slide" &&
        currentSlideScript,
      ),
      slideId:
        currentSequenceItem?.kind === "slide" ? currentSlide?.id || null : null,
    };

    setIsAskConnecting(true);
    if (!isAskMode) {
      if (hasAvatarRuntime && avatarReady) {
        avatarRef.current?.speakText({
          text: isTavusAvatarProvider ? "How can i help you?" : "repeat exact text: How can i help you?",
          trainingId: training?.id,
          currentSlideId: currentSlide?.id,
        });
        handleAvatarStatusChange({
          raw: 0,
          code: 0,
          state: "idle",
        });
      }
    }
    setIsAskMode(true);
    setIsAskListening(false);
    setQuestionError("");
    setLaunchStatus("Connecting...");
    setSpeechActivity("loading");

    // 🔥 MODE BASED LISTENING
    const connectDelay = !isAskMode ? 1800 : 1200;
    askConnectTimerRef.current = window.setTimeout(() => {
      askConnectTimerRef.current = null;
      setIsAskConnecting(false);
      setIsAskListening(true);
      setQuestionError("");
      setLaunchStatus("Listening for your question...");
      setSpeechActivity("listening");

      if (hasAvatarRuntime) {
        avatarRef.current?.startListening();
      } else {
        fallbackToBrowserListening();
      }

    }, connectDelay);
  };

  const launchTheme = useMemo(() => {
    if (!training) {
      return {} as CSSProperties;
    }

    const primaryBackground =
      training.theme?.primaryFillMode === "gradient"
        ? `linear-gradient(${training.theme?.primaryGradientDirection || "to right"}, ${training.theme?.primaryGradientFrom || training.theme?.primaryBg || "#1428a0"}, ${training.theme?.primaryGradientTo || training.theme?.primaryBgHover || "#1f49d8"})`
        : training.theme?.primaryBg || "#1428a0";
    const primaryHoverBackground =
      training.theme?.primaryFillMode === "gradient"
        ? `linear-gradient(${training.theme?.primaryGradientDirection || "to right"}, ${training.theme?.primaryBgHover || training.theme?.primaryGradientFrom || "#10217f"}, ${training.theme?.primaryGradientTo || "#1f49d8"})`
        : training.theme?.primaryBgHover || training.theme?.primaryBg || "#10217f";

    return {
      "--launch-primary": primaryBackground,
      "--launch-primary-hover": primaryHoverBackground,
      "--launch-primary-text": training.theme?.primaryText || "#ffffff",
      "--launch-primary-border":
        training.theme?.primaryBorder || training.theme?.primaryBg || "#1428a0",
      "--launch-secondary": training.theme?.secondaryBg || "#e8edf8",
      "--launch-secondary-text": training.theme?.secondaryText || "#10217f",
      "--launch-secondary-border": training.theme?.secondaryBorder || "#c6d2f5",
      "--launch-secondary-hover": training.theme?.secondaryBgHover || training.theme?.secondaryBg || "#e8edf8",
      "--launch-secondary-border-hover": training.theme?.secondaryBorderHover || training.theme?.secondaryBorder || "#c6d2f5",
      "--launch-secondary-text-hover": training.theme?.secondaryTextHover || training.theme?.secondaryText || "#10217f",
      "--launch-surface": training.theme?.bgColor || "#07111f",
      "--launch-avatar-bg":
        training.theme?.avatarBoxBg || "rgba(255,255,255,0.08)",
      "--launch-button-radius": resolveLaunchButtonRadius(training.theme?.buttonRadius),
      "--launch-button-font-family": resolveLaunchButtonFontFamily(training.theme?.buttonFontFamily),
      "--launch-button-font-weight": training.theme?.buttonFontWeight || "500",
      "--launch-button-font-size": resolveLaunchButtonFontSize(training.theme?.buttonFontSize),
    } as CSSProperties;
  }, [training]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const resolvedDocumentBranding = training?.branding || publicLaunchBranding;

    if (!resolvedDocumentBranding) {
      return;
    }

    const title =
      resolvedDocumentBranding.application_name ||
      resolvedDocumentBranding.applicationName ||
      resolvedDocumentBranding.companyName ||
      "Training Launch";
    const previousTitle = document.title;
    document.title = title;

    const faviconHref =
      resolvedDocumentBranding.favicon ||
      resolvedDocumentBranding.faviconUrl ||
      resolvedDocumentBranding.logo ||
      resolvedDocumentBranding.logoUrl ||
      "";
    let previousFaviconHref = "";
    const faviconElement =
      (document.querySelector("link[rel='icon']") as HTMLLinkElement | null) ||
      (document.querySelector("link[rel='shortcut icon']") as HTMLLinkElement | null);

    if (faviconElement) {
      previousFaviconHref = faviconElement.href;
      if (faviconHref) {
        faviconElement.href = faviconHref;
      }
    }

    return () => {
      document.title = previousTitle;
      if (faviconElement && previousFaviconHref) {
        faviconElement.href = previousFaviconHref;
      }
    };
  }, [publicLaunchBranding, training]);

  useEffect(() => {
    if (!isPreparingLaunch) {
      setLoadingMessageIndex(0);
      setTypedLoadingMessage("");
      return;
    }

    setLoadingMessageIndex(0);
    setTypedLoadingMessage("");
    return undefined;
  }, [isPreparingLaunch, loadingGuidanceMessages]);

  useEffect(() => {
    if (!isPreparingLaunch || !loadingGuidanceMessages.length) {
      setTypedLoadingMessage("");
      return;
    }

    const message = activeLoadingGuidanceMessage;
    const charDelayMs = 35;
    const holdDelayMs = 3000;
    let charIndex = 0;

    setTypedLoadingMessage("");

    const typingIntervalId = window.setInterval(() => {
      charIndex += 1;
      setTypedLoadingMessage(message.slice(0, charIndex));

      if (charIndex >= message.length) {
        window.clearInterval(typingIntervalId);
        const nextMessageTimeoutId = window.setTimeout(() => {
          setLoadingMessageIndex((current) => (current + 1) % loadingGuidanceMessages.length);
        }, holdDelayMs);

        cleanupTimeoutId = nextMessageTimeoutId;
      }
    }, charDelayMs);

    let cleanupTimeoutId: number | null = null;

    return () => {
      window.clearInterval(typingIntervalId);
      if (cleanupTimeoutId !== null) {
        window.clearTimeout(cleanupTimeoutId);
      }
    };
  }, [activeLoadingGuidanceMessage, isPreparingLaunch, loadingGuidanceMessages.length]);

  useEffect(() => {
    setLaunchHeaderLogoFailed(false);
  }, [
    appSettings.logo,
    appSettings.favicon,
    training?.branding?.logo,
    training?.branding?.logoUrl,
    training?.branding?.dark_logo,
    training?.branding?.darkLogoUrl,
    publicLaunchBranding?.logo,
    publicLaunchBranding?.logoUrl,
    publicLaunchBranding?.dark_logo,
    publicLaunchBranding?.darkLogoUrl,
    publicLaunchBranding?.favicon,
    publicLaunchBranding?.faviconUrl,
  ]);

  if (isLoading) {
    return <Loader />;
  }

  if (requiresLaunchLogin && !effectivePreviewMode) {
    const resolvedLaunchBranding = training?.branding || publicLaunchBranding;
    const launchBrandName =
      resolvedLaunchBranding?.application_name ||
      resolvedLaunchBranding?.applicationName ||
      resolvedLaunchBranding?.companyName ||
      appSettings.application_name ||
      "Trainup";
    const clientLaunchLogo =
      resolvedLaunchBranding?.logo ||
      resolvedLaunchBranding?.logoUrl ||
      resolvedLaunchBranding?.favicon ||
      resolvedLaunchBranding?.faviconUrl ||
      resolvedLaunchBranding?.dark_logo ||
      resolvedLaunchBranding?.darkLogoUrl ||
      appSettings.logo ||
      appSettings.favicon ||
      "";
    const launchBrandLogo = launchHeaderLogoFailed
      ? DefaultBrandLogo
      : clientLaunchLogo || DefaultBrandLogo;
    const launchFooterAppName =
      resolvedLaunchBranding?.application_name ||
      resolvedLaunchBranding?.applicationName ||
      resolvedLaunchBranding?.companyName ||
      appSettings.application_name ||
      "Trainup";
    const launchCopyright =
      String(
        resolvedLaunchBranding?.copyright ||
        `© ${new Date().getFullYear()} ${launchFooterAppName}. All rights reserved.`,
      )
        .replace(/Â©/g, "©")
        .replace(/^\?\s*/, "© ");

    const launchFooterCopyright = launchCopyright.includes(launchFooterAppName)
      ? launchCopyright
      : `© ${new Date().getFullYear()} ${launchFooterAppName}. All rights reserved.`;

    const normalizedLaunchFooterCopyright = launchFooterCopyright.replace(/Â©|Ã‚Â©/g, "\u00A9");

    const forcedLaunchFooterCopyright = normalizedLaunchFooterCopyright.includes(launchFooterAppName)
      ? normalizedLaunchFooterCopyright.replace(/Trainup/g, launchFooterAppName)
      : `\u00A9 ${new Date().getFullYear()} ${launchFooterAppName}. All rights reserved.`;

    return (
      <div className="training-launch-state training-launch-auth-shell">
        <div className="training-launch-auth-card-wrap">
          <div className="auth-card auth-card-focused training-launch-auth-card">
            <div className="auth-card-body training-launch-auth-card-body">
              <div className="auth-card-brand training-launch-auth-header">
                <img
                  src={launchBrandLogo}
                  alt={launchBrandName}
                  className="training-launch-auth-logo"
                  onError={() => setLaunchHeaderLogoFailed(true)}
                />
              </div>
              <div className="text-center mb-4">
                <h2 className="training-launch-auth-title">Sign in</h2>
                <p className="training-launch-auth-copy mb-0">Use your workspace email and password to continue.</p>
              </div>

              <form className="training-launch-login-form" onSubmit={submitLaunchLogin}>
                <div className="mb-2">
                  <label className="form-label" htmlFor="trainingLaunchEmail">
                    Email address
                  </label>
                  <input
                    id="trainingLaunchEmail"
                    className="form-control"
                    type="email"
                    value={launchLoginEmail}
                    onChange={(event) => setLaunchLoginEmail(event.target.value)}
                    placeholder="name@company.com"
                    autoComplete="username"
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label" htmlFor="trainingLaunchPassword">
                    Password
                  </label>
                  <div className="input-group input-group-merge">
                    <input
                      id="trainingLaunchPassword"
                      className="form-control"
                      type={showLaunchLoginPassword ? "text" : "password"}
                      value={launchLoginPassword}
                      onChange={(event) => setLaunchLoginPassword(event.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className={`input-group-text border-start-0 bg-transparent ${showLaunchLoginPassword ? "show-password" : ""}`}
                      onClick={() => setShowLaunchLoginPassword((current) => !current)}
                      aria-label={showLaunchLoginPassword ? "Hide password" : "Show password"}
                    >
                      <span className="password-eye" />
                    </button>
                  </div>
                </div>

                {launchLoginError ? (
                  <div className="training-launch-login-error mb-3">{launchLoginError}</div>
                ) : null}

                <div className="mb-0 text-center">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isLaunchLoginLoading}
                  >
                    {isLaunchLoginLoading ? "Signing in..." : "Sign in"}
                  </button>
                </div>
              </form>

              <div className="auth-divider training-launch-auth-divider">
                <span>or</span>
              </div>
              {googleClientId ? (
                <div className="auth-google-slot training-launch-auth-google">
                  <GoogleLogin
                    onSuccess={(response: CredentialResponse) =>
                      void submitGoogleLaunchLogin(String(response.credential || ""))
                    }
                    onError={() =>
                      setGoogleLoginError("Google sign-in could not be started.")
                    }
                    text="continue_with"
                    theme="outline"
                    size="large"
                    shape="rectangular"
                    width="100%"
                    hosted_domain="brenin.co"
                  />
                  {isGoogleLoginLoading ? (
                    <div className="small text-body-secondary">
                      Signing in with Google...
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="small text-body-secondary text-center">
                  Google sign-in is not configured in this environment yet.
                </div>
              )}

              {googleLoginError ? (
                <div className="training-launch-login-error mt-3">
                  {googleLoginError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="training-launch-auth-footer">
          <span className="training-launch-auth-footer-copy">{forcedLaunchFooterCopyright}</span>
          <span className="training-launch-auth-footer-brand">{launchFooterAppName}</span>
        </div>
      </div>
    );
  }

  if (errorMessage || !training || !currentSlide) {
    return (
      <div className="training-launch-state">
        <div className="training-launch-state-card">
          <h1>Launch Unavailable</h1>
          <p>{errorMessage || "This training is not available right now."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="training-launch-page" style={launchTheme}>
      <audio
        ref={audioRef}
        onLoadStart={handleAudioLoadStart}
        onWaiting={handleAudioWaiting}
        onCanPlay={handleAudioCanPlay}
        onPlay={handleAudioPlay}
        onPause={handleAudioPause}
        onEnded={handleAudioEnded}
        onEmptied={handleAudioEmptied}
        onError={handleAudioError}
      />

      {showLaunchChrome ? (
        <div className="training-launch-topbar">
          <div className="training-launch-progress-shell">
            <div className="training-launch-progress">
              {launchSequence.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`training-launch-progress-dot ${index === currentSlideIndex ? "is-active" : ""} ${index < currentSlideIndex ? "is-complete" : ""
                    }`}
                  onClick={() => goToSlide(index)}
                  aria-label={`Open step ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        show={isProfileModalOpen}
        title="Learner Profile"
        onClose={() => setIsProfileModalOpen(false)}
        size="xl"
        scrollable
        dialogClassName="training-launch-profile-dialog"
        contentClassName="training-launch-profile-content"
        bodyClassName="training-launch-profile-body"
      >
        <div className="training-launch-profile-modal">
          <div className="training-launch-profile-hero">
            <span className="training-launch-profile-avatar" >
              {getInitials(resolvedLearnerProfile.name)}
            </span>
            <div className="training-launch-profile-hero-copy">
              <strong>{resolvedLearnerProfile.name}</strong>
              <span>{resolvedLearnerProfile.email}</span>
              <small className="training-launch-profile-role-chip">
                {resolvedLearnerProfile.role || "Trainee"}
              </small>
            </div>
          </div>

          <div className="training-launch-profile-tabs" role="tablist" aria-label="Learner profile tabs">
            {[
              { key: "overview", label: "Overview" },
              { key: "sessions", label: "Sessions" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`btn ${activeProfileTab === tab.key ? "btn-primary" : "btn-secondary"} training-launch-profile-tab${activeProfileTab === tab.key ? " is-active" : ""}`}
                onClick={() => setActiveProfileTab(tab.key as "overview" | "sessions")}
                role="tab"
                aria-selected={activeProfileTab === tab.key}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeProfileTab === "overview" ? (
            <div className="training-launch-profile-panel">
              <div className="training-launch-profile-detail-list">
                {overviewDetails.map((detail) => (
                  <div key={detail.label} className="training-launch-profile-detail-row is-inline">
                    <span>{detail.label}</span>
                    <strong>{detail.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeProfileTab === "sessions" ? (
            <div className="training-launch-profile-panel">
              <div className="training-launch-profile-stat-grid is-sessions">
                <div className="training-launch-profile-stat-card">
                  <span>Attended Trainings</span>
                  <strong>{sessionSummary.attendedTrainingsCount}</strong>
                </div>
                <div className="training-launch-profile-stat-card">
                  <span>Total Sessions</span>
                  <strong>{sessionSummary.totalSessionsCount}</strong>
                </div>
                <div className="training-launch-profile-stat-card">
                  <span>Completed Trainings</span>
                  <strong>{sessionSummary.completedTrainingsCount}</strong>
                </div>
                <div className="training-launch-profile-stat-card">
                  <span>Incomplete Trainings</span>
                  <strong>{sessionSummary.incompleteTrainingsCount}</strong>
                </div>
              </div>
              <div className="training-launch-profile-session-table">
                <div className="training-launch-profile-session-head">
                  <span>Training</span>
                  <span>Type</span>
                  <span>Attend Duration</span>
                  <span>Slides Read</span>
                  <span>Status</span>
                </div>
                <div className="training-launch-profile-session-body">
                  {learnerSessionHistory.length ? (
                    learnerSessionHistory.map((session) => (
                      <div key={session.sessionId} className="training-launch-profile-session-row">
                        <div className="training-launch-profile-session-title">
                          <strong>{session.trainingTitle}</strong>
                        </div>
                        <div className="training-launch-profile-session-meta">
                          <span>{session.trainingType || "Not available"}</span>
                        </div>
                        <div className="training-launch-profile-session-time">
                          <strong>{session.timeSpent || "0m 00s"}</strong>
                        </div>
                        <div className="training-launch-profile-session-slides">
                          <strong>{Number(session.slidesViewed || 0)}/{Number(session.totalSlides || 0)}</strong>
                        </div>
                        <div className="training-launch-profile-session-status">
                          <span className={`training-launch-profile-status-chip is-${session.status}`}>
                            {session.status}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="training-launch-profile-empty">
                      No learner sessions recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <div className={`training-launch-workarea${showLaunchChrome ? "" : " is-preview-only"}`}>
        <div
          className={`training-launch-main${hasAvatarRuntime && avatarVisible ? " has-avatar" : ""}`}
        >
          <div
            className={`training-launch-content ${showLaunchChrome && currentSlideHasForm ? "has-form" : ""}`}
          >
            <div className="training-launch-stage">
              <div
                className={`training-launch-media ${displayMediaUrl ? "has-media" : ""}${!showLaunchChrome ? " is-preview" : ""}${isPreparingLaunch ? " is-loading" : ""}`}
                style={
                  displayMediaUrl && !isPreparingLaunch
                    ? { backgroundImage: `url(${displayMediaUrl})` }
                    : undefined
                }
              >
                {hasStarted && !isPreparingLaunch && (currentSlide.interactiveHotspots ?? []).length ? (
                  <div className="training-hotspot-rail training-launch-hotspot-rail" aria-label="Slide actions">
                    {activeSlideHotspots.map((hotspot, index, hotspots) => {
                      const kindCount = hotspots.filter((item) => item.kind === hotspot.kind).length;
                      const kindIndex = hotspots
                        .slice(0, index + 1)
                        .filter((item) => item.kind === hotspot.kind).length - 1;

                      return (
                        <button
                          key={hotspot.id}
                          type="button"
                          className={`training-hotspot-action-button training-hotspot-action-button-${hotspot.kind}`}
                          onClick={() => openInteractiveHotspot(hotspot)}
                          aria-label={getHotspotTargetLabel(hotspot)}
                          title={getHotspotTargetLabel(hotspot)}
                        >
                          <span className="training-hotspot-action-button-icon" aria-hidden="true">
                            <i className={`bi ${hotspot.kind === "video" ? "bi-play-circle" : "bi-link-45deg"}`} aria-hidden="true" />
                          </span>
                          <span className="training-hotspot-action-button-text">
                            {getHotspotActionText(hotspot, kindIndex, kindCount)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {!isPreparingLaunch && !displayMediaUrl && !isQuestionSetStep ? (
                  <div className="training-launch-media-fallback">
                    <strong>{displaySlide?.title || currentSlide.title}</strong>
                    <span>
                      Approved launch media will appear here once the slide asset is
                      linked.
                    </span>
                  </div>
                ) : null}

                {!isPreparingLaunch &&
                  isQuestionSetStep &&
                  currentQuestionSet &&
                  questionSetFields.length &&
                  currentSequenceItem?.kind === "question_set" ? (
                  <div
                    className="training-launch-overlay training-launch-question-overlay"
                  >
                    <div className="training-launch-question-shell card border-0 shadow-lg">
                      <div className="training-launch-question-shell-body card-body p-4 p-lg-5">
                        <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                          <div>
                            <span className="badge text-bg-primary mb-2">
                              Knowledge Check
                            </span>
                            <h2 className="h4 mb-1">{currentQuestionSet.label}</h2>
                            <div className="text-body-secondary">
                              {currentQuestionSet.checkpoints.length} questions on
                              one slide
                            </div>
                            <div className="small text-body-secondary mt-1">
                              {currentQuestionSet.isMandatory !== false
                                ? "This knowledge check must be submitted before continuing."
                                : "This knowledge check is optional. Learners can continue without submitting."}
                            </div>
                          </div>
                          {Array.from(
                            new Set(
                              currentQuestionSet.checkpoints.flatMap(
                                (checkpoint) => checkpoint.sourceLabels,
                              ),
                            ),
                          ).length ? (
                            <div className="d-flex gap-2 flex-wrap">
                              {Array.from(
                                new Set(
                                  currentQuestionSet.checkpoints.flatMap(
                                    (checkpoint) => checkpoint.sourceLabels,
                                  ),
                                ),
                              ).map((label) => (
                                <span
                                  key={label}
                                  className="badge text-bg-light border text-dark"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {currentStepSubmitted ? (
                          <div className="training-launch-question-success" role="status" aria-live="polite">
                            <div className="training-launch-question-success-icon" aria-hidden="true">
                              <i className="bi bi-check2-circle" />
                            </div>
                            <h3 className="h5 mb-2">Successfully submitted</h3>
                            <p className="mb-0 text-body-secondary">
                              Your answers have been recorded. You can continue to the next step.
                            </p>
                          </div>
                        ) : (
                          <TrainingSlideForm
                            fields={questionSetFields}
                            formConfig={{
                              waitForSubmit: true,
                              requireCorrect: false,
                              limitSubmissions: false,
                              submissionLimit: 1,
                              onCorrectSlide: "",
                              onIncorrectSlide: "",
                              timer: "None",
                            }}
                            mode="launch"
                            onSubmit={handleSlideSubmit}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {!hasStarted && !isPreparingLaunch ? (
                <div className="training-launch-overlay training-launch-start-overlay">
                  <div className="training-launch-start-hero">
                    {pendingResumeSession ? (
                      <div className="card border-0 shadow-lg mx-auto" style={{ maxWidth: '450px' }}>
                        <div className="card-body p-4 p-md-5 text-center">
                          <div className="mb-4">
                            <i className="bi bi-clock-history fs-1 text-primary opacity-75"></i>
                          </div>
                          <h3 className="h4 mb-3 text-dark">Resume Session?</h3>
                          <p className="training-launch-resume-prompt mb-4 text-secondary">
                            You have an unfinished session for this training.
                            Would you like to continue where you left off, or start over?
                          </p>
                          <div className="d-flex gap-3 justify-content-center flex-wrap">
                            <button
                              type="button"
                              className="btn btn-light border px-4 py-2"
                              disabled={isVerifyingStartPermissions}
                              onClick={handleRestartIncompleteTraining}
                            >
                              Start Over
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary px-4 py-2"
                              style={{
                                backgroundColor: 'var(--launch-primary)',
                                borderColor: 'var(--launch-primary-border)',
                                color: 'var(--launch-primary-text)'
                              }}
                              onClick={handleResumeIncompleteTraining}
                            >
                              Resume
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-lg training-launch-start-button"
                        disabled={isVerifyingStartPermissions}
                        onClick={() => {
                          void startTraining();
                        }}
                      >
                        {isVerifyingStartPermissions
                          ? "Checking camera & microphone..."
                          : hasCompletedRun
                            ? "Restart Training"
                            : "Start Training"}
                      </button>
                    )}
                    {startPermissionError ? (
                      <div
                        className="alert alert-danger d-flex align-items-center mt-4 mx-auto shadow-sm text-start position-fixed"
                        role="alert"
                        style={{ top: '0px' }}
                      >
                        <i className="bi bi-exclamation-triangle-fill flex-shrink-0 me-3 fs-4"></i>
                        <div>
                          {startPermissionError}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {isPreparingLaunch ? (
                <div className="training-launch-overlay training-launch-start-overlay is-loading">
                  <div className="training-launch-loading-bg" aria-hidden="true">
                    <span className="training-launch-loading-bg-orb training-launch-loading-bg-orb-primary" />
                    <span className="training-launch-loading-bg-orb training-launch-loading-bg-orb-secondary" />
                    <span className="training-launch-loading-bg-orb training-launch-loading-bg-orb-tertiary" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-one" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-two" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-three" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-four" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-five" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-six" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-seven" />
                    <span className="training-launch-loading-particle training-launch-loading-particle-eight" />
                  </div>
                  <div className="training-launch-start-hero">
                    <div className="training-launch-loading-card">
                      <div className="training-launch-ai-loader" aria-hidden="true">
                        <div className="training-launch-ai-loader-orb">
                          <span className="training-launch-ai-loader-ring" />
                          <span className="training-launch-ai-loader-ring training-launch-ai-loader-ring-secondary" />
                          <span className="training-launch-ai-loader-core" />
                          <span className="training-launch-ai-loader-bubble training-launch-ai-loader-bubble-one" />
                          <span className="training-launch-ai-loader-bubble training-launch-ai-loader-bubble-two" />
                          <span className="training-launch-ai-loader-bubble training-launch-ai-loader-bubble-three" />
                        </div>
                      </div>
                      <div className="training-launch-start-copy">
                        <h2>{training.branding?.loaderTitle || "Preparing Training"}</h2>
                        <p className="training-launch-loading-typewriter" aria-live="polite">
                          <span>{typedLoadingMessage || "\u00A0"}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {showLaunchChrome && currentSlideHasForm ? (
              <div className="training-launch-form-shell">
                <div className="training-launch-form-header">
                  <strong>Slide Form</strong>
                  <span>
                    {currentSlideRequiresSubmit
                      ? currentSlideSubmitted
                        ? "Submitted"
                        : "Submit required before continuing"
                      : "Optional interaction"}
                  </span>
                </div>
                <TrainingSlideForm
                  fields={currentSlide.formFields ?? []}
                  formConfig={currentSlide.formConfig}
                  mode="launch"
                  onSubmit={handleSlideSubmit}
                />
              </div>
            ) : null}
          </div>

          {showLaunchChrome ? (
            <div className="training-launch-footer">
              <div className="training-launch-footer-row">
                <div className="training-launch-controls">
                  {isAskMode ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={stopAskMode}
                        aria-label="Go Back"
                        title="Go Back"
                      >
                        {renderLaunchButtonLabel("bi-arrow-left", "Go Back")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={isQuestionLoading || isAskConnecting}
                        onClick={() => {
                          if (isAskListening) {
                            avatarRef.current?.stopListening();
                            stopBrowserQuestion({ keepQuestionPanel: true });
                            setIsAskListening(false);
                            setLaunchStatus("");
                            return;
                          }

                          startUnifiedAskMode();
                        }}
                        aria-label={askModeListenButtonLabel}
                        title={askModeListenButtonLabel}
                      >
                        {renderLaunchButtonLabel(
                          askModeListenButtonIcon,
                          askModeListenButtonLabel,
                        )}
                      </button>
                    </>
                  ) : (
                    <>
                      {!currentSlide.settings?.hidePreviousButton ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={currentSlideIndex === 0 || areLaunchControlsLocked}
                          onClick={() => goToSlide(currentSlideIndex - 1)}
                          aria-label={previousButtonLabel}
                          title={previousButtonLabel}
                        >
                          {renderLaunchButtonLabel("bi-chevron-left", previousButtonLabel)}
                        </button>
                      ) : null}

                      {!currentSlide.settings?.hidePauseButton ? (
                        <button
                          type="button"
                          className={resolveLaunchButtonClass(isSlidePlaybackActive)}
                          disabled={
                            !hasStarted ||
                            isQuestionSetStep ||
                            isAdvancingAfterSubmit ||
                            areLaunchControlsLocked ||
                            (!hasAvatarRuntime && audioState === "loading")
                          }
                          onClick={togglePlayback}
                          aria-label={playbackButtonLabel}
                          title={playbackButtonLabel}
                        >
                          {renderLaunchButtonLabel(
                            playbackButtonIcon,
                            playbackButtonLabel,
                          )}
                        </button>
                      ) : null}

                      {isLastStep ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={
                            isSubmittingTraining ||
                            isAdvancingAfterSubmit ||
                            (currentSlideRequiresSubmit && !currentSlideSubmitted)
                          }
                          onClick={() => {
                            void completeTraining();
                          }}
                          aria-label={isSubmittingTraining ? "Submitting..." : "Submit"}
                          title={isSubmittingTraining ? "Submitting..." : "Submit"}
                        >
                          {renderLaunchButtonLabel(
                            isSubmittingTraining
                              ? "bi-hourglass-split"
                              : "bi-check2-circle",
                            isSubmittingTraining ? "Submitting..." : "Submit",
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={
                            areLaunchControlsLocked ||
                            isAdvancingAfterSubmit ||
                            currentSlideRequiresSubmit && !currentSlideSubmitted
                          }
                          onClick={() => goToSlide(currentSlideIndex + 1)}
                          aria-label={isQuestionSetStep ? "Continue" : nextButtonLabel}
                          title={isQuestionSetStep ? "Continue" : nextButtonLabel}
                        >
                          {renderLaunchButtonLabel(
                            isQuestionSetStep ? "bi-arrow-right-circle" : "bi-chevron-right",
                            isQuestionSetStep ? "Continue" : nextButtonLabel,
                          )}
                        </button>
                      )}

                      {!currentSlide.settings?.hideAutoplayButton ? (
                        <button
                          type="button"
                          className={`btn ${autoplayButtonClass}`}
                          disabled={areLaunchControlsLocked}
                          onClick={toggleAutoplay}
                          aria-label={autoplayButtonLabel}
                          title={autoplayButtonLabel}
                        >
                          {renderLaunchButtonLabel(
                            autoplayButtonIcon,
                            autoplayButtonLabel,
                          )}
                        </button>
                      ) : null}

                      {!currentSlide.settings?.hideAskQuestionButton ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={
                            !hasStarted ||
                            areLaunchControlsLocked ||
                            isAskConnecting ||
                            isQuestionLoading ||
                            (hasAvatarRuntime && !avatarReady)
                          }
                          onClick={() => {
                            startUnifiedAskMode();
                          }}
                          aria-label={launchAskButtonLabel}
                          title={launchAskButtonLabel}
                        >
                          {renderLaunchButtonLabel(
                            launchAskButtonIcon,
                            launchAskButtonLabel,
                          )}
                        </button>
                      ) : null}

                      {hasAvatarRuntime ? (
                        <button
                          type="button"
                          className={`btn training-launch-footer-avatar-toggle ${avatarVisible ? "btn-secondary" : "btn-primary"}`}
                          onClick={() => setAvatarVisible((current) => !current)}
                          aria-label={avatarVisible ? "Hide Avatar" : "Show Avatar"}
                          title={avatarVisible ? "Hide Avatar" : "Show Avatar"}
                        >
                          {renderLaunchButtonLabel(
                            avatarVisible ? "bi-person-bounding-box" : "bi-person-x",
                            avatarVisible ? "Hide Avatar" : "Show Avatar",
                          )}
                        </button>
                      ) : null}

                      {hasAvatarRuntime ? (
                        <button
                          type="button"
                          className={`btn ${avatarMuted ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => setAvatarMuted((current) => !current)}
                          aria-label={avatarMuted ? "Unmute" : "Mute"}
                          title={avatarMuted ? "Unmute" : "Mute"}
                        >
                          {renderLaunchButtonLabel(
                            avatarMuted ? "bi-volume-mute" : "bi-volume-up",
                            avatarMuted ? "Unmute" : "Mute",
                          )}
                        </button>
                      ) : null}

                    </>
                  )}
                </div>
              </div>
              {isAdvancingAfterSubmit ? (
                <div className="training-launch-submit-progress" role="status" aria-live="polite">
                  <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                  <span>Submitting form and opening next slide...</span>
                </div>
              ) : currentSlideRequiresSubmit && !currentSlideSubmitted ? (
                <div className="training-launch-audio-error">
                  Submit the slide form to continue.
                </div>
              ) : null}
              {questionError ? (
                <div className="training-launch-audio-error">{questionError}</div>
              ) : null}
              {audioState === "error" ? (
                <div className="training-launch-audio-error">{audioMessage}</div>
              ) : null}
            </div>
          ) : null}

        </div>

        <div className={`training-launch-sidebar${showLaunchChrome ? "" : " is-hidden"}`}>
          <div className="training-launch-header-panel">
            <div className="training-launch-header-info">
              <div className="training-launch-header-meta">
                <strong title={training.title}>{training.title}</strong>
                <div className="training-launch-header-meta-row">
                  <span className="training-launch-header-chip">
                    Slide {currentDisplaySlideCounter}/{launchSequence.length}
                  </span>
                  <span className="training-launch-header-chip">
                    {Math.min(elapsedMinutes, totalTrainingMinutes)}/{totalTrainingMinutes}m
                  </span>
                </div>
              </div>
              <div className="training-launch-header-actions">
                {training.localizedVoiceovers?.languages?.length ? (
                  <div
                    ref={languageMenuRef}
                    className={`training-launch-language-menu${isLanguageMenuOpen ? " is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="training-launch-language-switch"
                      onClick={() => setIsLanguageMenuOpen((current) => !current)}
                      aria-label="Select launch language"
                      aria-expanded={isLanguageMenuOpen}
                    >
                      <span className="training-launch-language-icon" aria-hidden="true">
                        <i className="bi bi-translate" />
                      </span>
                      <span className="training-launch-language-value">
                        {getLanguageShortLabel(selectedLocalizedLanguage)}
                      </span>
                      <i
                        className={`bi ${isLanguageMenuOpen ? "bi-chevron-up" : "bi-chevron-down"} training-launch-language-caret`}
                        aria-hidden="true"
                      />
                    </button>
                    {isLanguageMenuOpen ? (
                      <div className="training-launch-language-dropdown" role="listbox" aria-label="Launch languages">
                        {training.localizedVoiceovers.languages.map((language) => {
                          const isSelected = language.code === selectedLanguageCode;

                          return (
                            <button
                              key={language.code}
                              type="button"
                              className={`training-launch-language-option${isSelected ? " is-active" : ""}`}
                              onClick={() => {
                                setSelectedLanguageCode(language.code);
                                setIsLanguageMenuOpen(false);
                              }}
                              role="option"
                              aria-selected={isSelected}
                            >
                              <span className="training-launch-language-option-code">
                                {getLanguageShortLabel(language)}
                              </span>
                              <span className="training-launch-language-option-label">{language.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div
                  ref={launchActionsMenuRef}
                  className={`training-launch-actions-menu${isLaunchActionsOpen ? " is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm training-launch-icon-button"
                    onClick={() => setIsLaunchActionsOpen((current) => !current)}
                    aria-label="Open learner actions"
                    aria-expanded={isLaunchActionsOpen}
                    title="More actions"
                  >
                    <i className="bi bi-three-dots-vertical" aria-hidden="true" />
                  </button>
                  {isLaunchActionsOpen ? (
                    <div className="training-launch-actions-dropdown">
                      <button
                        type="button"
                        className="training-launch-actions-item"
                        onClick={() => {
                          setActiveProfileTab("overview");
                          setIsProfileModalOpen(true);
                          setIsLaunchActionsOpen(false);
                        }}
                      >
                        <i className="bi bi-person-circle" aria-hidden="true" />
                        <span>Profile</span>
                      </button>
                      <button
                        type="button"
                        className="training-launch-actions-item is-danger"
                        onClick={() => {
                          setIsLaunchActionsOpen(false);
                          void completeTraining();
                        }}
                        disabled={isSubmittingTraining}
                      >
                        <i
                          className={`bi ${isSubmittingTraining ? "bi-hourglass-split" : "bi-box-arrow-right"}`}
                          aria-hidden="true"
                        />
                        <span>{isSubmittingTraining ? "Ending..." : "End Training"}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {proctoringEnabled ? (
            <TrainingLaunchProctoring
              ref={proctoringRef}
              className={`training-launch-stage-rail${hasStarted ? "" : " is-pending"}`}
              onStatusChange={(status) => {
                setProctoringStatus(status);
                if (!hasStarted) {
                  return;
                }

                if (status === "connecting") {
                  setLaunchStatus("Waiting for proctoring to go live.");
                  return;
                }

                if (status === "monitoring") {
                  setLaunchStatus((current) =>
                    current === "Waiting for proctoring to go live." ? "" : current,
                  );
                  return;
                }

                if (status === "error") {
                  setLaunchStatus("Proctoring could not go live.");
                  return;
                }

                if (status === "stopped") {
                  setLaunchStatus("Proctoring stopped.");
                }
              }}
            />
          ) : null}

          {hasAvatarRuntime ? (
            <div className="training-launch-avatar-rail">
              {isTavusAvatarProvider ? (
                <TrainingLaunchTavusAvatar
                  ref={avatarRef}
                  avatarId={resolvedTavusReplicaId}
                  personaId={resolvedTavusPersonaId}
                  voiceId={selectedLocalizedLanguage?.voiceId || training.voiceId}
                  trainingId={training.id}
                  language={selectedSpeechLocale}
                  username={training.viewerName || "Learner"}
                  positionClass={`is-bottom-right${avatarVisible ? "" : " is-hidden"}`}
                  onReady={() => {
                    setAvatarReady(true);
                    setQuestionError("");
                    avatarRef.current?.pushTrainingContext({
                      trainingId: training.id,
                      currentSlideId: currentSlide.id,
                    });
                  }}
                  onMicChange={(enabled) => {
                    setIsAskListening(enabled);

                    if (!enabled) {
                      setLaunchStatus((current) =>
                        current === "Listening for your question." ? "" : current,
                      );
                    }
                  }}
                  onStatusChange={handleAvatarStatusChange}
                  // Tavus answers Ask-mode questions natively (via its own
                  // conversational_context-grounded pipeline, for speed) —
                  // no onTranscript here, so its answer doesn't also trigger
                  // our own /ask + Echo, which would speak twice.
                />
              ) : (
                <TrainingLaunchAvatar
                  ref={avatarRef}
                  avatarId={resolvedAvatarId}
                  language={selectedSpeechLocale}
                  username={training.viewerName || "Learner"}
                  positionClass={`is-bottom-right${avatarVisible ? "" : " is-hidden"}`}
                  onReady={() => {
                    setAvatarReady(true);
                    setQuestionError("");
                    avatarRef.current?.pushTrainingContext({
                      trainingId: training.id,
                      currentSlideId: currentSlide.id,
                    });
                  }}
                  onMicChange={(enabled) => {
                    setIsAskListening(enabled);

                    if (!enabled) {
                      setLaunchStatus((current) =>
                        current === "Listening for your question." ? "" : current,
                      );
                    }
                  }}
                  onStatusChange={handleAvatarStatusChange}
                  onTranscript={handleAvatarTranscript}
                />
              )}
              <button
                type="button"
                className={`btn training-launch-avatar-mobile-toggle ${avatarVisible ? "btn-secondary" : "btn-primary"}`}
                onClick={() => setAvatarVisible((current) => !current)}
                aria-label={avatarVisible ? "Hide Avatar" : "Show Avatar"}
                title={avatarVisible ? "Hide Avatar" : "Show Avatar"}
              >
                <i
                  className={`bi ${avatarVisible ? "bi-person-bounding-box" : "bi-person-x"} training-launch-btn-icon`}
                  aria-hidden="true"
                />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {activeLaunchHotspot ? (
        <div
          className="training-media-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveLaunchHotspot(null)}
        >
          <div className="training-media-modal-card training-media-modal-card-dark" onClick={(event) => event.stopPropagation()}>
            <div className="training-media-modal-body">
              <button
                type="button"
                className="training-media-modal-close"
                aria-label="Close media preview"
                onClick={() => setActiveLaunchHotspot(null)}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
              {activeLaunchHotspot.presentation.mode === "iframe" ? (
                <iframe
                  src={activeLaunchHotspot.presentation.src}
                  title={activeLaunchHotspot.hotspot.label}
                  className={`training-media-modal-frame${activeLaunchHotspot.hotspot.kind === "link" ? " is-link" : ""}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video
                  src={activeLaunchHotspot.presentation.src}
                  className="training-media-modal-video"
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default TrainingLaunch;
