import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { ErrorMessage, Field, Form, Formik, type FormikProps } from "formik";
import Swal from "sweetalert2";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import type {
  PaginatedResponse,
  TrainingAvatarEngineConfig,
  TrainingBrandingSettings,
  TrainingButtonRadiusPreset,
  TrainingFieldType,
  TrainingFontFamilyPreset,
  TrainingFontSizePreset,
  TrainingFontWeightPreset,
  TrainingFormConfig,
  TrainingFormField,
  TrainingGradientDirection,
  TrainingKnowledgeDocument,
  TrainingLocalizedButtonLabels,
  TrainingLocalizedVoiceLanguage,
  TrainingLocalizedVoiceovers,
  TrainingMode,
  TrainingNarrationAudioAsset,
  TrainingQuestionCheckpoint,
  TrainingQuestionDifficulty,
  TrainingQuestionGeneratorConfig,
  TrainingQuestionSetRecord,
  TrainingReviewAttachment,
  TrainingInteractiveHotspot,
  TrainingSlideMediaSource,
  TrainingSlideSettings,
  TrainingSlideshowTheme,
  TrainingSessionRecord,
  TrainingSlideRecord,
  TrainingStatus,
  TrainingTtsMode,
  TrainingType,
  TrainingWorkspaceRecord,
  UserRecord,
} from "../../constant/interfaces";
import RoleWorkspaceShell from "../common/RoleWorkspaceShell";
import ActionDropdown from "../common/ActionDropdown";
import Modal from "../common/Modal";
import PageShell from "../common/PageShell";
import SlideMediaPreview from "./SlideMediaPreview";
import ScriptAudioPlayer from "./ScriptAudioPlayer";
import TrainingFormBuilderModal, { defaultFormConfig } from "./TrainingFormBuilderModal";
import TrainingSlideForm from "./TrainingSlideForm";
import WorkspaceProfilePanel from "./WorkspaceProfilePanel";
import {
  extractPdfPagesToImages,
  extractPptxSlidesToImages,
  removeSlideMediaAsset,
  resolveSlideMediaAsset,
  storeImageFile,
  type SlideMediaImportRecord,
} from "../../helper/slideMediaStore";
import {
  addTrainingReviewMessage,
  approveTraining,
  hydrateTrainingWorkspace,
  markTrainingReviewMessagesRead,
  removeTraining,
  requestTrainingChanges,
  saveTraining,
  sanitizeTrainingRecordForStorage,
  submitTrainingForReview,
  updateTrainingSlideAdditionalInfo,
  updateTrainingSlideScript,
} from "../../redux/trainingWorkspaceSlice";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_PROVIDER,
  DEFAULT_ELEVENLABS_VOICE_NAME,
} from "../../constant/tts";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import AxiosHelper, { isServerApiEnabled } from "../../helper/AxiosHelper";
import { createGroupSession, getTrainingAnalytics, type TrainingAnalytics } from "../../helper/groupSessionApi";
import { withBase, withOrigin } from "../../helper/basePath";
import { buildScriptAudioKey, generateScriptAudioDataUri } from "../../helper/scriptAudio";
import LmsLaunchLinkGenerator from "./LmsLaunchLinkGenerator";
import { extractKnowledgeDocument } from "../../helper/trainingKnowledge";
import { buildSlidePointsFromSource } from "../../helper/trainingNarration";
import { generatePromptDrivenNarration, translateSlideNarration } from "../../helper/trainingNarrationApi";
import { generateTrainingQuestions } from "../../helper/trainingQuestionGenerationApi";
import {
  defaultTrainingQuestionGeneratorConfig,
  humanizeTrainingQuestionType,
} from "../../helper/trainingQuestions";
import { getHotspotActionText } from "../../helper/interactiveHotspots";
import { isValidUrl } from "../../helper/validation";

type WorkspaceRole = "trainer" | "reviewer";
type WorkspaceView = "dashboard" | "trainings" | "builder" | "detail" | "profile";
type DetailTab = "sessions" | "review" | "report" | "delivery";
type BuilderMode = "upload" | "create";
type UploadRecordKind = "images" | "pdf" | "ppt";
// type AvatarOption = {
//   name: string;
//   id: string;
//   ttsProvider: string;
// };

type ElevenLabsVoiceOption = {
  voiceId: string;
  name: string;
  category?: string;
  previewUrl?: string;
  gender?: string;
  accent?: string;
  age?: string;
  description?: string;
  isDefault?: boolean;
};

type ElevenLabsVoicesResponse = {
  provider: string;
  defaultVoiceId: string;
  defaultVoiceName: string;
  voices: ElevenLabsVoiceOption[];
};

type QuestionEditDraft = {
  prompt: string;
  questionType: TrainingQuestionCheckpoint["questionType"];
  options: string[];
};

const createDefaultHotspot = (
  kind: TrainingInteractiveHotspot["kind"],
): TrainingInteractiveHotspot => ({
  id: `hotspot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  label: kind === "video" ? "Open video" : "Open link",
  url: "",
  leftPct: 50,
  topPct: 88,
  widthPct: 18,
  heightPct: 10,
});

const REVIEW_MESSAGE_LINK_PATTERN = /(https?:\/\/[^\s]+)/gi;

const buildReviewParticipantLabel = (role: WorkspaceRole, name: string) =>
  `${name} (${role === "reviewer" ? "Reviewer" : "Trainer"})`;

const buildReviewParticipantKey = (role: WorkspaceRole, name: string) =>
  `${role}:${name.trim().toLowerCase()}`;

const renderReviewMessageText = (text: string) => {
  const lines = text.split(/\r?\n/);

  return lines.map((line, lineIndex) => {
    const segments = line.split(REVIEW_MESSAGE_LINK_PATTERN);

    return (
      <span key={`line-${lineIndex}`}>
        {segments.map((segment, segmentIndex) =>
          /^https?:\/\/[^\s]+$/i.test(segment) ? (
            <a
              key={`segment-${lineIndex}-${segmentIndex}`}
              href={segment}
              target="_blank"
              rel="noreferrer"
              className="training-review-room-inline-link"
            >
              {segment}
            </a>
          ) : (
            <span key={`segment-${lineIndex}-${segmentIndex}`}>{segment}</span>
          ),
        )}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
};

const renderReviewAttachmentPreview = (attachment: TrainingReviewAttachment, draft = false) => {
  const content =
    attachment.kind === "image" ? (
      <img src={attachment.url} alt={attachment.name} />
    ) : attachment.kind === "video" ? (
      <video src={attachment.url} controls={draft} />
    ) : (
      <span className="training-review-room-attachment-file">
        <i className={`bi ${attachment.kind === "link" ? "bi-link-45deg" : "bi-file-earmark"} me-1`} />
        <span>{attachment.name}</span>
      </span>
    );

  if (draft) {
    return <div className="training-review-room-attachment training-review-room-attachment--draft">{content}</div>;
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className={`training-review-room-attachment${attachment.kind === "link" ? " is-link" : ""}`}
    >
      {content}
    </a>
  );
};

type TrainingSetupValues = {
  title: string;
  type: TrainingType;
  typeCustom: string;
  audience: string;
  trainingMode: TrainingMode;
  avatarName: string;
  avatarId: string;
  ttsMode: TrainingTtsMode;
  ttsProvider: string;
  voiceName: string;
  voiceId: string;
  manualApiKey: string;
  manualApiKeyVerifiedAt: string;
  presenterNotes: string;
  questionButtonLabel: string;
  askSystemPrompt: string;
  avatarEngineBaseUrl: string;
  avatarEngineModel: string;
  avatarEnginePrompt: string;
  avatarEngineMemoryEnabled: boolean;
  avatarEngineSttProvider: string;
  avatarEngineLanguage: string;
  avatarEngineAdditionalLanguages: string;
  avatarEngineAvatarId: string;
  durationMins: number;
  maxDurationMins: number;
  idleRefreshMins: string;
  allowSkipAhead: boolean;
  allowMultipleAttempts: boolean;
  maxAttempts: number;
  showProgressBar: boolean;
  showSubtitles: boolean;
  disablePreviousButton: boolean;
  enableReviewMode: boolean;
  markAnswersInRealTime: boolean;
  showMarksInProgressBar: boolean;
  showFinalScore: boolean;
  allowPublicDemoAccess: boolean;
  demoToken: string;
  proctoringEnabled: boolean;
  theme: TrainingSlideshowTheme;
  branding: TrainingBrandingSettings;
  // Group Training Hall configuration (only used when deliveryType === "group").
  deliveryType: "one_on_one" | "group";
  groupCapacity: number;
  groupStartTime: string;
  groupEndTime: string;
  groupMinParticipants: number;
  groupGraceMins: number;
  groupMinAttendancePct: number;
  groupMaxSpeakSecs: number;
  groupMaxQuestionsPerTrainee: number;
};

type TrainingWorkspaceProps = {
  role: WorkspaceRole;
  sessionName: string;
  sessionEmail?: string;
  sessionImage?: string;
  roleLabel?: string;
  usedCredits?: number;
  totalCredits?: number;
  permission: string[];
  allowed: string[];
  onSignOut: () => void;
};

type TrainingCapacityResponse = {
  trainings: number;
  trainingLimit: number | null;
  canCreateTraining: boolean;
  reason?: string | null;
};

type TrainingBuilderProps = {
  currentUserName: string;
  initialTraining: TrainingWorkspaceRecord | null;
  initialStep: number;
  onCancel: () => void;
  onGoDashboard: () => void;
  onPersist: (training: TrainingWorkspaceRecord) => void;
};

type TrainingDetailProps = {
  role: WorkspaceRole;
  training: TrainingWorkspaceRecord;
  sessionName: string;
  permission: string[];
  detailTab: DetailTab;
  onBack: () => void;
  onGoDashboard: () => void;
  onChangeTab: (tab: DetailTab) => void;
  onEditTraining: () => void;
  onDeleteTraining: () => void;
};

const buildAssignedTrainingSession = (training: TrainingWorkspaceRecord, trainee: UserRecord): TrainingSessionRecord => ({
  id: `assigned-${training.id}-${trainee.id}`,
  ssoId: trainee.email,
  learnerName: trainee.name,
  learnerEmail: trainee.email,
  status: "not-started",
  timeSpent: "0m 00s",
  slidesViewed: 0,
  totalSlides: training.slides.length,
  viewedSlideIds: [],
  score: null,
  startedAt: null,
  completedAt: null,
  correctAnswers: 0,
  totalQuestions: training.questionCheckpoints?.length ?? 0,
  progressPercent: 0,
  mode: "public",
  askHistory: [],
  proctoringReport: null,
});

type WorkspaceBreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

type ImportedUploadRecord = {
  id: string;
  fileName: string;
  kind: UploadRecordKind;
  slideCount: number;
  slideIds: string[];
  assetIds: string[];
};

const trainingTypeOptions: TrainingType[] = ["Product", "Soft Skills", "Technical", "Compliance", "Other"];
const slideColorCycle = ["#3b82f6", "#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];
const ttsProviderOptions = [DEFAULT_ELEVENLABS_PROVIDER, "Google TTS", "Azure TTS", "Custom TTS"];

type ApiAvatarItem = {
  _id: string;
  avatarId: string;
  avatarName: string;
  avatarType: string;
  avatarEngine: string;
  image?: string;
  isShared?: boolean;
};

const SARAH_DEFAULT_AVATAR: ApiAvatarItem = {
  _id: "sarah-westpac-default",
  avatarId: "1647619895205577317",
  avatarName: "Sarah (Westpac demo)",
  avatarType: "2D",
  avatarEngine: "Unity",
  image: "",
  isShared: true,
};

const AMARA_API_BASE = "https://amara.brenin.co:3000";
const AMARA_API_KEY = "trainup_ext_9f8c7b6a5e4d3c2b1a0f9e8d7c6b5a4";

const defaultAvatarEngineConfig: TrainingAvatarEngineConfig = {
  provider: "Trulience",
  framework: "Large Language Model",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.3-70b-versatile",
  prompt:
    "You are a helpful assistant working for Trainup. Your name is Amara, a girl. Keep your responses between 16 and 35 words. Your words will be spoken by a voice agent so avoid the use of mark-up language, asterisks and emojis. Only speak in understandable sentences. Do not describe in words any facial expressions you might have. When talking about yourself always talk in the first person. your conversation always in female indian pronouciations.",
  memoryEnabled: true,
  sttProvider: "Trulience",
  language: "english (india)(en-IN)",
  additionalLanguages: ["Hindi (India)"],
  avatarId: "1647619895205577317",
  engineType: "Large Language Model",
};

const defaultSlideshowTheme: TrainingSlideshowTheme = {
  primaryBg: "#1a73e8",
  primaryBgHover: "#1557b0",
  primaryBorder: "#1a73e8",
  primaryBorderHover: "#1557b0",
  primaryText: "#ffffff",
  primaryTextHover: "#ffffff",
  secondaryBg: "#dcdde0",
  secondaryBgHover: "#e5e7eb",
  secondaryBorder: "#e2e2e2",
  secondaryBorderHover: "#999999",
  secondaryText: "#000000",
  secondaryTextHover: "#000000",
  bgColor: "#000000",
  avatarBorderStyle: "None",
  avatarBoxBg: "transparent",
  avatarAspectRatio: "Auto (default)",
  buttonRadius: "large",
  primaryFillMode: "solid",
  primaryGradientFrom: "#1a73e8",
  primaryGradientTo: "#1557b0",
  primaryGradientDirection: "to right",
  buttonFontFamily: "Manrope",
  buttonFontWeight: "500",
  buttonFontSize: "md",
};

const defaultTrainingBranding: TrainingBrandingSettings = {
  applicationName: "Trainup",
  companyName: "Trainup Retail India",
  supportEmail: "support@samsung.com",
  logoUrl: "",
  faviconUrl: "",
  loaderTitle: "Preparing Training",
  loaderCaption: "Camera verification and session checks are in progress.",
};

const brandPresetStorageKey = "trainup-brand-theme-presets";

const brandRadiusOptions: Array<{ value: TrainingButtonRadiusPreset; label: string }> = [
  { value: "zero", label: "Zero Radius" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "pill", label: "Fully Rounded" },
];

const gradientDirectionOptions: Array<{ value: TrainingGradientDirection; label: string }> = [
  { value: "to right", label: "Left to Right" },
  { value: "to left", label: "Right to Left" },
  { value: "to bottom", label: "Top to Bottom" },
  { value: "to top", label: "Bottom to Top" },
  { value: "135deg", label: "Diagonal" },
];

const buttonFontFamilyOptions: Array<{ value: TrainingFontFamilyPreset; label: string }> = [
  { value: "Manrope", label: "Modern Sans" },
  { value: "Poppins", label: "Geometric" },
  { value: "System", label: "System UI" },
];

const buttonFontWeightOptions: Array<{ value: TrainingFontWeightPreset; label: string }> = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];

const buttonFontSizeOptions: Array<{ value: TrainingFontSizePreset; label: string }> = [
  { value: "sm", label: "Compact" },
  { value: "md", label: "Balanced" },
  { value: "lg", label: "Comfortable" },
];

const brandThemePresets: Array<{ id: string; label: string; description: string; theme: TrainingSlideshowTheme }> = [
  {
    id: "Trainup-blue",
    label: "Trainup Blue",
    description: "Professional default",
    theme: {
      ...defaultSlideshowTheme,
      primaryBg: "#1428a0",
      primaryBgHover: "#10217f",
      primaryBorder: "#1428a0",
      primaryBorderHover: "#10217f",
      primaryGradientFrom: "#1428a0",
      primaryGradientTo: "#1f49d8",
      secondaryBg: "#eef2ff",
      secondaryBgHover: "#dfe7ff",
      secondaryBorder: "#c7d2fe",
      secondaryBorderHover: "#a5b4fc",
      secondaryText: "#10217f",
      secondaryTextHover: "#10217f",
      bgColor: "#07111f",
      buttonRadius: "large",
      primaryFillMode: "gradient",
      buttonFontFamily: "Manrope",
      buttonFontWeight: "500",
      buttonFontSize: "md",
    },
  },
  {
    id: "slate-pro",
    label: "Slate Pro",
    description: "Neutral enterprise",
    theme: {
      ...defaultSlideshowTheme,
      primaryBg: "#0f172a",
      primaryBgHover: "#1e293b",
      primaryBorder: "#0f172a",
      primaryBorderHover: "#1e293b",
      primaryGradientFrom: "#0f172a",
      primaryGradientTo: "#334155",
      secondaryBg: "#e2e8f0",
      secondaryBgHover: "#cbd5e1",
      secondaryBorder: "#cbd5e1",
      secondaryBorderHover: "#94a3b8",
      secondaryText: "#0f172a",
      secondaryTextHover: "#0f172a",
      bgColor: "#020617",
      primaryFillMode: "solid",
      buttonRadius: "medium",
    },
  },
  {
    id: "emerald-flow",
    label: "Emerald Flow",
    description: "Fresh support theme",
    theme: {
      ...defaultSlideshowTheme,
      primaryBg: "#0f766e",
      primaryBgHover: "#0d5e58",
      primaryBorder: "#0f766e",
      primaryBorderHover: "#0d5e58",
      primaryGradientFrom: "#0f766e",
      primaryGradientTo: "#14b8a6",
      secondaryBg: "#ecfeff",
      secondaryBgHover: "#cffafe",
      secondaryBorder: "#99f6e4",
      secondaryBorderHover: "#5eead4",
      secondaryText: "#115e59",
      secondaryTextHover: "#115e59",
      bgColor: "#052625",
      primaryFillMode: "gradient",
      buttonRadius: "pill",
    },
  },
];

const readStoredBrandPresets = () => {
  if (typeof window === "undefined") {
    return [] as SavedBrandPreset[];
  }

  try {
    const raw = window.localStorage.getItem(brandPresetStorageKey);
    if (!raw) {
      return [] as SavedBrandPreset[];
    }

    const parsed = JSON.parse(raw) as SavedBrandPreset[];
    return Array.isArray(parsed)
      ? parsed
        .filter((item) => item && typeof item === "object" && item.theme)
        .map((item, index) => ({
          id: item.id || `preset-${index}`,
          name: item.name || `Saved Theme ${index + 1}`,
          description: item.description || "Saved preset",
          theme: item.theme,
        }))
      : [];
  } catch {
    return [] as SavedBrandPreset[];
  }
};

type SavedBrandPreset = {
  id: string;
  name: string;
  description?: string;
  theme: TrainingSlideshowTheme;
};

const resolveThemeButtonRadius = (radius: TrainingButtonRadiusPreset) => {
  switch (radius) {
    case "zero":
      return "0";
    case "small":
      return "0.65rem";
    case "medium":
      return "0.9rem";
    case "pill":
      return "999px";
    case "large":
    default:
      return "1.15rem";
  }
};

const resolveThemeButtonFontFamily = (fontFamily: TrainingFontFamilyPreset) => {
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

const resolveThemeButtonFontSize = (fontSize: TrainingFontSizePreset) => {
  switch (fontSize) {
    case "sm":
      return "0.92rem";
    case "lg":
      return "1.06rem";
    case "md":
    default:
      return "0.98rem";
  }
};

const resolveThemePrimaryBackground = (theme: TrainingSlideshowTheme) =>
  theme.primaryFillMode === "gradient"
    ? `linear-gradient(${theme.primaryGradientDirection}, ${theme.primaryGradientFrom}, ${theme.primaryGradientTo})`
    : theme.primaryBg;

const resolveThemePrimaryHoverBackground = (theme: TrainingSlideshowTheme) =>
  theme.primaryFillMode === "gradient"
    ? `linear-gradient(${theme.primaryGradientDirection}, ${theme.primaryBgHover}, ${theme.primaryGradientTo})`
    : theme.primaryBgHover;

const resolveThemeSecondaryBackground = (theme: TrainingSlideshowTheme) => theme.secondaryBg;

const defaultSlideSettings: TrainingSlideSettings = {
  avatarPosition: "Bottom Left",
  formPosition: "Opposite to Avatar (default)",
  desktopRespectSafeArea: true,
  desktopSizing: "Fit (show full media)",
  mobileRespectSafeArea: true,
  mobileSizing: "Fit (show full media)",
  waitForAudio: true,
  waitForVideo: false,
  autoAdvanceDelayMs: 2000,
  disableAutoAdvance: false,
  hidePauseButton: false,
  hideAskQuestionButton: false,
  hidePreviousButton: false,
  hideAutoplayButton: false,
  avatarInitiatesConversation: false,
};

const buildBlankQuestionGeneratorConfig = (
  config?: TrainingQuestionGeneratorConfig,
): TrainingQuestionGeneratorConfig => ({
  ...defaultTrainingQuestionGeneratorConfig,
  ...config,
  difficultyLevel:
    config?.difficultyLevel === "easy" || config?.difficultyLevel === "medium" || config?.difficultyLevel === "hard"
      ? config.difficultyLevel
      : defaultTrainingQuestionGeneratorConfig.difficultyLevel,
  topicTags: Array.isArray(config?.topicTags) && config.topicTags.length
    ? [...config.topicTags]
    : String((config as { topicFocus?: string } | undefined)?.topicFocus || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  selectedSourceIds:
    config?.selectedSourceIds?.length
      ? [...config.selectedSourceIds]
      : [...defaultTrainingQuestionGeneratorConfig.selectedSourceIds],
  activeSetId: config?.activeSetId ?? defaultTrainingQuestionGeneratorConfig.activeSetId,
  generationMode: "ai_planned_v2",
  minimumQuestionsPerSet: Math.min(5, Math.max(3, Number(config?.minimumQuestionsPerSet ?? defaultTrainingQuestionGeneratorConfig.minimumQuestionsPerSet))),
  maximumQuestionsPerSet: Math.min(
    5,
    Math.max(
      Math.min(5, Math.max(3, Number(config?.minimumQuestionsPerSet ?? defaultTrainingQuestionGeneratorConfig.minimumQuestionsPerSet))),
      Number(config?.maximumQuestionsPerSet ?? defaultTrainingQuestionGeneratorConfig.maximumQuestionsPerSet),
    ),
  ),
  preferredQuestionTypes:
    config?.preferredQuestionTypes?.length
      ? [...config.preferredQuestionTypes]
      : [...(defaultTrainingQuestionGeneratorConfig.preferredQuestionTypes ?? [])],
});

const cloneQuestionCheckpoints = (checkpoints?: TrainingQuestionCheckpoint[]) =>
  (checkpoints ?? []).map((checkpoint) => ({
    ...checkpoint,
    options: [...checkpoint.options],
    keywordMatches: [...checkpoint.keywordMatches],
    sourceIds: [...checkpoint.sourceIds],
    sourceLabels: [...checkpoint.sourceLabels],
    topicTags: [...(checkpoint.topicTags ?? [])],
  }));

const cloneQuestionSets = (questionSets?: TrainingQuestionSetRecord[]): TrainingQuestionSetRecord[] =>
  (questionSets ?? []).map((questionSet) => ({
    ...questionSet,
    isMandatory: questionSet.isMandatory ?? true,
    topicTags: [...(questionSet.topicTags ?? [])],
    sourceIds: [...(questionSet.sourceIds ?? [])],
    sourceLabels: [...(questionSet.sourceLabels ?? [])],
    checkpoints: cloneQuestionCheckpoints(questionSet.checkpoints),
  }));

const cloneKnowledgeDocuments = (documents?: TrainingKnowledgeDocument[]) =>
  (documents ?? []).map((document) => ({
    ...document,
  }));

const questionDifficultyOptions: Array<{
  value: TrainingQuestionDifficulty;
  label: string;
}> = [
    { value: "easy", label: "Easy" },
    { value: "medium", label: "Medium" },
    { value: "hard", label: "Hard" },
  ];

const editableQuestionTypes = ["objective", "multi_select", "subjective", "text_area"] as TrainingQuestionCheckpoint["questionType"][];

const normalizeQuestionTopicTags = (tags?: string[]) =>
  Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => String(tag || "").trim())
        .filter(Boolean),
    ),
  );

const buildQuestionSetLabel = (_slideTitle: string, versionNumber: number) =>
  `Question Set ${versionNumber}`;

const isChoiceQuestionType = (questionType: TrainingQuestionCheckpoint["questionType"]) =>
  questionType === "objective" || questionType === "multi_select";

const buildQuestionEditDraft = (checkpoint: TrainingQuestionCheckpoint): QuestionEditDraft => ({
  prompt: checkpoint.prompt,
  questionType: checkpoint.questionType,
  options: checkpoint.options.length ? [...checkpoint.options] : ["", ""],
});

const deriveGeneratedQuestionTypes = (checkpoints: TrainingQuestionCheckpoint[]) =>
  Array.from(new Set(checkpoints.map((checkpoint) => checkpoint.questionType)));

const formatQuestionSetPlacement = ({
  placementMode,
  slideTitle,
}: {
  placementMode: TrainingQuestionCheckpoint["placementMode"];
  slideTitle?: string;
}) => {
  if (placementMode === "end_of_training") {
    return "At the end of training";
  }

  return `${placementMode === "before_slide" ? "Before" : "After"} ${slideTitle || "selected slide"}`;
};

const applyQuestionSetMetadata = (
  checkpoints: TrainingQuestionCheckpoint[],
  metadata: {
    setId: string;
    setLabel: string;
    placementMode: TrainingQuestionCheckpoint["placementMode"];
    slideId?: string | null;
    slideTitle?: string;
    difficultyLevel: TrainingQuestionDifficulty;
    topicTags: string[];
  },
) => {
  const topicFocus = metadata.topicTags.join(", ");

  return cloneQuestionCheckpoints(checkpoints).map((checkpoint) => ({
    ...checkpoint,
    difficultyLevel: metadata.difficultyLevel,
    topicFocus,
    topicTags: [...metadata.topicTags],
    generationSetId: metadata.setId,
    generationSetLabel: metadata.setLabel,
    placementMode: metadata.placementMode,
    placementSlideId: metadata.placementMode === "end_of_training" ? null : metadata.slideId ?? null,
  }));
};

const buildQuestionSetRecord = ({
  setId,
  label,
  placementMode,
  slideId,
  slideTitle,
  difficultyLevel,
  topicTags,
  checkpoints,
  sourceIds,
  sourceLabels,
  sourceSlideIds,
  sourceRangeLabel,
  plannerSummary,
  generatedQuestionTypes,
  generationStrategy,
  createdAt,
  updatedAt,
  isActive,
  isMandatory,
}: {
  setId: string;
  label: string;
  placementMode: TrainingQuestionCheckpoint["placementMode"];
  slideId?: string | null;
  slideTitle?: string;
  difficultyLevel: TrainingQuestionDifficulty;
  topicTags: string[];
  checkpoints: TrainingQuestionCheckpoint[];
  sourceIds?: string[];
  sourceLabels?: string[];
  sourceSlideIds?: string[];
  sourceRangeLabel?: string;
  plannerSummary?: string;
  generatedQuestionTypes?: TrainingQuestionCheckpoint["questionType"][];
  generationStrategy?: "ai_planned" | "manual";
  createdAt: string;
  updatedAt: string;
  isActive?: boolean;
  isMandatory?: boolean;
}): TrainingQuestionSetRecord => {
  const normalizedTags = normalizeQuestionTopicTags(topicTags);
  const normalizedCheckpoints = applyQuestionSetMetadata(checkpoints, {
    setId,
    setLabel: label,
    placementMode,
    slideId,
    slideTitle,
    difficultyLevel,
    topicTags: normalizedTags,
  });

  return {
    id: setId,
    label,
    placementMode,
    slideId: slideId ?? null,
    slideTitle: slideTitle || "",
    isMandatory: isMandatory ?? true,
    difficultyLevel,
    topicTags: normalizedTags,
    sourceIds: sourceIds?.length ? [...sourceIds] : Array.from(new Set(normalizedCheckpoints.flatMap((checkpoint) => checkpoint.sourceIds))),
    sourceLabels: sourceLabels?.length ? [...sourceLabels] : Array.from(new Set(normalizedCheckpoints.flatMap((checkpoint) => checkpoint.sourceLabels))),
    questionCount: normalizedCheckpoints.length,
    sourceSlideIds: sourceSlideIds?.length ? [...sourceSlideIds] : Array.from(new Set(normalizedCheckpoints.map((checkpoint) => checkpoint.originSlideId || "").filter(Boolean))),
    sourceRangeLabel: sourceRangeLabel || "",
    plannerSummary: plannerSummary || "",
    generatedQuestionTypes:
      generatedQuestionTypes?.length
        ? [...generatedQuestionTypes]
        : Array.from(new Set(normalizedCheckpoints.map((checkpoint) => checkpoint.questionType))),
    generationStrategy: generationStrategy || (normalizedCheckpoints.some((checkpoint) => checkpoint.generatedBy === "manual") ? "manual" : "ai_planned"),
    createdAt,
    updatedAt,
    isActive: Boolean(isActive),
    checkpoints: normalizedCheckpoints,
  };
};

const deriveQuestionSetState = (
  training?: TrainingWorkspaceRecord,
  slides?: TrainingSlideRecord[],
) => {
  const normalizedSets = cloneQuestionSets(training?.questionSets);

  if (normalizedSets.length) {
    const activeSetId =
      normalizedSets.find((questionSet) => questionSet.isActive)?.id ||
      training?.questionGeneratorConfig?.activeSetId ||
      normalizedSets[0].id;

    const activeSet = normalizedSets.find((questionSet) => questionSet.id === activeSetId) ?? normalizedSets[0];
    return {
      questionSets: normalizedSets.map((questionSet) => ({
        ...questionSet,
        isActive: questionSet.id === activeSet.id,
      })),
      activeSetId: activeSet.id,
      activeCheckpoints: cloneQuestionCheckpoints(activeSet.checkpoints),
    };
  }

  const checkpoints = cloneQuestionCheckpoints(training?.questionCheckpoints);

  if (!checkpoints.length) {
    return {
      questionSets: [] as TrainingQuestionSetRecord[],
      activeSetId: null as string | null,
      activeCheckpoints: [] as TrainingQuestionCheckpoint[],
    };
  }

  const firstPlacementSlide = slides?.find((slide) => slide.id === checkpoints[0]?.placementSlideId) ?? slides?.[0] ?? null;
  const now = new Date().toISOString();
  const fallbackSetId = checkpoints[0]?.generationSetId || `question-set-${Date.now()}`;
  const fallbackLabel =
    checkpoints[0]?.generationSetLabel || buildQuestionSetLabel(firstPlacementSlide?.title || "Training Slide", 1);
  const fallbackDifficulty = (checkpoints[0]?.difficultyLevel as TrainingQuestionDifficulty | undefined) || "medium";
  const fallbackTopicTags = normalizeQuestionTopicTags([
    ...(checkpoints[0]?.topicTags ?? []),
    ...String(checkpoints[0]?.topicFocus || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ]);
  const fallbackSet = buildQuestionSetRecord({
    setId: fallbackSetId,
    label: fallbackLabel,
    placementMode: checkpoints[0]?.placementMode || "after_slide",
    slideId: checkpoints[0]?.placementSlideId ?? firstPlacementSlide?.id ?? null,
    slideTitle: firstPlacementSlide?.title ?? "",
    difficultyLevel: fallbackDifficulty,
    topicTags: fallbackTopicTags,
    checkpoints,
    createdAt: now,
    updatedAt: now,
    isActive: true,
  });

  return {
    questionSets: [fallbackSet],
    activeSetId: fallbackSet.id,
    activeCheckpoints: cloneQuestionCheckpoints(fallbackSet.checkpoints),
  };
};

const getFileStem = (value: string) => value.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
const getFileExtension = (value: string) => value.split(".").pop()?.toLowerCase() ?? "";

const buildSlidePoints = (slideTitle: string, mediaLabel: string, extractedText?: string[]) => {
  return buildSlidePointsFromSource(slideTitle || mediaLabel, extractedText);
};

const buildAvatarEngineFromValues = (values: TrainingSetupValues): TrainingAvatarEngineConfig => ({
  ...defaultAvatarEngineConfig,
  baseUrl: values.avatarEngineBaseUrl.trim() || defaultAvatarEngineConfig.baseUrl,
  model: values.avatarEngineModel.trim() || defaultAvatarEngineConfig.model,
  prompt: values.avatarEnginePrompt.trim() || defaultAvatarEngineConfig.prompt,
  memoryEnabled: values.avatarEngineMemoryEnabled,
  sttProvider: values.avatarEngineSttProvider.trim() || defaultAvatarEngineConfig.sttProvider,
  language: values.avatarEngineLanguage.trim() || defaultAvatarEngineConfig.language,
  additionalLanguages: values.avatarEngineAdditionalLanguages
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  avatarId: values.avatarEngineAvatarId.trim() || defaultAvatarEngineConfig.avatarId,
});

// Parses print-dialog-style page range input ("1-10, 45-50, 48") into a set of
// 1-based slide numbers, clamped to the deck size, for the Step 2 range selector.
const parseSlideRangeSelection = (input: string, totalSlides: number): Set<number> => {
  const positions = new Set<number>();

  input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);

      if (rangeMatch) {
        const start = Math.max(1, Math.min(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10)));
        const end = Math.min(totalSlides, Math.max(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10)));

        for (let position = start; position <= end; position += 1) {
          positions.add(position);
        }

        return;
      }

      const single = parseInt(part, 10);

      if (!Number.isNaN(single) && single >= 1 && single <= totalSlides) {
        positions.add(single);
      }
    });

  return positions;
};

const buildSlideFromImportedMedia = ({
  asset,
  slideIndex,
  slideTitle,
}: {
  asset: SlideMediaImportRecord;
  slideIndex: number;
  slideTitle?: string;
}): TrainingSlideRecord => {
  const normalizedLabel = getFileStem(asset.name) || `Slide ${slideIndex + 1}`;
  const title = slideTitle || asset.extractedText[0] || normalizedLabel;

  return {
    id: `generated-slide-${Date.now()}-${slideIndex}`,
    title,
    color: slideColorCycle[slideIndex % slideColorCycle.length],
    mediaName: asset.name,
    mediaAssetId: asset.id,
    mediaSource: asset.source,
    mediaPageNumber: asset.pageNumber,
    mediaMimeType: asset.mimeType,
    mediaExtractedText: asset.extractedText,
    interactiveHotspots: asset.interactiveHotspots ?? [],
    script: "",
    points: buildSlidePoints(title, normalizedLabel, asset.extractedText),
    uploaded: true,
    additionalInfo: "",
    narrationAudio: null,
    formFields: [],
    formConfig: { ...defaultFormConfig },
    settings: { ...defaultSlideSettings },
    removedMedia: null,
    comments: [],
  };
};

// Reconstructs the "uploaded deck" summary cards (fileName/kind/slideCount) for
// an already-saved training's slides, so the Upload Slides step shows the
// previously imported PDF/PPTX instead of appearing empty on re-edit — the
// import batch itself isn't persisted, only the per-slide media it produced.
const getUploadBatchStem = (mediaName: string, source: TrainingSlideMediaSource) => {
  const suffix = source === "pdf_page" ? /-page-\d+\.[a-z0-9]+$/i : /-slide-\d+\.[a-z0-9]+$/i;
  const stripped = mediaName.replace(suffix, "");
  return stripped || getFileStem(mediaName);
};

const deriveUploadedFilesFromSlides = (slides: TrainingSlideRecord[]): ImportedUploadRecord[] => {
  const batches: ImportedUploadRecord[] = [];
  const batchIndexByKey = new Map<string, number>();

  slides.forEach((slide) => {
    if ((slide.mediaSource !== "pdf_page" && slide.mediaSource !== "ppt_slide") || !slide.mediaName) {
      return;
    }

    const kind: UploadRecordKind = slide.mediaSource === "pdf_page" ? "pdf" : "ppt";
    const stem = getUploadBatchStem(slide.mediaName, slide.mediaSource);
    const key = `${kind}:${stem}`;
    const existingIndex = batchIndexByKey.get(key);

    if (existingIndex !== undefined) {
      const batch = batches[existingIndex];
      batch.slideCount += 1;
      batch.slideIds.push(slide.id);
      if (slide.mediaAssetId) {
        batch.assetIds.push(slide.mediaAssetId);
      }
      return;
    }

    batchIndexByKey.set(key, batches.length);
    batches.push({
      id: `existing-upload-${key}`,
      fileName: `${stem}.${kind === "pdf" ? "pdf" : "pptx"}`,
      kind,
      slideCount: 1,
      slideIds: [slide.id],
      assetIds: slide.mediaAssetId ? [slide.mediaAssetId] : [],
    });
  });

  return batches;
};

const statusConfig: Record<TrainingStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-bg-secondary" },
  review: { label: "Awaiting Review", className: "text-bg-warning" },
  changes_requested: { label: "Changes Requested", className: "text-bg-danger" },
  approved: { label: "Approved", className: "text-bg-success" },
};

const renderTrainingStatusBadge = (status: TrainingStatus, extraClassName = "") => (
  <span className={`badge ${statusConfig[status].className} ${extraClassName}`.trim()}>
    {statusConfig[status].label}
  </span>
);

const primaryThemeFields: Array<{ label: string; key: keyof TrainingSlideshowTheme }> = [
  { label: "Background", key: "primaryBg" },
  { label: "Background Hover", key: "primaryBgHover" },
  { label: "Border", key: "primaryBorder" },
  { label: "Border Hover", key: "primaryBorderHover" },
  { label: "Text", key: "primaryText" },
  { label: "Text Hover", key: "primaryTextHover" },
];

const secondaryThemeFields: Array<{ label: string; key: keyof TrainingSlideshowTheme }> = [
  { label: "Background", key: "secondaryBg" },
  { label: "Background Hover", key: "secondaryBgHover" },
  { label: "Border", key: "secondaryBorder" },
  { label: "Border Hover", key: "secondaryBorderHover" },
  { label: "Text", key: "secondaryText" },
  { label: "Text Hover", key: "secondaryTextHover" },
];

const builderValidationSchema = Yup.object({
  title: Yup.string().min(4, "Use at least 4 characters.").required("Training title is required."),
  type: Yup.string().required("Training type is required."),
  typeCustom: Yup.string().when("type", {
    is: "Other",
    then: (schema) => schema.trim().min(2, "Use at least 2 characters.").required("Custom training type is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  trainingMode: Yup.string().oneOf(["avatar", "voice"]).required("Training mode is required."),
  // Group Training Hall settings are mandatory when Delivery Type = group.
  deliveryType: Yup.string().oneOf(["one_on_one", "group"]).required(),
  groupStartTime: Yup.string().when("deliveryType", {
    is: "group",
    then: (schema) => schema.required("Start time is required for group training."),
    otherwise: (schema) => schema.notRequired(),
  }),
  groupCapacity: Yup.number().when("deliveryType", {
    is: "group",
    then: (schema) => schema.min(1, "Capacity must be at least 1.").required("Session capacity is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  groupMinParticipants: Yup.number().when("deliveryType", {
    is: "group",
    then: (schema) => schema.min(0, "Use 0 or more.").required("Min participants is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  groupGraceMins: Yup.number().when("deliveryType", {
    is: "group",
    then: (schema) => schema.min(0, "Use 0 or more minutes.").required("Auto-start grace is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  groupMinAttendancePct: Yup.number().when("deliveryType", {
    is: "group",
    then: (schema) => schema.min(0).max(100).required("Min attendance % is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  groupMaxSpeakSecs: Yup.number().when("deliveryType", {
    is: "group",
    then: (schema) => schema.min(10, "At least 10 seconds.").required("Max speak seconds is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  groupMaxQuestionsPerTrainee: Yup.number().when("deliveryType", {
    is: "group",
    then: (schema) => schema.min(1, "At least 1 question.").required("Max questions per trainee is required."),
    otherwise: (schema) => schema.notRequired(),
  }),
  avatarName: Yup.string().required("Avatar is required."),
  voiceName: Yup.string().required("Voice is required."),
  manualApiKey: Yup.string().when(["ttsMode", "ttsProvider"], {
    is: (ttsMode: TrainingTtsMode) => ttsMode === "manual",
    then: (schema) => schema.required("TTS API key is required in manual mode."),
    otherwise: (schema) => schema.notRequired(),
  }),
  manualApiKeyVerifiedAt: Yup.string().when(["ttsMode", "ttsProvider"], {
    is: (ttsMode: TrainingTtsMode, ttsProvider: string) =>
      ttsMode === "manual" && ttsProvider === DEFAULT_ELEVENLABS_PROVIDER,
    then: (schema) => schema.required("Verify the manual ElevenLabs API key before continuing."),
    otherwise: (schema) => schema.notRequired(),
  }),
  durationMins: Yup.number().min(5, "Minimum 5 minutes.").required("Duration is required."),
  maxAttempts: Yup.number().min(1, "At least 1 attempt is required.").required("Max attempts is required."),
  questionButtonLabel: Yup.string().max(15, "Keep the label under 15 characters.").required("Button label is required."),
  askSystemPrompt: Yup.string().max(5000, "Keep the prompt under 5000 characters.").required("Ask assistant prompt is required."),
  theme: Yup.object({
    primaryFillMode: Yup.string().oneOf(["solid", "gradient"]).required("Primary button style is required."),
    primaryBg: Yup.string().required("Primary background is required."),
    primaryBgHover: Yup.string().required("Primary hover background is required."),
    primaryBorder: Yup.string().required("Primary border is required."),
    primaryBorderHover: Yup.string().required("Primary hover border is required."),
    primaryText: Yup.string().required("Primary text colour is required."),
    primaryTextHover: Yup.string().required("Primary hover text colour is required."),
    secondaryBg: Yup.string().required("Secondary background is required."),
    secondaryBgHover: Yup.string().required("Secondary hover background is required."),
    secondaryBorder: Yup.string().required("Secondary border is required."),
    secondaryBorderHover: Yup.string().required("Secondary hover border is required."),
    secondaryText: Yup.string().required("Secondary text colour is required."),
    secondaryTextHover: Yup.string().required("Secondary hover text colour is required."),
    bgColor: Yup.string().required("Launch surface background is required."),
    avatarBoxBg: Yup.string().required("Avatar panel background is required."),
    buttonRadius: Yup.string().oneOf(["zero", "small", "medium", "large", "pill"]).required("Button radius is required."),
    buttonFontFamily: Yup.string().oneOf(["System", "Poppins", "Manrope"]).required("Button font family is required."),
    buttonFontWeight: Yup.string().oneOf(["400", "500", "600", "700"]).required("Button font weight is required."),
    buttonFontSize: Yup.string().oneOf(["sm", "md", "lg"]).required("Button font size is required."),
    primaryGradientFrom: Yup.string().when("primaryFillMode", {
      is: "gradient",
      then: (schema) => schema.required("Gradient start colour is required."),
      otherwise: (schema) => schema.notRequired(),
    }),
    primaryGradientTo: Yup.string().when("primaryFillMode", {
      is: "gradient",
      then: (schema) => schema.required("Gradient end colour is required."),
      otherwise: (schema) => schema.notRequired(),
    }),
    primaryGradientDirection: Yup.string().when("primaryFillMode", {
      is: "gradient",
      then: (schema) => schema.required("Gradient direction is required."),
      otherwise: (schema) => schema.notRequired(),
    }),
  }).required("Theme configuration is required."),
});

const getTodayLabel = () =>
  new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

// <input type="datetime-local"> yields a timezone-naive local wall-clock string
// (e.g. "2026-06-10T16:00"). We must convert it to a real UTC instant in the
// BROWSER (where the admin's local timezone applies) before storing — otherwise
// the backend parses the naive string in the SERVER timezone (UTC in prod) and
// the scheduled time shifts by the admin's offset.
const localInputToIso = (value: string): string | null => {
  if (!value) return null;
  const d = new Date(value); // interpreted in the admin's local timezone
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Convert a stored UTC ISO back to the local "YYYY-MM-DDTHH:mm" the input needs.
const isoToLocalInput = (value?: string | null): string => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const buildTrainingLaunchPath = (trainingId: string, preview = false) => {
  const path = withBase(`/slideshows/${String(trainingId || "").toLowerCase()}`);
  return preview ? `${path}?preview=1` : path;
};

const buildTrainingLaunchUrl = (trainingId: string, preview = false) =>
  typeof window === "undefined"
    ? buildTrainingLaunchPath(trainingId, preview)
    : `${window.location.origin}${buildTrainingLaunchPath(trainingId, preview)}`;

const buildDefaultSetupValues = (
  training: TrainingWorkspaceRecord | null,
  avatarOptions: ApiAvatarItem[],
): TrainingSetupValues => ({
  title: training?.title ?? "",
  type: training?.type && trainingTypeOptions.includes(training.type) ? training.type : training?.type ? "Other" : "Product",
  typeCustom: training?.type && !trainingTypeOptions.includes(training.type) ? training.type : "",
  audience: training?.audience ?? "All Learners",
  trainingMode: training?.trainingMode ?? "avatar",
  avatarName: training?.avatarName ?? avatarOptions[0]?.avatarName ?? "",
  avatarId: training?.avatarId ?? avatarOptions[0]?.avatarId ?? "",
  ttsMode: training?.ttsMode ?? "auto",
  ttsProvider: training?.ttsProvider ?? DEFAULT_ELEVENLABS_PROVIDER,
  voiceName: training?.voiceName ?? DEFAULT_ELEVENLABS_VOICE_NAME,
  voiceId: training?.voiceId ?? "auto",
  manualApiKey: training?.manualTtsApiKey ?? "",
  manualApiKeyVerifiedAt: training?.manualTtsApiKeyVerifiedAt ?? "",
  presenterNotes: training?.presenterNotes ?? "Focus on key selling points for Trainup field sales reps.",
  questionButtonLabel: training?.questionButtonLabel ?? "Ask Question",
  askSystemPrompt: training?.askSystemPrompt ?? training?.avatarEngine?.prompt ?? defaultAvatarEngineConfig.prompt,
  avatarEngineBaseUrl: training?.avatarEngine?.baseUrl ?? defaultAvatarEngineConfig.baseUrl,
  avatarEngineModel: training?.avatarEngine?.model ?? defaultAvatarEngineConfig.model,
  avatarEnginePrompt: training?.avatarEngine?.prompt ?? defaultAvatarEngineConfig.prompt,
  avatarEngineMemoryEnabled: training?.avatarEngine?.memoryEnabled ?? defaultAvatarEngineConfig.memoryEnabled,
  avatarEngineSttProvider: training?.avatarEngine?.sttProvider ?? defaultAvatarEngineConfig.sttProvider,
  avatarEngineLanguage: training?.avatarEngine?.language ?? defaultAvatarEngineConfig.language,
  avatarEngineAdditionalLanguages: (training?.avatarEngine?.additionalLanguages ?? defaultAvatarEngineConfig.additionalLanguages).join(", "),
  avatarEngineAvatarId: training?.avatarEngine?.avatarId ?? defaultAvatarEngineConfig.avatarId,
  durationMins: training?.durationMins ?? 30,
  maxDurationMins: training?.maxDurationMins ?? 60,
  idleRefreshMins: training?.idleRefreshMins ? String(training.idleRefreshMins) : "",
  allowSkipAhead: training?.options.allowSkipAhead ?? true,
  allowMultipleAttempts: training?.options.allowMultipleAttempts ?? true,
  maxAttempts: Math.max(1, Number(training?.options.maxAttempts) || 1),
  showProgressBar: training?.options.showProgressBar ?? true,
  showSubtitles: training?.options.showSubtitles ?? false,
  disablePreviousButton: training?.options.disablePreviousButton ?? false,
  enableReviewMode: training?.options.enableReviewMode ?? false,
  markAnswersInRealTime: training?.options.markAnswersInRealTime ?? false,
  showMarksInProgressBar: training?.options.showMarksInProgressBar ?? false,
  showFinalScore: training?.options.showFinalScore ?? false,
  allowPublicDemoAccess: training?.options.allowPublicDemoAccess ?? false,
  demoToken: training?.options.demoToken ?? "",
  proctoringEnabled: training?.options.proctoringEnabled ?? true,
  theme: training?.theme ? { ...defaultSlideshowTheme, ...training.theme } : { ...defaultSlideshowTheme },
  branding: training?.branding ? { ...defaultTrainingBranding, ...training.branding } : { ...defaultTrainingBranding },
  deliveryType: training?.trainingType === "group" ? "group" : "one_on_one",
  groupCapacity: training?.groupConfig?.capacity ?? 50,
  groupStartTime: isoToLocalInput(training?.groupConfig?.startTime),
  groupEndTime: isoToLocalInput(training?.groupConfig?.endTime),
  groupMinParticipants: training?.groupConfig?.autoStart?.minParticipants ?? 1,
  groupGraceMins: training?.groupConfig?.autoStart?.graceMins ?? 15,
  groupMinAttendancePct: training?.groupConfig?.attendanceRules?.minAttendancePct ?? 75,
  groupMaxSpeakSecs: training?.groupConfig?.qaRules?.maxSpeakSecs ?? 90,
  groupMaxQuestionsPerTrainee: training?.groupConfig?.qaRules?.maxQuestionsPerTrainee ?? 3,
});

const ensureSlideSettings = (settings?: TrainingSlideSettings): TrainingSlideSettings => ({
  ...defaultSlideSettings,
  ...settings,
});

const ensureFormConfig = (config?: TrainingFormConfig): TrainingFormConfig => ({
  ...defaultFormConfig,
  ...config,
});

const normalizeFieldType = (type: TrainingFieldType): TrainingFieldType => {
  switch (type) {
    case "short_text":
      return "text";
    case "long_text":
      return "textarea";
    case "single_select":
      return "dropdown";
    case "audio":
      return "recording";
    case "video":
      return "media";
    default:
      return type;
  }
};

const normalizeVoiceLookup = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+\)/g, ")")
    .toLowerCase();

const buildVoiceOptionLabel = (voice: ElevenLabsVoiceOption) => {
  const metadata = [voice.gender, voice.age, voice.category].filter(Boolean).join(" • ");
  return metadata ? `${voice.name} (${metadata})` : voice.name;
};

const findMatchingVoice = (
  voices: ElevenLabsVoiceOption[],
  voiceId?: string | null,
  voiceName?: string | null,
) => {
  const normalizedVoiceId = String(voiceId || "").trim();
  const normalizedVoiceName = normalizeVoiceLookup(String(voiceName || ""));

  return (
    voices.find((voice) => normalizedVoiceId && voice.voiceId === normalizedVoiceId) ||
    voices.find((voice) => normalizedVoiceName && normalizeVoiceLookup(voice.name) === normalizedVoiceName) ||
    null
  );
};

const cloneFormField = (field: TrainingFormField): TrainingFormField => ({
  ...field,
  type: normalizeFieldType(field.type),
  options: field.options ? [...field.options] : undefined,
  cols: field.cols ? [...field.cols] : undefined,
});

const cloneSlides = (slides: TrainingSlideRecord[]) =>
  slides.map((slide) => ({
    ...slide,
    points: [...slide.points],
    narrationAudio: slide.narrationAudio ? { ...slide.narrationAudio } : null,
    formFields: slide.formFields.map(cloneFormField),
    formConfig: ensureFormConfig(slide.formConfig),
    settings: ensureSlideSettings(slide.settings),
    removedMedia: slide.removedMedia
      ? {
        ...slide.removedMedia,
        interactiveHotspots: [...(slide.removedMedia.interactiveHotspots ?? [])],
      }
      : null,
    interactiveHotspots: [...(slide.interactiveHotspots ?? [])],
    comments: slide.comments.map((comment) => ({ ...comment })),
  }));

const buildBlankSlide = (index: number): TrainingSlideRecord => ({
  id: `draft-slide-${Date.now()}-${index}`,
  title: `New Slide ${index + 1}`,
  color: slideColorCycle[index % slideColorCycle.length],
  mediaName: `slide-${index + 1}.png`,
  mediaAssetId: null,
  mediaSource: "image",
  mediaPageNumber: null,
  mediaMimeType: null,
  mediaExtractedText: [],
  interactiveHotspots: [],
  script: "",
  points: ["Add key point one", "Add key point two", "Add key point three"],
  uploaded: false,
  additionalInfo: "",
  narrationAudio: null,
  formFields: [],
  formConfig: { ...defaultFormConfig },
  settings: { ...defaultSlideSettings },
  removedMedia: null,
  comments: [],
});

type SupportedLocalizedLanguageOption = {
  code: string;
  locale: string;
  label: string;
};

const supportedLocalizedLanguageOptions: SupportedLocalizedLanguageOption[] = [
  { code: "en", locale: "en-IN", label: "English" },
  { code: "es", locale: "es-ES", label: "Spanish" },
  { code: "hi", locale: "hi-IN", label: "Hindi" },
  { code: "fr", locale: "fr-FR", label: "French" },
  { code: "de", locale: "de-DE", label: "German" },
  { code: "ar", locale: "ar-SA", label: "Arabic" },
  { code: "ta", locale: "ta-IN", label: "Tamil" },
  { code: "te", locale: "te-IN", label: "Telugu" },
];

const defaultLocalizedButtonLabels: TrainingLocalizedButtonLabels = {
  next: "Next",
  previous: "Previous",
  ask: "Ask Question",
};

const resolveLocaleFromLanguageValue = (value?: string | null) => {
  const normalized = String(value || "").trim();
  const match = normalized.match(/\(([a-z]{2}-[A-Z]{2})\)/);
  return match?.[1] || normalized || "en-IN";
};

const resolveLanguageOptionFromValue = (value?: string | null) => {
  const locale = resolveLocaleFromLanguageValue(value);
  return (
    supportedLocalizedLanguageOptions.find((option) => option.locale.toLowerCase() === locale.toLowerCase()) ||
    supportedLocalizedLanguageOptions[0]
  );
};

const cloneNarrationAudioAsset = (asset?: TrainingNarrationAudioAsset | null) =>
  asset
    ? {
      ...asset,
    }
    : null;

const cloneLocalizedVoiceovers = (value?: TrainingLocalizedVoiceovers | null): TrainingLocalizedVoiceovers | null => {
  if (!value?.languages?.length) {
    return null;
  }

  return {
    defaultLanguageCode: value.defaultLanguageCode,
    languages: value.languages.map((language) => ({
      ...language,
      buttonLabels: {
        ...defaultLocalizedButtonLabels,
        ...(language.buttonLabels ?? {}),
      },
      translatedSlides: Array.isArray(language.translatedSlides)
        ? language.translatedSlides.map((slide) => ({
          ...slide,
          mediaExtractedText: [...(slide.mediaExtractedText ?? [])],
          interactiveHotspots: [...(slide.interactiveHotspots ?? [])],
          narrationAudio: cloneNarrationAudioAsset(slide.narrationAudio),
        }))
        : [],
    })),
  };
};

const sanitizeLocalizedVoiceoversForStorage = (
  value?: TrainingLocalizedVoiceovers | null,
): TrainingLocalizedVoiceovers | null => {
  const cloned = cloneLocalizedVoiceovers(value);

  if (!cloned) {
    return null;
  }

  return {
    ...cloned,
    languages: cloned.languages.map((language) => ({
      ...language,
      apiKey: "",
      translatedSlides: language.translatedSlides.map((slide) => ({
        ...slide,
        narrationAudio: slide.narrationAudio
          ? {
            ...slide.narrationAudio,
            src: "",
          }
          : null,
      })),
    })),
  };
};

const createLocalizedLanguageRecord = ({
  option,
  isDefault,
  voiceId,
  voiceName,
  provider,
  apiKey,
  slides,
  askLabel,
}: {
  option: SupportedLocalizedLanguageOption;
  isDefault: boolean;
  voiceId: string;
  voiceName: string;
  provider: string;
  apiKey: string;
  slides: TrainingSlideRecord[];
  askLabel: string;
}): TrainingLocalizedVoiceLanguage => ({
  code: option.code,
  locale: option.locale,
  label: option.label,
  isDefault,
  provider,
  apiKey,
  voiceId,
  voiceName,
  buttonLabels: {
    ...defaultLocalizedButtonLabels,
    ask: askLabel || defaultLocalizedButtonLabels.ask,
  },
  translatedSlides: slides.map((slide) => ({
    slideId: slide.id,
    script: "",
    narrationAudio: null,
    translatedAt: null,
    audioUpdatedAt: null,
    mediaAssetId: null,
    mediaName: null,
    mediaSource: null,
    mediaPageNumber: null,
    mediaMimeType: null,
    mediaExtractedText: [],
    interactiveHotspots: [],
  })),
});

const syncLocalizedVoiceovers = ({
  current,
  slides,
  defaultOption,
  voiceId,
  voiceName,
  provider,
  apiKey,
  askLabel,
}: {
  current?: TrainingLocalizedVoiceovers | null;
  slides: TrainingSlideRecord[];
  defaultOption: SupportedLocalizedLanguageOption;
  voiceId: string;
  voiceName: string;
  provider: string;
  apiKey: string;
  askLabel: string;
}): TrainingLocalizedVoiceovers => {
  const initial =
    current?.languages?.length
      ? cloneLocalizedVoiceovers(current)
      : {
        defaultLanguageCode: defaultOption.code,
        languages: [
          createLocalizedLanguageRecord({
            option: defaultOption,
            isDefault: true,
            voiceId,
            voiceName,
            provider,
            apiKey,
            slides,
            askLabel,
          }),
        ],
      };

  const syncedLanguages = (initial?.languages ?? []).map((language) => {
    const slidesById = new Map(language.translatedSlides.map((slide) => [slide.slideId, slide]));

    return {
      ...language,
      buttonLabels: {
        ...defaultLocalizedButtonLabels,
        ...(language.buttonLabels ?? {}),
        ask: language.buttonLabels?.ask || askLabel || defaultLocalizedButtonLabels.ask,
      },
      translatedSlides: slides.map((slide) => {
        const existing = slidesById.get(slide.id);
        return {
          slideId: slide.id,
          script: existing?.script ?? "",
          narrationAudio: cloneNarrationAudioAsset(existing?.narrationAudio),
          translatedAt: existing?.translatedAt ?? null,
          audioUpdatedAt: existing?.audioUpdatedAt ?? null,
          mediaAssetId: existing?.mediaAssetId ?? null,
          mediaName: existing?.mediaName ?? null,
          mediaSource: existing?.mediaSource ?? null,
          mediaPageNumber: existing?.mediaPageNumber ?? null,
          mediaMimeType: existing?.mediaMimeType ?? null,
          mediaExtractedText: [...(existing?.mediaExtractedText ?? [])],
          interactiveHotspots: [...(existing?.interactiveHotspots ?? [])],
        };
      }),
    };
  });

  const defaultIndex = syncedLanguages.findIndex((language) => language.code === defaultOption.code);
  const resolvedDefaultIndex = defaultIndex >= 0 ? defaultIndex : 0;
  const nextLanguages = [...syncedLanguages];
  const defaultLanguage = nextLanguages[resolvedDefaultIndex] ?? createLocalizedLanguageRecord({
    option: defaultOption,
    isDefault: true,
    voiceId,
    voiceName,
    provider,
    apiKey,
    slides,
    askLabel,
  });
  nextLanguages.splice(resolvedDefaultIndex, 1);
  nextLanguages.unshift({
    ...defaultLanguage,
    code: defaultOption.code,
    locale: defaultOption.locale,
    label: defaultOption.label,
    isDefault: true,
    provider,
    apiKey,
    voiceId,
    voiceName,
    buttonLabels: {
      ...defaultLocalizedButtonLabels,
      ...(defaultLanguage.buttonLabels ?? {}),
      ask: defaultLanguage.buttonLabels?.ask || askLabel || defaultLocalizedButtonLabels.ask,
    },
  });

  return {
    defaultLanguageCode: defaultOption.code,
    languages: nextLanguages.map((language, index) => ({
      ...language,
      isDefault: index === 0,
    })),
  };
};

const getScoreAverage = (sessions: TrainingSessionRecord[]) => {
  const completedScores = sessions.filter((session) => session.score !== null).map((session) => session.score as number);

  if (!completedScores.length) {
    return 0;
  }

  return Math.round(completedScores.reduce((sum, score) => sum + score, 0) / completedScores.length);
};

const getViewedSlidesLabel = (session: TrainingSessionRecord) =>
  Array.isArray(session.viewedSlideIds) && session.viewedSlideIds.length
    ? `${session.viewedSlideIds.length} slides tracked`
    : `${session.slidesViewed}/${session.totalSlides}`;

type NormalizedTrainingSessionRecord = TrainingSessionRecord & {
  sourceSessionIds: string[];
};

const normalizeSessionIdentity = (value: string | null | undefined) =>
  String(value || "").trim().toLowerCase();

const parseSessionDate = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return 0;
  }

  const direct = Date.parse(normalized);

  return Number.isNaN(direct) ? 0 : direct;
};

const parseTimeSpentToSeconds = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  const match = normalized.match(/(\d+)m\s+(\d+)s/i);

  if (!match) {
    return 0;
  }

  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
};

const dedupeSessionAskHistory = (
  entries: NonNullable<TrainingSessionRecord["askHistory"]>,
) => {
  const seen = new Set<string>();

  return entries.filter((entry) => {
    const question = String(entry?.question || "").trim();
    const answer = String(entry?.answer || "").trim();
    const slideId = String(entry?.slideId || "").trim();
    const key = `${question.toLowerCase()}__${answer.toLowerCase()}__${slideId}`;

    if (!question || !answer || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const mergeTrainingSessionRecords = (
  primary: NormalizedTrainingSessionRecord,
  incoming: TrainingSessionRecord,
): NormalizedTrainingSessionRecord => {
  const mergedViewedSlideIds = Array.from(
    new Set(
      [
        ...(Array.isArray(primary.viewedSlideIds) ? primary.viewedSlideIds : []),
        ...(Array.isArray(incoming.viewedSlideIds) ? incoming.viewedSlideIds : []),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
  const nextStatus =
    primary.status === "completed" || incoming.status === "completed"
      ? "completed"
      : primary.status === "in-progress" || incoming.status === "in-progress"
        ? "in-progress"
        : primary.status;
  const primaryStartedAtTs = parseSessionDate(primary.startedAt);
  const incomingStartedAtTs = parseSessionDate(incoming.startedAt);
  const sourceSessionIds = Array.from(
    new Set([
      ...primary.sourceSessionIds,
      incoming.id,
    ]),
  );
  const incomingAskHistory = Array.isArray(incoming.askTranscripts) ? incoming.askTranscripts : Array.isArray(incoming.askHistory) ? incoming.askHistory : [];
  const primaryAskHistory = Array.isArray(primary.askTranscripts) ? primary.askTranscripts : Array.isArray(primary.askHistory) ? primary.askHistory : [];
  const primaryScore = primary.score;
  const incomingScore = incoming.score;
  const primaryReportTs = parseSessionDate(primary.proctoringReport?.completedAt || primary.proctoringReport?.startedAt);
  const incomingReportTs = parseSessionDate(incoming.proctoringReport?.completedAt || incoming.proctoringReport?.startedAt);

  return {
    ...primary,
    ...incoming,
    id: primary.id,
    sourceSessionIds,
    learnerName: incoming.learnerName || primary.learnerName || "",
    learnerEmail: incoming.learnerEmail || primary.learnerEmail || "",
    status: nextStatus,
    timeSpent: parseTimeSpentToSeconds(incoming.timeSpent) >= parseTimeSpentToSeconds(primary.timeSpent)
      ? incoming.timeSpent
      : primary.timeSpent,
    slidesViewed: Math.max(primary.slidesViewed, incoming.slidesViewed, mergedViewedSlideIds.length),
    totalSlides: Math.max(primary.totalSlides, incoming.totalSlides, 1),
    viewedSlideIds: mergedViewedSlideIds,
    score: incomingScore !== null && incomingScore !== undefined
      ? incomingScore
      : primaryScore,
    startedAt:
      primaryStartedAtTs && incomingStartedAtTs
        ? primaryStartedAtTs <= incomingStartedAtTs
          ? primary.startedAt
          : incoming.startedAt
        : primary.startedAt || incoming.startedAt || null,
    completedAt:
      incoming.status === "completed"
        ? incoming.completedAt || primary.completedAt || null
        : primary.completedAt || incoming.completedAt || null,
    correctAnswers: Math.max(primary.correctAnswers ?? 0, incoming.correctAnswers ?? 0),
    totalQuestions: Math.max(primary.totalQuestions ?? 0, incoming.totalQuestions ?? 0),
    progressPercent: Math.max(
      primary.progressPercent ?? 0,
      incoming.progressPercent ?? 0,
      Math.round((Math.max(primary.slidesViewed, incoming.slidesViewed, mergedViewedSlideIds.length) / Math.max(primary.totalSlides, incoming.totalSlides, 1)) * 100),
    ),
    askHistory: dedupeSessionAskHistory([...primaryAskHistory, ...incomingAskHistory]),
    askTranscripts: dedupeSessionAskHistory([...primaryAskHistory, ...incomingAskHistory]),
    proctoringReport:
      incoming.proctoringReport && (!primary.proctoringReport || incomingReportTs >= primaryReportTs)
        ? incoming.proctoringReport
        : primary.proctoringReport || incoming.proctoringReport || null,
  };
};

const normalizeTrainingSessions = (sessions: TrainingSessionRecord[]): NormalizedTrainingSessionRecord[] => {
  const normalizedSessions: NormalizedTrainingSessionRecord[] = [];

  sessions
    .slice()
    .sort((left, right) => parseSessionDate(right.startedAt) - parseSessionDate(left.startedAt))
    .forEach((session) => {
      const sessionIdentity = normalizeSessionIdentity(session.learnerEmail || session.ssoId || session.learnerName);
      const sessionMode = session.mode || "public";
      const sessionStartedAtTs = parseSessionDate(session.startedAt);
      const duplicateIndex = normalizedSessions.findIndex((candidate) => {
        const candidateIdentity = normalizeSessionIdentity(candidate.learnerEmail || candidate.ssoId || candidate.learnerName);
        const candidateMode = candidate.mode || "public";
        const candidateStartedAtTs = parseSessionDate(candidate.startedAt);

        if (!sessionIdentity || sessionIdentity !== candidateIdentity || sessionMode !== candidateMode) {
          return false;
        }

        if (candidate.sourceSessionIds.includes(session.id)) {
          return true;
        }

        if (!sessionStartedAtTs || !candidateStartedAtTs) {
          return normalizeSessionIdentity(candidate.status) === "in-progress" || normalizeSessionIdentity(session.status) === "in-progress";
        }

        return Math.abs(candidateStartedAtTs - sessionStartedAtTs) <= 15 * 60 * 1000;
      });

      if (duplicateIndex >= 0) {
        normalizedSessions[duplicateIndex] = mergeTrainingSessionRecords(normalizedSessions[duplicateIndex], session);
        return;
      }

      normalizedSessions.push({
        ...session,
        sourceSessionIds: [session.id],
        askHistory: dedupeSessionAskHistory(Array.isArray(session.askTranscripts) ? session.askTranscripts : Array.isArray(session.askHistory) ? session.askHistory : []),
        askTranscripts: dedupeSessionAskHistory(Array.isArray(session.askTranscripts) ? session.askTranscripts : Array.isArray(session.askHistory) ? session.askHistory : []),
      });
    });

  return normalizedSessions;
};

const escapeCsvValue = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;

const escapeReportHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getRiskTone = (score: number) => {
  if (score >= 75) {
    return "critical";
  }

  if (score >= 45) {
    return "warning";
  }

  return "safe";
};

const getAttentionTone = (score: number) => {
  if (score >= 80) {
    return "safe";
  }

  if (score >= 55) {
    return "warning";
  }

  return "critical";
};

const hasWorkspacePermission = (permission: string[], allowed: string[], permissionKey: string) =>
  allowed.includes(AllowedKeys.trainingWorkspace) && permission.includes(permissionKey);

const canEditTraining = (permission: string[], role: WorkspaceRole) => {
  if (!permission.includes(PermissionKeys.trainingEdit)) {
    return false;
  }

  return role !== "reviewer";
};

const canDeleteTraining = (permission: string[], role: WorkspaceRole) =>
  role === "trainer" && permission.includes(PermissionKeys.trainingEdit);

const WorkspaceBreadcrumb = ({ items }: { items: WorkspaceBreadcrumbItem[] }) => (
  <div className="page-title-box admin-breadcrumb-shell">
    <ol className="breadcrumb admin-breadcrumb m-0">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <li key={`${item.label}-${index}`} className={`breadcrumb-item ${isLast ? "active" : ""}`} aria-current={isLast ? "page" : undefined}>
            {isLast || !item.onClick ? (
              item.label
            ) : (
              <button type="button" className="btn btn-link p-0 text-decoration-none" onClick={item.onClick}>
                {item.label}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  </div>
);

const TrainingBuilder = ({
  currentUserName,
  initialTraining,
  initialStep,
  onCancel,
  onGoDashboard,
  onPersist,
}: TrainingBuilderProps) => {
  const formRef = useRef<FormikProps<TrainingSetupValues>>(null);
  const initialQuestionSetState = useMemo(
    () => deriveQuestionSetState(initialTraining || undefined, initialTraining ? cloneSlides(initialTraining.slides) : [buildBlankSlide(0)]),
    [initialTraining],
  );
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const slideMediaInputRef = useRef<HTMLInputElement>(null);
  const knowledgeInputRef = useRef<HTMLInputElement>(null);
  const previewThumbnailInputRef = useRef<HTMLInputElement>(null);
  const localizedLanguageUploadInputRef = useRef<HTMLInputElement>(null);
  const [savedBrandPresets, setSavedBrandPresets] = useState(readStoredBrandPresets);
  const [isBrandPresetModalOpen, setIsBrandPresetModalOpen] = useState(false);
  const [isSaveThemeModalOpen, setIsSaveThemeModalOpen] = useState(false);
  const [editingBrandPresetId, setEditingBrandPresetId] = useState<string | null>(null);
  const [editingBrandPresetName, setEditingBrandPresetName] = useState("");
  const [newBrandPresetName, setNewBrandPresetName] = useState("");
  const [newBrandPresetDescription, setNewBrandPresetDescription] = useState("Saved preset");
  const [pendingBrandPresetTheme, setPendingBrandPresetTheme] = useState<TrainingSlideshowTheme | null>(null);
  const [step, setStep] = useState(initialStep);
  const [maxStepReached, setMaxStepReached] = useState(initialStep);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(brandPresetStorageKey, JSON.stringify(savedBrandPresets));
    }
  }, [savedBrandPresets]);

  useEffect(() => {
    if (step > maxStepReached) {
      setMaxStepReached(step);
    }
  }, [step, maxStepReached]);
  const canJumpAcrossSteps = Boolean(initialTraining?.id);
  const highestUnlockedStep = canJumpAcrossSteps ? 4 : Math.max(step, maxStepReached);

  const handleStepNavigation = (nextStep: number) => {
    if (!canJumpAcrossSteps && nextStep > highestUnlockedStep) {
      return;
    }

    setStep(nextStep);
  };
  const [mode, setMode] = useState<BuilderMode>("upload");
  const [uploadedFiles, setUploadedFiles] = useState<ImportedUploadRecord[]>(() =>
    initialTraining ? deriveUploadedFilesFromSlides(initialTraining.slides) : [],
  );
  const [slidesDraft, setSlidesDraft] = useState<TrainingSlideRecord[]>(
    initialTraining ? cloneSlides(initialTraining.slides) : [buildBlankSlide(0)],
  );
  // Slides selected to receive narration on this pass. Defaults to "all slides" so
  // existing behavior is unchanged unless the trainer narrows the selection in Step 2/4.
  const [selectedNarrationSlideIds, setSelectedNarrationSlideIds] = useState<string[]>(
    (initialTraining ? cloneSlides(initialTraining.slides) : [buildBlankSlide(0)]).map((slide) => slide.id),
  );
  const [slideRangeInput, setSlideRangeInput] = useState("");
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<TrainingKnowledgeDocument[]>(
    cloneKnowledgeDocuments(initialTraining?.knowledgeDocuments),
  );
  const [isUploadingKnowledgeDocuments, setIsUploadingKnowledgeDocuments] = useState(false);
  const [questionGeneratorConfig, setQuestionGeneratorConfig] = useState<TrainingQuestionGeneratorConfig>(
    {
      ...buildBlankQuestionGeneratorConfig(initialTraining?.questionGeneratorConfig),
      activeSetId: initialTraining?.questionGeneratorConfig?.activeSetId ?? initialQuestionSetState.activeSetId,
    },
  );
  const [questionCheckpoints, setQuestionCheckpoints] = useState<TrainingQuestionCheckpoint[]>(
    initialQuestionSetState.activeCheckpoints,
  );
  const [questionSets, setQuestionSets] = useState<TrainingQuestionSetRecord[]>(initialQuestionSetState.questionSets);
  const [scriptPrompt, setScriptPrompt] = useState(
    initialTraining?.scriptPrompt ??
    "Create avatar narration scripts of 20-30 words per slide. Keep tone motivating and practical for Trainup field sales reps.",
  );
  const [previewSlideId, setPreviewSlideId] = useState<string | null>(initialTraining?.previewSlideId ?? null);
  const [previewThumbnailAssetId, setPreviewThumbnailAssetId] = useState<string | null>(
    initialTraining?.previewThumbnailAssetId ?? null,
  );
  const [previewThumbnailAssetName, setPreviewThumbnailAssetName] = useState<string>(
    initialTraining?.previewThumbnailAssetName ?? "",
  );
  const [previewThumbnailUrl, setPreviewThumbnailUrl] = useState("");
  const [isUploadingPreviewThumbnail, setIsUploadingPreviewThumbnail] = useState(false);
  const [lastGeneratedScriptPrompt, setLastGeneratedScriptPrompt] = useState(
    initialTraining?.slides.some((slide) => slide.script.trim()) ? initialTraining?.scriptPrompt ?? "" : "",
  );
  const [formBuilderSlideId, setFormBuilderSlideId] = useState<string | null>(null);
  const [pendingSlideUploadId, setPendingSlideUploadId] = useState<string | null>(null);
  const [isImportingMedia, setIsImportingMedia] = useState(false);
  const [isGeneratingSlideScripts, setIsGeneratingSlideScripts] = useState(false);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [questionGenerationError, setQuestionGenerationError] = useState("");
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [editingQuestionIds, setEditingQuestionIds] = useState<string[]>([]);
  const [questionEditDrafts, setQuestionEditDrafts] = useState<Record<string, QuestionEditDraft>>({});
  const [expandedQuestionSetIds, setExpandedQuestionSetIds] = useState<string[]>([]);
  const [expandedQuestionSettingIds, setExpandedQuestionSettingIds] = useState<string[]>([]);
  const [pendingQuestionGeneration, setPendingQuestionGeneration] = useState<{
    trainingTitle: string;
    existingSetCount: number;
  } | null>(null);
  const [pendingScriptRegeneration, setPendingScriptRegeneration] = useState<{
    trainingTitle: string;
  } | null>(null);
  const [configuringQuestionSetId, setConfiguringQuestionSetId] = useState<string | null>(null);
  const [expandedManageSlideId, setExpandedManageSlideId] = useState<string | null>(
    initialTraining?.slides[0]?.id ?? null,
  );
  const [showSlidePickerInManageStep, setShowSlidePickerInManageStep] = useState(false);
  const [infoEditorSlideId, setInfoEditorSlideId] = useState<string | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<ElevenLabsVoiceOption[]>([]);
  const [defaultVoiceOption, setDefaultVoiceOption] = useState<ElevenLabsVoiceOption | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceLoadError, setVoiceLoadError] = useState("");
  const [manualKeyStatus, setManualKeyStatus] = useState<"idle" | "verifying" | "verified" | "error">(
    initialTraining?.ttsMode === "manual" && initialTraining?.manualTtsApiKeyVerifiedAt ? "verified" : "idle",
  );
  const [manualKeyMessage, setManualKeyMessage] = useState("");
  const [isLanguageConfigOpen, setIsLanguageConfigOpen] = useState(false);
  const [localizedVoiceoversDraft, setLocalizedVoiceoversDraft] = useState<TrainingLocalizedVoiceovers | null>(
    () => cloneLocalizedVoiceovers(initialTraining?.localizedVoiceovers) ?? null,
  );
  const [localizedVoiceoversSnapshot, setLocalizedVoiceoversSnapshot] = useState<TrainingLocalizedVoiceovers | null>(
    () => cloneLocalizedVoiceovers(initialTraining?.localizedVoiceovers) ?? null,
  );
  const [languageActionState, setLanguageActionState] = useState<Record<string, { translating: boolean; generatingAudio: boolean }>>({});
  const [expandedLanguageLabelCodes, setExpandedLanguageLabelCodes] = useState<string[]>([]);
  const [pendingLocalizedUploadCode, setPendingLocalizedUploadCode] = useState<string | null>(null);
  const hasAppliedInitialVoiceRef = useRef(false);
  const [apiAvatarList, setApiAvatarList] = useState<ApiAvatarItem[]>([]);
  const [isLoadingApiAvatars, setIsLoadingApiAvatars] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingApiAvatars(true);
    fetch(`${AMARA_API_BASE}/api-v1/external/get-avatar`, {
      method: "GET",
      headers: {
        "X-Api-Key": AMARA_API_KEY,
      },
    })
      .then((res) => res.json())
      .then((json: { status: boolean; data?: ApiAvatarItem[] }) => {
        if (!cancelled && json.status && Array.isArray(json.data)) {
          setApiAvatarList(json.data);
        }
      })
      .catch(() => {
        // silently ignore – dropdown will still show Sarah default
      })
      .finally(() => {
        if (!cancelled) setIsLoadingApiAvatars(false);
      });
    return () => { cancelled = true; };
  }, []);

  // All selectable avatar options: Sarah default + API avatars
  const avatarOptions = useMemo<ApiAvatarItem[]>(
    () => [SARAH_DEFAULT_AVATAR, ...apiAvatarList],
    [apiAvatarList],
  );
  const builderInitialValues = useMemo(
    () => buildDefaultSetupValues(initialTraining, avatarOptions),
    [avatarOptions, initialTraining],
  );

  const activeFormSlide = slidesDraft.find((slide) => slide.id === formBuilderSlideId) ?? null;
  const hasUploadedMedia = slidesDraft.some((slide) => Boolean(slide.mediaAssetId));
  const activeQuestionSetId = questionGeneratorConfig.activeSetId ?? null;
  const activeQuestionSet = useMemo(
    () => questionSets.find((questionSet) => questionSet.id === activeQuestionSetId) ?? null,
    [activeQuestionSetId, questionSets],
  );
  const selectedPreviewSlide = useMemo(() => {
    const firstSlide = slidesDraft[0] ?? null;

    if (!previewSlideId) {
      return firstSlide;
    }

    return slidesDraft.find((slide) => slide.id === previewSlideId) ?? firstSlide;
  }, [previewSlideId, slidesDraft]);
  const hasCustomPreviewThumbnail = Boolean(previewThumbnailAssetId && previewThumbnailUrl);
  const configuringQuestionSet = useMemo(
    () => questionSets.find((questionSet) => questionSet.id === configuringQuestionSetId) ?? null,
    [configuringQuestionSetId, questionSets],
  );
  const expandedQuestionSetMap = useMemo(
    () => new Set(expandedQuestionSetIds),
    [expandedQuestionSetIds],
  );
  const editingQuestionMap = useMemo(
    () => new Set(editingQuestionIds),
    [editingQuestionIds],
  );
  const expandedQuestionSettingMap = useMemo(
    () => new Set(expandedQuestionSettingIds),
    [expandedQuestionSettingIds],
  );
  const questionSetVersions = useMemo(
    () =>
      questionSets.map((questionSet) =>
        questionSet.id === activeQuestionSetId
          ? buildQuestionSetRecord({
            setId: questionSet.id,
            label: questionSet.label,
            placementMode: questionSet.placementMode,
            slideId: questionSet.slideId,
            slideTitle: questionSet.slideTitle,
            isMandatory: questionSet.isMandatory ?? true,
            difficultyLevel: questionSet.difficultyLevel,
            topicTags: questionSet.topicTags,
            checkpoints: questionCheckpoints,
            sourceIds: questionSet.sourceIds,
            sourceLabels: questionSet.sourceLabels,
            sourceSlideIds: questionSet.sourceSlideIds,
            sourceRangeLabel: questionSet.sourceRangeLabel,
            plannerSummary: questionSet.plannerSummary,
            generatedQuestionTypes: deriveGeneratedQuestionTypes(questionCheckpoints),
            generationStrategy: questionSet.generationStrategy,
            createdAt: questionSet.createdAt,
            updatedAt: new Date().toISOString(),
            isActive: true,
          })
          : {
            ...questionSet,
            isActive: false,
          },
      ),
    [activeQuestionSetId, questionCheckpoints, questionSets],
  );

  const loadElevenLabsVoices = useCallback(async ({
    apiKey,
    syncForm,
    verifyKey,
  }: {
    apiKey?: string;
    syncForm?: boolean;
    verifyKey?: boolean;
  } = {}) => {
    const normalizedApiKey = String(apiKey || "").trim();

    setIsLoadingVoices(true);
    setVoiceLoadError("");

    if (verifyKey) {
      setManualKeyStatus("verifying");
      setManualKeyMessage("Verifying ElevenLabs API key...");
    }

    try {
      const response = normalizedApiKey
        ? await AxiosHelper.postData<ElevenLabsVoicesResponse, { apiKey: string }>("/tts/verify", {
          apiKey: normalizedApiKey,
        })
        : await AxiosHelper.getData<ElevenLabsVoicesResponse>("/tts/voices");

      if (!response.data.status) {
        throw new Error(response.data.message || "Unable to load ElevenLabs voices.");
      }

      const fetchedVoices = Array.isArray(response.data.data.voices) ? response.data.data.voices : [];
      const resolvedDefaultVoice =
        fetchedVoices.find((voice) => voice.isDefault) ||
        findMatchingVoice(
          fetchedVoices,
          response.data.data.defaultVoiceId,
          response.data.data.defaultVoiceName,
        ) ||
        fetchedVoices[0] ||
        null;

      setVoiceOptions(fetchedVoices);
      setDefaultVoiceOption(resolvedDefaultVoice);

      const form = formRef.current;

      if (form && resolvedDefaultVoice && syncForm) {
        const matchedCurrentVoice = findMatchingVoice(
          fetchedVoices,
          form.values.voiceId,
          form.values.voiceName,
        );
        const nextVoice = matchedCurrentVoice || resolvedDefaultVoice;

        form.setFieldValue("voiceId", nextVoice.voiceId, false);
        form.setFieldValue("voiceName", nextVoice.name, false);
      }

      if (form && verifyKey) {
        form.setFieldValue("manualApiKeyVerifiedAt", new Date().toISOString(), false);
      }

      if (verifyKey) {
        setManualKeyStatus("verified");
        setManualKeyMessage("Manual ElevenLabs API key verified successfully.");
      } else {
        setManualKeyMessage("");
      }

      hasAppliedInitialVoiceRef.current = true;
      return resolvedDefaultVoice;
    } catch (error) {
      if (verifyKey) {
        setVoiceOptions([]);
        setDefaultVoiceOption(null);
      }

      setVoiceLoadError(error instanceof Error ? error.message : "Unable to load ElevenLabs voices.");

      if (verifyKey) {
        const form = formRef.current;

        if (form) {
          form.setFieldValue("manualApiKeyVerifiedAt", "", false);
        }

        setManualKeyStatus("error");
        setManualKeyMessage(error instanceof Error ? error.message : "Unable to verify the ElevenLabs API key.");
      }

      throw error;
    } finally {
      setIsLoadingVoices(false);
    }
  }, []);

  const generateSlideScript = useCallback(
    async ({
      trainingTitle,
      slideTitle,
      mediaLabel,
      extractedText,
      index,
    }: {
      trainingTitle: string;
      slideTitle: string;
      mediaLabel: string;
      extractedText?: string[];
      index: number;
    }) => {
      return generatePromptDrivenNarration({
        prompt: scriptPrompt,
        trainingTitle,
        slideTitle: slideTitle || mediaLabel,
        extractedText,
        index,
      });
    },
    [scriptPrompt],
  );

  const generateScriptsForSlides = useCallback(
    async (
      slides: TrainingSlideRecord[],
      trainingTitle: string,
      options?: {
        forceAll?: boolean;
      },
    ) => {
      const nextSlides = await Promise.all(
        slides.map(async (slide, index) => {
          if (
            (!options?.forceAll && slide.script.trim()) ||
            (!slide.mediaExtractedText?.length && !slide.mediaName.trim())
          ) {
            return slide;
          }

          const nextScript = await generateSlideScript({
            trainingTitle,
            slideTitle: slide.title,
            mediaLabel: getFileStem(slide.mediaName),
            extractedText: slide.mediaExtractedText,
            index,
          });

          return {
            ...slide,
            script: nextScript,
          };
        }),
      );

      return nextSlides;
    },
    [generateSlideScript],
  );

  // Splices narration results for a subset of slides back into the full deck,
  // leaving slides outside that subset (e.g. ones the trainer didn't select) untouched.
  const mergeSlidesById = (base: TrainingSlideRecord[], updates: TrainingSlideRecord[]) => {
    const updateMap = new Map(updates.map((slide) => [slide.id, slide]));
    return base.map((slide) => updateMap.get(slide.id) ?? slide);
  };

  useEffect(() => {
    if (!slidesDraft.length) {
      if (previewSlideId) {
        setPreviewSlideId(null);
      }

      return;
    }

    if (previewSlideId && !slidesDraft.some((slide) => slide.id === previewSlideId)) {
      setPreviewSlideId(null);
    }
  }, [previewSlideId, slidesDraft]);

  useEffect(() => {
    const nextConfig = cloneLocalizedVoiceovers(initialTraining?.localizedVoiceovers) ?? null;
    setLocalizedVoiceoversDraft(nextConfig);
    setLocalizedVoiceoversSnapshot(cloneLocalizedVoiceovers(nextConfig));
  }, [initialTraining?.id, initialTraining?.localizedVoiceovers]);

  useEffect(() => {
    const values = formRef.current?.values;

    if (!values) {
      return;
    }

    const defaultOption = resolveLanguageOptionFromValue(values.avatarEngineLanguage);
    setLocalizedVoiceoversDraft((current) =>
      current
        ? syncLocalizedVoiceovers({
          current,
          slides: slidesDraft,
          defaultOption,
          voiceId: values.voiceId,
          voiceName: values.voiceName || defaultVoiceOption?.name || DEFAULT_ELEVENLABS_VOICE_NAME,
          provider: values.ttsProvider,
          apiKey: values.manualApiKey.trim(),
          askLabel: values.questionButtonLabel,
        })
        : current,
    );
  }, [defaultVoiceOption?.name, slidesDraft]);

  useEffect(() => {
    let active = true;
    let revoke: () => void = () => undefined;

    if (!previewThumbnailAssetId) {
      setPreviewThumbnailUrl("");
      return () => undefined;
    }

    void resolveSlideMediaAsset(previewThumbnailAssetId)
      .then((asset) => {
        if (!active) {
          asset?.revoke();
          return;
        }

        if (!asset) {
          setPreviewThumbnailUrl("");
          return;
        }

        revoke = asset.revoke;
        setPreviewThumbnailUrl(asset.url);
      })
      .catch(() => {
        if (active) {
          setPreviewThumbnailUrl("");
        }
      });

    return () => {
      active = false;
      revoke();
    };
  }, [previewThumbnailAssetId]);

  useEffect(() => {
    const initialManualKey =
      initialTraining?.ttsMode === "manual" ? String(initialTraining?.manualTtsApiKey || "").trim() : "";

    void loadElevenLabsVoices({
      apiKey: initialManualKey,
      syncForm: true,
      verifyKey: Boolean(initialManualKey),
    }).catch(() => {
      setVoiceOptions([]);
      setDefaultVoiceOption(null);
    });
  }, [initialTraining?.id, initialTraining?.manualTtsApiKey, initialTraining?.ttsMode, loadElevenLabsVoices]);

  const resetFileInput = (input: HTMLInputElement | null) => {
    if (input) {
      input.value = "";
    }
  };

  const updateSlide = (slideId: string, updater: (slide: TrainingSlideRecord) => TrainingSlideRecord) => {
    setSlidesDraft((current) => current.map((slide) => (slide.id === slideId ? updater(slide) : slide)));
  };

  const updateSlideHotspot = (
    slideId: string,
    hotspotId: string,
    updater: (hotspot: TrainingInteractiveHotspot) => TrainingInteractiveHotspot,
  ) => {
    updateSlide(slideId, (current) => ({
      ...current,
      interactiveHotspots: (current.interactiveHotspots ?? []).map((hotspot) =>
        hotspot.id === hotspotId ? updater(hotspot) : hotspot,
      ),
    }));
  };

  const addSlideHotspot = (
    slideId: string,
    kind: TrainingInteractiveHotspot["kind"],
  ) => {
    updateSlide(slideId, (current) => ({
      ...current,
      interactiveHotspots: [...(current.interactiveHotspots ?? []), createDefaultHotspot(kind)],
    }));
  };

  const removeSlideHotspot = (slideId: string, hotspotId: string) => {
    updateSlide(slideId, (current) => ({
      ...current,
      interactiveHotspots: (current.interactiveHotspots ?? []).filter(
        (hotspot) => hotspot.id !== hotspotId,
      ),
    }));
  };

  const clearSlideMedia = (slideId: string) => {
    updateSlide(slideId, (current) => {
      if (!current.mediaAssetId) {
        return current;
      }

      return {
        ...current,
        removedMedia: {
          assetId: current.mediaAssetId,
          name: current.mediaName,
          source: current.mediaSource,
          pageNumber: current.mediaPageNumber,
          mimeType: current.mediaMimeType,
          extractedText: current.mediaExtractedText ?? [],
          interactiveHotspots: current.interactiveHotspots ?? [],
        },
        mediaAssetId: null,
        mediaPageNumber: null,
        mediaMimeType: null,
        mediaExtractedText: [],
        interactiveHotspots: [],
        uploaded: false,
      };
    });
  };

  const restoreSlideMedia = (slideId: string) => {
    updateSlide(slideId, (current) => {
      if (!current.removedMedia?.assetId) {
        return current;
      }

      return {
        ...current,
        mediaAssetId: current.removedMedia.assetId,
        mediaName: current.removedMedia.name,
        mediaSource: current.removedMedia.source,
        mediaPageNumber: current.removedMedia.pageNumber,
        mediaMimeType: current.removedMedia.mimeType,
        mediaExtractedText: current.removedMedia.extractedText ?? [],
        interactiveHotspots: current.removedMedia.interactiveHotspots ?? [],
        uploaded: true,
        removedMedia: null,
      };
    });
  };

  const syncQuestionSetsWithActiveDraft = useCallback(
    (options?: { nextActiveSetId?: string | null; nextCheckpoints?: TrainingQuestionCheckpoint[] }) => {
      const nextActiveSetId = options?.nextActiveSetId ?? activeQuestionSetId;
      const nextCheckpoints = cloneQuestionCheckpoints(options?.nextCheckpoints ?? questionCheckpoints);

      if (!nextActiveSetId) {
        return cloneQuestionSets(questionSets);
      }

      const nextSets = cloneQuestionSets(questionSets);
      const activeSetIndex = nextSets.findIndex((questionSet) => questionSet.id === nextActiveSetId);

      if (activeSetIndex < 0) {
        return nextSets;
      }

      nextSets[activeSetIndex] = buildQuestionSetRecord({
        setId: nextSets[activeSetIndex].id,
        label: nextSets[activeSetIndex].label,
        placementMode: nextSets[activeSetIndex].placementMode,
        slideId: nextSets[activeSetIndex].slideId,
        slideTitle: nextSets[activeSetIndex].slideTitle,
        isMandatory: nextSets[activeSetIndex].isMandatory ?? true,
        difficultyLevel: nextSets[activeSetIndex].difficultyLevel,
        topicTags: nextSets[activeSetIndex].topicTags,
        checkpoints: nextCheckpoints,
        sourceIds: nextSets[activeSetIndex].sourceIds,
        sourceLabels: nextSets[activeSetIndex].sourceLabels,
        sourceSlideIds: nextSets[activeSetIndex].sourceSlideIds,
        sourceRangeLabel: nextSets[activeSetIndex].sourceRangeLabel,
        plannerSummary: nextSets[activeSetIndex].plannerSummary,
        generatedQuestionTypes: deriveGeneratedQuestionTypes(questionCheckpoints),
        generationStrategy: nextSets[activeSetIndex].generationStrategy,
        createdAt: nextSets[activeSetIndex].createdAt,
        updatedAt: new Date().toISOString(),
        isActive: true,
      });

      return nextSets.map((questionSet) => ({
        ...questionSet,
        isActive: questionSet.id === nextActiveSetId,
      }));
    },
    [activeQuestionSetId, questionCheckpoints, questionSets],
  );

  const openQuestionEditor = (checkpoint: TrainingQuestionCheckpoint, questionSetId?: string) => {
    if (questionSetId && questionSetId !== activeQuestionSetId) {
      activateQuestionSet(questionSetId, { syncExpanded: false });
      setExpandedQuestionSetIds([questionSetId]);
    }

    setQuestionEditDrafts((current) => ({
      ...current,
      [checkpoint.id]: buildQuestionEditDraft(checkpoint),
    }));
    setEditingQuestionIds((current) => Array.from(new Set([...current, checkpoint.id])));
  };

  const closeQuestionEditor = (checkpointId: string) => {
    setEditingQuestionIds((current) => current.filter((item) => item !== checkpointId));
    setQuestionEditDrafts((current) => {
      const next = { ...current };
      delete next[checkpointId];
      return next;
    });
  };

  const updateQuestionEditDraft = (
    checkpointId: string,
    updater: (draft: QuestionEditDraft) => QuestionEditDraft,
  ) => {
    setQuestionEditDrafts((current) => {
      const existingDraft = current[checkpointId];

      if (!existingDraft) {
        return current;
      }

      return {
        ...current,
        [checkpointId]: updater(existingDraft),
      };
    });
  };

  const saveQuestionEditor = (checkpointId: string) => {
    const draft = questionEditDrafts[checkpointId];

    if (!draft) {
      return;
    }

    const nextPrompt = String(draft.prompt || "").trim();

    if (!nextPrompt) {
      toast.error("Question prompt is required.");
      return;
    }

    const nextOptions = isChoiceQuestionType(draft.questionType)
      ? draft.options.map((option) => String(option || "").trim()).filter(Boolean)
      : [];

    if (isChoiceQuestionType(draft.questionType) && nextOptions.length < 2) {
      toast.error("Add at least two options for choice-based questions.");
      return;
    }

    updateQuestionCheckpoint(checkpointId, (current) => {
      const nextExpectedAnswer =
        draft.questionType === "objective" && nextOptions.length && !nextOptions.includes(current.expectedAnswer)
          ? nextOptions[0]
          : current.expectedAnswer;

      return {
        ...current,
        title: nextPrompt,
        prompt: nextPrompt,
        questionType: draft.questionType,
        options: nextOptions,
        expectedAnswer: nextExpectedAnswer,
        keywordMatches: current.keywordMatches.filter((item) => nextOptions.includes(item)),
      };
    });

    closeQuestionEditor(checkpointId);
    toast.success("Question updated.");
  };

  const updateQuestionCheckpoint = (
    checkpointId: string,
    updater: (checkpoint: TrainingQuestionCheckpoint) => TrainingQuestionCheckpoint,
  ) => {
    setQuestionCheckpoints((current) =>
      current.map((checkpoint) =>
        checkpoint.id === checkpointId
          ? {
            ...updater(checkpoint),
            manualEdits: true,
          }
          : checkpoint,
      ),
    );
  };

  const reorderQuestionCheckpoint = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    setQuestionCheckpoints((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const removeQuestionCheckpoint = (checkpointId: string) => {
    closeQuestionEditor(checkpointId);
    setQuestionCheckpoints((current) => current.filter((checkpoint) => checkpoint.id !== checkpointId));
  };

  const removeQuestionSet = (questionSetId: string) => {
    const targetSet = questionSets.find((questionSet) => questionSet.id === questionSetId);

    if (!targetSet) {
      return;
    }

    const confirmed = window.confirm(`Delete "${targetSet.label}" and all of its questions?`);

    if (!confirmed) {
      return;
    }

    const targetIndex = questionSets.findIndex((questionSet) => questionSet.id === questionSetId);
    const remainingSets = questionSets.filter((questionSet) => questionSet.id !== questionSetId);
    const fallbackActiveSet =
      remainingSets[targetIndex] ??
      remainingSets[Math.max(0, targetIndex - 1)] ??
      null;

    const nextQuestionSets = remainingSets.map((questionSet) => ({
      ...questionSet,
      isActive: questionSet.id === fallbackActiveSet?.id,
    }));

    setQuestionSets(nextQuestionSets);
    setQuestionCheckpoints(cloneQuestionCheckpoints(fallbackActiveSet?.checkpoints ?? []));
    setEditingQuestionIds([]);
    setQuestionEditDrafts({});
    setExpandedQuestionSetIds((current) => {
      const nextExpanded = current.filter((item) => item !== questionSetId);
      return fallbackActiveSet?.id ? Array.from(new Set([...nextExpanded, fallbackActiveSet.id])) : nextExpanded;
    });
    setExpandedQuestionSettingIds([]);
    setConfiguringQuestionSetId((current) => (current === questionSetId ? null : current));
    setQuestionGeneratorConfig((current) => ({
      ...current,
      activeSetId: fallbackActiveSet?.id ?? null,
      difficultyLevel: fallbackActiveSet?.difficultyLevel ?? current.difficultyLevel,
      topicTags: fallbackActiveSet?.topicTags ? [...fallbackActiveSet.topicTags] : current.topicTags,
      preferredQuestionTypes:
        fallbackActiveSet?.generatedQuestionTypes?.length
          ? [...fallbackActiveSet.generatedQuestionTypes]
          : current.preferredQuestionTypes,
    }));
    toast.success(`Deleted ${targetSet.label}.`);
  };

  const activateQuestionSet = (questionSetId: string, options?: { syncExpanded?: boolean }) => {
    const targetSet = questionSets.find((questionSet) => questionSet.id === questionSetId);

    if (!targetSet) {
      return;
    }

    const nextSets = syncQuestionSetsWithActiveDraft();
    const resolvedTargetSet = nextSets.find((questionSet) => questionSet.id === questionSetId) ?? targetSet;

    setQuestionSets(
      nextSets.map((questionSet) => ({
        ...questionSet,
        isActive: questionSet.id === questionSetId,
      })),
    );
    setQuestionCheckpoints(cloneQuestionCheckpoints(resolvedTargetSet.checkpoints));
    setEditingQuestionIds([]);
    setQuestionEditDrafts({});
    if (options?.syncExpanded !== false) {
      setExpandedQuestionSetIds([questionSetId]);
    }
    setQuestionGeneratorConfig((current) => ({
      ...current,
      activeSetId: questionSetId,
      difficultyLevel: resolvedTargetSet.difficultyLevel,
      topicTags: [...resolvedTargetSet.topicTags],
      preferredQuestionTypes:
        resolvedTargetSet.generatedQuestionTypes?.length
          ? [...resolvedTargetSet.generatedQuestionTypes]
          : current.preferredQuestionTypes,
    }));
  };

  const handleKnowledgeDocumentUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) {
      return;
    }

    setIsUploadingKnowledgeDocuments(true);
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    try {
      const files = Array.from(fileList);
      const documents = await Promise.all(files.map((file) => extractKnowledgeDocument(file)));
      setKnowledgeDocuments((current) => [...current, ...documents]);
      setQuestionGeneratorConfig((current) => ({
        ...current,
        selectedSourceIds: Array.from(new Set([...current.selectedSourceIds, ...documents.map((document) => document.id)])),
      }));
      toast.success(`${documents.length} knowledge document${documents.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to extract text from the selected document.");
    } finally {
      setIsUploadingKnowledgeDocuments(false);
      resetFileInput(knowledgeInputRef.current);
    }
  };

  const generateAiQuestionDrafts = async (
    trainingTitle: string,
    targetSetId?: string | null,
    generationMode: "overwrite" | "append" | "regenerate_set" = targetSetId ? "regenerate_set" : "overwrite",
  ) => {
    if (!slidesDraft.length) {
      toast.error("Add at least one slide before generating questions.");
      return;
    }

    if (!questionGeneratorConfig.selectedSourceIds.length) {
      toast.error("Select at least one knowledge source for AI question generation.");
      return;
    }

    setIsGeneratingQuestions(true);
    setQuestionGenerationError("");

    try {
      const draftTimestamp = new Date().toISOString();
      const variationToken = `${draftTimestamp}-${Math.random().toString(36).slice(2, 8)}`;
      const syncedQuestionSets = syncQuestionSetsWithActiveDraft();
      const targetSet = targetSetId
        ? syncedQuestionSets.find((questionSet) => questionSet.id === targetSetId) ?? null
        : null;
      const previousQuestions = syncedQuestionSets.flatMap((questionSet) =>
        questionSet.checkpoints.map((checkpoint) => ({
          prompt: checkpoint.prompt,
          expectedAnswer: checkpoint.expectedAnswer,
          questionType: checkpoint.questionType,
          setLabel: questionSet.label,
        })),
      );
      const generatedSets = await generateTrainingQuestions({
        trainingTitle,
        slides: slidesDraft,
        knowledgeDocuments,
        generationMode,
        variationToken,
        previousQuestions,
        config: {
          ...questionGeneratorConfig,
          topicTags: normalizeQuestionTopicTags(questionGeneratorConfig.topicTags),
        },
        existingSet: targetSet
          ? {
            id: targetSet.id,
            label: targetSet.label,
            placementMode: targetSet.placementMode,
            slideId: targetSet.slideId ?? null,
            slideTitle: targetSet.slideTitle || "",
            sourceSlideIds: [...(targetSet.sourceSlideIds ?? [])],
            sourceRangeLabel: targetSet.sourceRangeLabel || "",
            sourceIds: [...targetSet.sourceIds],
            sourceLabels: [...targetSet.sourceLabels],
            plannerSummary: targetSet.plannerSummary || "",
            isMandatory: targetSet.isMandatory ?? true,
          }
          : null,
      });

      const nextQuestionSets = targetSet
        ? syncedQuestionSets.map((questionSet) => {
          const matchedSet = generatedSets.find((generatedSet) => generatedSet.id === questionSet.id);

          if (!matchedSet) {
            return {
              ...questionSet,
              isActive: false,
            };
          }

          return buildQuestionSetRecord({
            setId: matchedSet.id || questionSet.id,
            label: matchedSet.label || questionSet.label,
            placementMode: matchedSet.placementMode || questionSet.placementMode,
            slideId: matchedSet.slideId ?? questionSet.slideId ?? null,
            slideTitle: matchedSet.slideTitle || questionSet.slideTitle || "",
            difficultyLevel: matchedSet.difficultyLevel || questionSet.difficultyLevel,
            topicTags: matchedSet.topicTags?.length ? matchedSet.topicTags : questionSet.topicTags,
            checkpoints: matchedSet.checkpoints,
            sourceIds: matchedSet.sourceIds?.length ? matchedSet.sourceIds : questionSet.sourceIds,
            sourceLabels: matchedSet.sourceLabels?.length ? matchedSet.sourceLabels : questionSet.sourceLabels,
            sourceSlideIds: matchedSet.sourceSlideIds?.length ? matchedSet.sourceSlideIds : questionSet.sourceSlideIds,
            sourceRangeLabel: matchedSet.sourceRangeLabel || questionSet.sourceRangeLabel || "",
            plannerSummary: matchedSet.plannerSummary || questionSet.plannerSummary || "",
            generatedQuestionTypes: matchedSet.generatedQuestionTypes?.length ? matchedSet.generatedQuestionTypes : questionSet.generatedQuestionTypes,
            generationStrategy: "ai_planned",
            createdAt: questionSet.createdAt,
            updatedAt: draftTimestamp,
            isActive: true,
            isMandatory: matchedSet.isMandatory ?? questionSet.isMandatory ?? true,
          });
        })
        : generationMode === "append"
          ? [
            ...syncedQuestionSets.map((questionSet) => ({
              ...questionSet,
              isActive: false,
            })),
            ...generatedSets.map((generatedSet, index) =>
              buildQuestionSetRecord({
                setId: `${generatedSet.id || "question-set"}-append-${Date.now()}-${index}`,
                label: buildQuestionSetLabel(
                  generatedSet.slideTitle || "Training Slide",
                  syncedQuestionSets.length + index + 1,
                ),
                placementMode: generatedSet.placementMode || "after_slide",
                slideId: generatedSet.slideId ?? null,
                slideTitle: generatedSet.slideTitle || "",
                difficultyLevel: generatedSet.difficultyLevel || questionGeneratorConfig.difficultyLevel,
                topicTags: generatedSet.topicTags?.length ? generatedSet.topicTags : questionGeneratorConfig.topicTags,
                checkpoints: generatedSet.checkpoints,
                sourceIds: generatedSet.sourceIds,
                sourceLabels: generatedSet.sourceLabels,
                sourceSlideIds: generatedSet.sourceSlideIds,
                sourceRangeLabel: generatedSet.sourceRangeLabel,
                plannerSummary: generatedSet.plannerSummary,
                generatedQuestionTypes: generatedSet.generatedQuestionTypes,
                generationStrategy: "ai_planned",
                createdAt: draftTimestamp,
                updatedAt: draftTimestamp,
                isActive: index === 0,
                isMandatory: generatedSet.isMandatory ?? true,
              }),
            ),
          ]
          : generatedSets.map((generatedSet, index) =>
            buildQuestionSetRecord({
              setId: generatedSet.id || `question-set-${Date.now()}-${index}`,
              label: buildQuestionSetLabel(generatedSet.slideTitle || "Training Slide", index + 1),
              placementMode: generatedSet.placementMode || "after_slide",
              slideId: generatedSet.slideId ?? null,
              slideTitle: generatedSet.slideTitle || "",
              difficultyLevel: generatedSet.difficultyLevel || questionGeneratorConfig.difficultyLevel,
              topicTags: generatedSet.topicTags?.length ? generatedSet.topicTags : questionGeneratorConfig.topicTags,
              checkpoints: generatedSet.checkpoints,
              sourceIds: generatedSet.sourceIds,
              sourceLabels: generatedSet.sourceLabels,
              sourceSlideIds: generatedSet.sourceSlideIds,
              sourceRangeLabel: generatedSet.sourceRangeLabel,
              plannerSummary: generatedSet.plannerSummary,
              generatedQuestionTypes: generatedSet.generatedQuestionTypes,
              generationStrategy: "ai_planned",
              createdAt: draftTimestamp,
              updatedAt: draftTimestamp,
              isActive: index === 0,
              isMandatory: generatedSet.isMandatory ?? true,
            }),
          );

      const nextActiveSet = nextQuestionSets.find((questionSet) => questionSet.isActive) ?? nextQuestionSets[0] ?? null;

      setQuestionSets(nextQuestionSets);
      setQuestionCheckpoints(cloneQuestionCheckpoints(nextActiveSet?.checkpoints ?? []));
      setEditingQuestionIds([]);
      setQuestionEditDrafts({});
      setExpandedQuestionSetIds(nextActiveSet?.id ? [nextActiveSet.id] : []);
      setQuestionGeneratorConfig((current) => ({
        ...current,
        activeSetId: nextActiveSet?.id ?? null,
        lastGeneratedAt: draftTimestamp,
        topicTags: [...(nextActiveSet?.topicTags ?? current.topicTags)],
        difficultyLevel: nextActiveSet?.difficultyLevel ?? current.difficultyLevel,
        preferredQuestionTypes:
          nextActiveSet?.generatedQuestionTypes?.length
            ? [...nextActiveSet.generatedQuestionTypes]
            : current.preferredQuestionTypes,
      }));
      setPendingQuestionGeneration(null);
      setConfiguringQuestionSetId(null);
      toast.success(
        targetSet
          ? `Question set regenerated with ${nextActiveSet?.questionCount ?? 0} questions.`
          : generationMode === "append"
            ? `${generatedSets.length} new AI-planned question set${generatedSets.length === 1 ? "" : "s"} added.`
            : `${nextQuestionSets.length} AI-planned question set${nextQuestionSets.length === 1 ? "" : "s"} generated.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate F&Q right now.";
      setQuestionGenerationError(message);
      toast.error(message);
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const handleGenerateWithAi = (trainingTitle: string) => {
    if (questionSets.length) {
      setPendingQuestionGeneration({
        trainingTitle,
        existingSetCount: questionSets.length,
      });
      return;
    }

    void generateAiQuestionDrafts(trainingTitle);
  };

  const openQuestionSetConfig = (questionSetId: string) => {
    const targetSet = questionSets.find((questionSet) => questionSet.id === questionSetId);

    if (!targetSet) {
      return;
    }

    activateQuestionSet(questionSetId);
    setQuestionGeneratorConfig((current) => ({
      ...current,
      difficultyLevel: targetSet.difficultyLevel,
      topicTags: [...targetSet.topicTags],
      minimumQuestionsPerSet: Math.min(10, Math.max(1, targetSet.questionCount)),
      maximumQuestionsPerSet: Math.min(10, Math.max(1, targetSet.questionCount)),
      preferredQuestionTypes:
        targetSet.generatedQuestionTypes?.length
          ? [...targetSet.generatedQuestionTypes]
          : current.preferredQuestionTypes,
    }));
    setConfiguringQuestionSetId(questionSetId);
  };

  const handleQuestionSetAccordionToggle = (questionSetId: string) => {
    const isExpanded = expandedQuestionSetMap.has(questionSetId);
    const isActive = activeQuestionSetId === questionSetId;

    if (isExpanded && isActive) {
      setExpandedQuestionSetIds([]);
      return;
    }

    activateQuestionSet(questionSetId, { syncExpanded: false });
    setExpandedQuestionSetIds([questionSetId]);
  };

  const toggleQuestionSection = (
    questionId: string,
    setter: (value: string[] | ((current: string[]) => string[])) => void,
  ) => {
    setter((current) =>
      current.includes(questionId)
        ? current.filter((item) => item !== questionId)
        : [...current, questionId],
    );
  };

  const togglePreferredQuestionType = (questionType: TrainingQuestionCheckpoint["questionType"]) => {
    setQuestionGeneratorConfig((current) => {
      const exists = current.preferredQuestionTypes?.includes(questionType);
      const nextTypes = exists
        ? current.preferredQuestionTypes?.filter((item) => item !== questionType) ?? []
        : [...(current.preferredQuestionTypes ?? []), questionType];

      return {
        ...current,
        preferredQuestionTypes: nextTypes.length ? nextTypes : [questionType],
      };
    });
  };

  const ensureVoiceNarrationAssets = async (values: TrainingSetupValues) => {
    // Only the currently-selected slides (Step 2/4 picker) are part of the saved training —
    // deselected ones stay in slidesDraft so the trainer can bring them back later, but are
    // excluded here just like unselected pages in a print range.
    const selectedSlides = slidesDraft.filter((slide) => selectedNarrationSlideIds.includes(slide.id));

    if (!selectedSlides.length) {
      throw new Error("Select at least one slide before saving this training.");
    }

    if (values.trainingMode !== "voice") {
      return selectedSlides;
    }

    const slidesMissingScript = selectedSlides.filter((slide) => !String(slide.script || "").trim());

    if (slidesMissingScript.length) {
      throw new Error("Every selected slide needs narration text before a voice-mode training can be saved.");
    }

    const apiKey =
      values.ttsMode === "manual" && values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
        ? values.manualApiKey
        : "";

    return Promise.all(
      selectedSlides.map(async (slide) => {
        const script = String(slide.script || "").trim();
        const cacheKey = buildScriptAudioKey(script, {
          provider: values.ttsProvider,
          voiceName: values.voiceName,
          voiceId: values.voiceId,
          modelId: DEFAULT_ELEVENLABS_MODEL_ID,
          apiKey,
          trainingId: initialTraining?.id,
        });

        if (slide.narrationAudio?.src && slide.narrationAudio.cacheKey === cacheKey) {
          return slide;
        }

        const src = await generateScriptAudioDataUri(script, {
          provider: values.ttsProvider,
          voiceName: values.voiceName,
          voiceId: values.voiceId,
          modelId: DEFAULT_ELEVENLABS_MODEL_ID,
          apiKey,
          trainingId: initialTraining?.id,
        });

        return {
          ...slide,
          narrationAudio: {
            src,
            cacheKey,
            provider: values.ttsProvider,
            voiceName: values.voiceName,
            voiceId: values.voiceId,
            updatedAt: new Date().toISOString(),
          },
        };
      }),
    );
  };

  const resolveBuilderTtsApiKey = (values: TrainingSetupValues, language?: TrainingLocalizedVoiceLanguage | null) =>
    String(language?.apiKey || "").trim() ||
    (values.ttsMode === "manual" && values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
      ? values.manualApiKey.trim()
      : "");

  const buildSyncedLocalizedVoiceovers = useCallback(
    (values: TrainingSetupValues) =>
      syncLocalizedVoiceovers({
        current: localizedVoiceoversDraft,
        slides: slidesDraft,
        defaultOption: resolveLanguageOptionFromValue(values.avatarEngineLanguage),
        voiceId: values.voiceId,
        voiceName: values.voiceName || defaultVoiceOption?.name || DEFAULT_ELEVENLABS_VOICE_NAME,
        provider: values.ttsProvider,
        apiKey: values.manualApiKey.trim(),
        askLabel: values.questionButtonLabel,
      }),
    [defaultVoiceOption?.name, localizedVoiceoversDraft, slidesDraft],
  );

  const openLanguageConfiguration = (values: TrainingSetupValues) => {
    const nextConfig = buildSyncedLocalizedVoiceovers(values);
    setLocalizedVoiceoversDraft(nextConfig);
    setLocalizedVoiceoversSnapshot(cloneLocalizedVoiceovers(nextConfig));
    setIsLanguageConfigOpen(true);
  };

  const updateLocalizedLanguageDraft = (
    code: string,
    updater: (language: TrainingLocalizedVoiceLanguage) => TrainingLocalizedVoiceLanguage,
  ) => {
    setLocalizedVoiceoversDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        languages: current.languages.map((language) => (language.code === code ? updater(language) : language)),
      };
    });
  };

  const toggleLanguageLabelsEditor = (code: string) => {
    setExpandedLanguageLabelCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  const handleAddLocalizedLanguage = (values: TrainingSetupValues) => {
    const nextConfig = buildSyncedLocalizedVoiceovers(values);
    const nextOption = supportedLocalizedLanguageOptions.find(
      (option) => !nextConfig.languages.some((language) => language.code === option.code),
    );

    if (!nextOption) {
      toast.info("All supported languages have already been added.");
      return;
    }

    setLocalizedVoiceoversDraft({
      ...nextConfig,
      languages: [
        ...nextConfig.languages,
        createLocalizedLanguageRecord({
          option: nextOption,
          isDefault: false,
          voiceId: values.voiceId,
          voiceName: values.voiceName || defaultVoiceOption?.name || DEFAULT_ELEVENLABS_VOICE_NAME,
          provider: values.ttsProvider,
          apiKey: values.manualApiKey.trim(),
          slides: slidesDraft,
          askLabel: values.questionButtonLabel,
        }),
      ],
    });
  };

  const handleMoveLocalizedLanguage = (code: string, direction: -1 | 1) => {
    setLocalizedVoiceoversDraft((current) => {
      if (!current) {
        return current;
      }

      const index = current.languages.findIndex((language) => language.code === code);

      if (index <= 0 || index + direction < 1 || index + direction >= current.languages.length) {
        return current;
      }

      const nextLanguages = [...current.languages];
      const [item] = nextLanguages.splice(index, 1);
      nextLanguages.splice(index + direction, 0, item);

      return {
        ...current,
        languages: nextLanguages.map((language, languageIndex) => ({
          ...language,
          isDefault: languageIndex === 0,
        })),
      };
    });
  };

  const handleRemoveLocalizedLanguage = (code: string) => {
    setLocalizedVoiceoversDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        languages: current.languages.filter((language) => !(language.isDefault || language.code === code)),
      };
    });
  };

  const setLanguageActionLoading = (
    code: string,
    field: "translating" | "generatingAudio",
    active: boolean,
  ) => {
    setLanguageActionState((current) => ({
      ...current,
      [code]: {
        translating: current[code]?.translating ?? false,
        generatingAudio: current[code]?.generatingAudio ?? false,
        [field]: active,
      },
    }));
  };

  const handleUploadLocalizedSlides = async (fileList: FileList | null, code: string) => {
    const files = Array.from(fileList ?? []);

    if (!files.length) {
      return;
    }

    const importedAssets: SlideMediaImportRecord[] = [];

    try {
      for (const file of files) {
        const extension = getFileExtension(file.name);

        if (file.type === "application/pdf" || extension === "pdf") {
          importedAssets.push(...(await extractPdfPagesToImages(file)));
          continue;
        }

        if (extension === "pptx" || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
          importedAssets.push(...(await extractPptxSlidesToImages(file)));
          continue;
        }

        if (file.type.startsWith("image/")) {
          importedAssets.push(await storeImageFile(file));
        }
      }

      if (!importedAssets.length) {
        toast.error("Upload image, PDF, or PPTX files for language-specific slides.");
        return;
      }

      updateLocalizedLanguageDraft(code, (language) => ({
        ...language,
        translatedSlides: language.translatedSlides.map((slide, index) => {
          const asset = importedAssets[index];

          if (!asset) {
            return slide;
          }

          return {
            ...slide,
            mediaAssetId: asset.id,
            mediaName: asset.name,
            mediaSource: asset.source,
            mediaPageNumber: asset.pageNumber,
            mediaMimeType: asset.mimeType,
            mediaExtractedText: asset.extractedText,
            interactiveHotspots: asset.interactiveHotspots ?? [],
          };
        }),
      }));

      if (importedAssets.length !== slidesDraft.length) {
        toast.info("Slide overrides were mapped by order. Any missing slides will fall back to the default language.");
      } else {
        toast.success("Language-specific slides uploaded.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload localized slides.");
    } finally {
      resetFileInput(localizedLanguageUploadInputRef.current);
      setPendingLocalizedUploadCode(null);
    }
  };

  const handleTranslateLocalizedLanguage = async (code: string, values: TrainingSetupValues) => {
    const nextConfig = buildSyncedLocalizedVoiceovers(values);
    const language = nextConfig.languages.find((item) => item.code === code);

    if (!language || language.isDefault) {
      toast.info("Default language uses the original slide scripts.");
      return;
    }

    setLocalizedVoiceoversDraft(nextConfig);
    setLanguageActionLoading(code, "translating", true);

    try {
      const translatedSlides = await Promise.all(
        slidesDraft.map(async (slide) => {
          const script = String(slide.script || "").trim();
          const existing = language.translatedSlides.find((item) => item.slideId === slide.id);

          if (!script) {
            return {
              ...existing,
              slideId: slide.id,
              script: "",
            };
          }

          const translatedScript = await translateSlideNarration({
            trainingTitle: values.title,
            slideTitle: slide.title,
            script,
            targetLanguage: language.label,
            targetLocale: language.locale,
          });

          return {
            slideId: slide.id,
            script: translatedScript,
            narrationAudio: existing?.script === translatedScript ? cloneNarrationAudioAsset(existing.narrationAudio) : null,
            translatedAt: new Date().toISOString(),
            audioUpdatedAt: existing?.script === translatedScript ? existing?.audioUpdatedAt ?? null : null,
            mediaAssetId: existing?.mediaAssetId ?? null,
            mediaName: existing?.mediaName ?? null,
            mediaSource: existing?.mediaSource ?? null,
            mediaPageNumber: existing?.mediaPageNumber ?? null,
            mediaMimeType: existing?.mediaMimeType ?? null,
            mediaExtractedText: [...(existing?.mediaExtractedText ?? [])],
            interactiveHotspots: [...(existing?.interactiveHotspots ?? [])],
          };
        }),
      );

      updateLocalizedLanguageDraft(code, (current) => ({
        ...current,
        translatedSlides,
      }));
      toast.success(`${language.label} scripts translated.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to translate scripts for this language.");
    } finally {
      setLanguageActionLoading(code, "translating", false);
    }
  };

  const handleGenerateLocalizedAudio = async (code: string, values: TrainingSetupValues) => {
    const nextConfig = buildSyncedLocalizedVoiceovers(values);
    const language = nextConfig.languages.find((item) => item.code === code);

    if (!language || language.isDefault) {
      toast.info("Default language uses the primary training voiceover.");
      return;
    }

    if (!language.translatedSlides.some((slide) => String(slide.script || "").trim())) {
      toast.error("Translate scripts before generating audio.");
      return;
    }

    setLocalizedVoiceoversDraft(nextConfig);
    setLanguageActionLoading(code, "generatingAudio", true);

    try {
      const apiKey = resolveBuilderTtsApiKey(values, language);
      const translatedSlides = await Promise.all(
        language.translatedSlides.map(async (slide) => {
          const script = String(slide.script || "").trim();

          if (!script) {
            return {
              ...slide,
              narrationAudio: null,
              audioUpdatedAt: null,
            };
          }

          const src = await generateScriptAudioDataUri(script, {
            provider: language.provider,
            voiceName: language.voiceName,
            voiceId: language.voiceId,
            modelId: DEFAULT_ELEVENLABS_MODEL_ID,
            apiKey,
            trainingId: initialTraining?.id,
          });
          const cacheKey = buildScriptAudioKey(script, {
            provider: language.provider,
            voiceName: language.voiceName,
            voiceId: language.voiceId,
            modelId: DEFAULT_ELEVENLABS_MODEL_ID,
            apiKey,
            trainingId: initialTraining?.id,
          });

          return {
            ...slide,
            narrationAudio: {
              src,
              cacheKey,
              provider: language.provider,
              voiceName: language.voiceName,
              voiceId: language.voiceId,
              updatedAt: new Date().toISOString(),
            },
            audioUpdatedAt: new Date().toISOString(),
          };
        }),
      );

      updateLocalizedLanguageDraft(code, (current) => ({
        ...current,
        translatedSlides,
      }));
      toast.success(`${language.label} audio generated.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate localized audio.");
    } finally {
      setLanguageActionLoading(code, "generatingAudio", false);
    }
  };

  const saveSlideFormBuilder = (slideId: string, formFields: TrainingFormField[], formConfig: TrainingFormConfig) => {
    updateSlide(slideId, (current) => ({
      ...current,
      formFields,
      formConfig,
    }));
    setFormBuilderSlideId(null);
    toast.success("Form settings saved.");
  };

  const toggleSlideSettings = (slideId: string) => {
    setExpandedManageSlideId((current) => (current === slideId ? null : slideId));
  };

  const toggleSlideInfoEditor = (slideId: string) => {
    setInfoEditorSlideId((current) => (current === slideId ? null : slideId));
  };

  const renderSlideAdditionalSettings = (slide: TrainingSlideRecord) => {
    const slideFormConfig = ensureFormConfig(slide.formConfig);
    const showInfoEditor = infoEditorSlideId === slide.id || Boolean(slide.additionalInfo);

    return (
      <div className="training-slide-settings-panel">
        <div className="row g-4">
          <div className="col-12 col-xl-4">
            <div className="training-setting-group training-slide-manage-card">
              <div className="training-slide-manage-icon">
                <i className="bi bi-list-task" aria-hidden="true" />
              </div>
              <div className="training-builder-subcaption">Form</div>
              <button
                type="button"
                className="btn btn-light w-100 justify-content-center mb-2"
                onClick={() => setFormBuilderSlideId(slide.id)}
              >
                <i className="bi bi-list-task" aria-hidden="true" /> {slide.formFields.length ? "Edit Form" : "Add Form"}
              </button>
              <div className="small text-body-secondary mb-3">
                Add a form to collect text, numbers, audio, video, or structured selections inside this slide.
              </div>
              <div className="training-form-summary card border mb-3">
                <div className="card-body">
                  <div className="small text-body-secondary mb-2">
                    {slide.formFields.length
                      ? `${slide.formFields.length} element${slide.formFields.length === 1 ? "" : "s"} configured`
                      : "No form elements added yet"}
                  </div>
                  <div className="d-flex flex-wrap gap-2 mb-2">
                    {slide.formFields.map((field) => (
                      <span key={field.id} className="badge text-bg-light border text-dark">
                        {field.label}
                      </span>
                    ))}
                  </div>
                  <div className="small text-body-secondary">
                    Wait for submit: {slideFormConfig.waitForSubmit ? "Yes" : "No"} | Timer: {slideFormConfig.timer}
                  </div>
                  {slide.formFields.length ? (
                    <TrainingSlideForm fields={slide.formFields} formConfig={slideFormConfig} mode="readonly" className="mt-3" />
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-xl-4">
            <div className="training-setting-group training-slide-manage-card">
              <div className="training-slide-manage-icon">
                <i className="bi bi-link-45deg" aria-hidden="true" />
              </div>
              <div className="training-builder-subcaption">Interactive Links &amp; Videos</div>
              <div className="small text-body-secondary mb-3">
                Manage slide-specific buttons for product videos, external pages, or reference links.
              </div>
              <div className="d-flex gap-2 flex-wrap mb-3">
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={() => addSlideHotspot(slide.id, "link")}
                >
                  <i className="bi bi-link-45deg me-1" />
                  Add Link
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={() => addSlideHotspot(slide.id, "video")}
                >
                  <i className="bi bi-play-circle me-1" />
                  Add Video
                </button>
              </div>

              {(slide.interactiveHotspots ?? []).length ? (
                <div className="training-slide-hotspot-list training-slide-hotspot-list--compact">
                  {(slide.interactiveHotspots ?? []).map((hotspot, hotspotIndex, hotspots) => {
                    const normalizedUrl = String(hotspot.url || "").trim();
                    const isUrlReady = !normalizedUrl || isValidUrl(normalizedUrl);
                    const kindCount = hotspots.filter((item) => item.kind === hotspot.kind).length;
                    const kindIndex =
                      hotspots
                        .slice(0, hotspotIndex + 1)
                        .filter((item) => item.kind === hotspot.kind).length - 1;

                    return (
                      <div key={hotspot.id} className="training-slide-hotspot-item">
                        <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-3">
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <span className={`badge ${hotspot.kind === "video" ? "text-bg-danger" : "text-bg-primary"}`}>
                              {hotspot.kind === "video" ? "Video" : "Link"}
                            </span>
                            <span className="small text-body-secondary">
                              {getHotspotActionText(hotspot, kindIndex, kindCount)}
                            </span>
                          </div>
                          <div className="d-flex gap-2">
                            {isUrlReady && normalizedUrl ? (
                              <a
                                href={normalizedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-sm btn-outline-secondary"
                              >
                                Open
                              </a>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => removeSlideHotspot(slide.id, hotspot.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="row g-3">
                          <div className="col-12 col-md-4">
                            <label className="form-label">Type</label>
                            <select
                              className="form-select"
                              value={hotspot.kind}
                              onChange={(event) => {
                                const nextKind = event.target.value as TrainingInteractiveHotspot["kind"];
                                updateSlideHotspot(slide.id, hotspot.id, (current) => ({
                                  ...current,
                                  kind: nextKind,
                                  label:
                                    current.label.trim() &&
                                      current.label !== "Open link" &&
                                      current.label !== "Open video"
                                      ? current.label
                                      : nextKind === "video"
                                        ? "Open video"
                                        : "Open link",
                                }));
                              }}
                            >
                              <option value="link">Link</option>
                              <option value="video">Video</option>
                            </select>
                          </div>
                          <div className="col-12 col-md-8">
                            <label className="form-label">Button Label</label>
                            <input
                              className="form-control"
                              value={hotspot.label}
                              onChange={(event) =>
                                updateSlideHotspot(slide.id, hotspot.id, (current) => ({
                                  ...current,
                                  label: event.target.value,
                                }))
                              }
                              placeholder={hotspot.kind === "video" ? "Open video" : "Open link"}
                            />
                          </div>
                          <div className="col-12">
                            <label className="form-label">URL</label>
                            <input
                              className={`form-control${!isUrlReady ? " is-invalid" : ""}`}
                              value={hotspot.url}
                              onChange={(event) =>
                                updateSlideHotspot(slide.id, hotspot.id, (current) => ({
                                  ...current,
                                  url: event.target.value,
                                }))
                              }
                              placeholder={hotspot.kind === "video" ? "https://youtube.com/watch?v=..." : "https://example.com"}
                            />
                            {!isUrlReady ? (
                              <div className="invalid-feedback">Use a valid URL starting with http or https.</div>
                            ) : (
                              <div className="small text-body-secondary mt-1">
                                This will appear as a centered launch button for the learner.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="training-slide-hotspot-empty">
                  No link or video configured yet.
                </div>
              )}
            </div>
          </div>

          <div className="col-12 col-xl-4">
            <div className="training-setting-group training-slide-manage-card">
              <div className="training-slide-manage-icon">
                <i className="bi bi-info-circle" aria-hidden="true" />
              </div>
              <div className="training-builder-subcaption">Additional Slide Information</div>
              <button
                type="button"
                className="btn btn-light w-100 justify-content-center mb-2"
                onClick={() => toggleSlideInfoEditor(slide.id)}
              >
                <i className="bi bi-info-circle" aria-hidden="true" /> Add More Information
              </button>
              <div className="small text-body-secondary mb-3">
                Provide extra context your avatar can use while answering slide-specific questions.
              </div>

              {showInfoEditor ? (
                <textarea
                  className="form-control mb-3"
                  rows={5}
                  value={slide.additionalInfo}
                  onChange={(event) =>
                    updateSlide(slide.id, (current) => ({
                      ...current,
                      additionalInfo: event.target.value,
                    }))
                  }
                />
              ) : null}

              {slide.additionalInfo ? <div className="training-setting-info-card">{slide.additionalInfo}</div> : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Shared thumbnail-grid + range-input picker for choosing which slides get narration.
  // Used on Step 2 (right after upload) and again from Step 4 behind the "Add / Remove
  // Slides" toggle, so a trainer who missed slides earlier can revise the selection.
  const renderSlideSelectionPicker = (helperText: string) => (
    <div className="training-slide-select-panel">
      <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
        <div>
          <h5 className="mb-1">Select Slides for Narration</h5>
          <p className="text-muted mb-0">{helperText}</p>
        </div>
        <span className="badge text-bg-light border text-dark">
          {selectedNarrationSlideIds.length} of {slidesDraft.length} selected
        </span>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <button
          type="button"
          className="btn btn-sm btn-light"
          onClick={() => setSelectedNarrationSlideIds(slidesDraft.map((slide) => slide.id))}
        >
          Select All
        </button>
        <button
          type="button"
          className="btn btn-sm btn-light"
          onClick={() => setSelectedNarrationSlideIds([])}
        >
          Clear Selection
        </button>
        <div className="d-flex align-items-center gap-2 ms-auto">
          <input
            type="text"
            className="form-control form-control-sm"
            style={{ maxWidth: 220 }}
            placeholder="e.g. 1-10, 45-50"
            value={slideRangeInput}
            onChange={(event) => setSlideRangeInput(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() => {
              const positions = parseSlideRangeSelection(slideRangeInput, slidesDraft.length);

              if (!positions.size) {
                toast.error("Enter a valid slide range, e.g. 1-10, 45-50.");
                return;
              }

              const rangeIds = slidesDraft
                .filter((_, index) => positions.has(index + 1))
                .map((slide) => slide.id);

              // Replaces the selection (like a print dialog's page-range field) instead of
              // adding to it, so applying a range after "Select All" visibly narrows it down.
              setSelectedNarrationSlideIds(rangeIds);
              setSlideRangeInput("");
            }}
          >
            Apply Range
          </button>
        </div>
      </div>

      <div className="training-slide-select-grid">
        {slidesDraft.map((slide, index) => {
          const isChecked = selectedNarrationSlideIds.includes(slide.id);

          return (
            <label
              key={slide.id}
              className={`training-slide-select-thumb${isChecked ? " is-selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) =>
                  setSelectedNarrationSlideIds((current) =>
                    event.target.checked
                      ? Array.from(new Set([...current, slide.id]))
                      : current.filter((id) => id !== slide.id),
                  )
                }
              />
              <SlideMediaPreview
                slide={slide}
                accentColor={slide.color}
                hideBadge
                className="training-slide-select-thumb-media"
              />
              <span className="training-slide-select-thumb-label">Slide {index + 1}</span>
            </label>
          );
        })}
      </div>
    </div>
  );

  const renderEditableSlideCard = ({
    slide,
    index,
    trainingTitle,
    trainingMode,
    ttsProvider,
    voiceName,
    voiceId,
    ttsApiKey,
    trainingId,
    deleteLabel = "Delete",
    onDelete,
    fallbackNote,
  }: {
    slide: TrainingSlideRecord;
    index: number;
    trainingTitle: string;
    trainingMode: TrainingMode;
    ttsProvider: string;
    voiceName: string;
    voiceId: string;
    ttsApiKey?: string;
    trainingId?: string;
    deleteLabel?: string;
    onDelete?: () => void;
    fallbackNote: string;
  }) => {
    const isExpanded = expandedManageSlideId === slide.id;

    return (
      <div key={slide.id} className="card border training-slide-editor">
        <div className="card-header bg-transparent d-flex align-items-center justify-content-between gap-3 flex-wrap">
          <div className="d-flex align-items-center gap-2">
            <span className="badge" style={{ backgroundColor: `${slide.color}20`, color: slide.color }}>
              Slide {index + 1}
            </span>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-light" onClick={() => moveSlide(slide.id, -1)}>
              <i className="bi bi-arrow-up" />
            </button>
            <button type="button" className="btn btn-sm btn-light" onClick={() => moveSlide(slide.id, 1)}>
              <i className="bi bi-arrow-down" />
            </button>
            {onDelete ? (
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={onDelete}>
                {deleteLabel}
              </button>
            ) : null}
          </div>
        </div>
        <div className="card-body">
          <div className="row g-4">
            <div className="col-12 col-xl-4">
              <div className="training-preview-card training-builder-preview-card" style={{ borderColor: `${slide.color}55` }}>
                <label className="form-label">Background Media</label>
                <SlideMediaPreview
                  slide={slide}
                  accentColor={slide.color}
                  showLink
                  hideBadge
                  className="mt-1"
                  onRemove={
                    slide.mediaAssetId
                      ? () => {
                        clearSlideMedia(slide.id);
                        toast.info("Slide media removed. You can upload a new file or restore the previous one.");
                      }
                      : undefined
                  }
                  onUpload={() => {
                    setPendingSlideUploadId(slide.id);
                    slideMediaInputRef.current?.click();
                  }}
                  uploadLabel={slide.mediaAssetId ? "Replace slide media" : "Upload slide media"}
                  showRestore={Boolean(!slide.mediaAssetId && slide.removedMedia?.assetId)}
                  onRestore={() => {
                    restoreSlideMedia(slide.id);
                    toast.success("Previous slide media restored.");
                  }}
                  fallbackNote={fallbackNote}
                />
              </div>
            </div>
            <div className="col-12 col-xl-8">
              <div className="d-flex align-items-center justify-content-between gap-3 mb-2 flex-wrap">
                <label className="form-label mb-0">Script Narration</label>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => {
                    void regenerateSlideScript(slide.id, trainingTitle);
                  }}
                >
                  Regenerate Summary
                </button>
              </div>
              <textarea
                className="form-control"
                rows={6}
                value={slide.script}
                onChange={(event) =>
                  updateSlide(slide.id, (current) => ({ ...current, script: event.target.value }))
                }
              />
              <div className="small text-body-secondary mt-2">
                {trainingMode === "voice"
                  ? "Voice mode uses the saved narration script for launch playback. Save after script edits to keep playback aligned."
                  : "Audio is generated from the current script narration and updates automatically."}
              </div>
              <ScriptAudioPlayer
                script={slide.script}
                provider={ttsProvider}
                voiceName={voiceName}
                voiceId={voiceId}
                modelId={DEFAULT_ELEVENLABS_MODEL_ID}
                apiKey={ttsApiKey}
                trainingId={trainingId}
                className="mt-3"
              />
            </div>
          </div>
          <div className="training-slide-settings-toggle mt-4">
            <button
              type="button"
              className="training-slide-settings-trigger"
              onClick={() => toggleSlideSettings(slide.id)}
            >
              <span>Additional Settings</span>
              <i className={`bi ${isExpanded ? "bi-chevron-up" : "bi-chevron-down"}`} aria-hidden="true" />
            </button>

            {isExpanded ? renderSlideAdditionalSettings(slide) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderQuestionCheckpointCard = (
    checkpoint: TrainingQuestionCheckpoint,
    index: number,
    options: {
      questionSetId: string;
      isActiveSet: boolean;
    },
  ) => {
    const previewOptions = isChoiceQuestionType(checkpoint.questionType) ? checkpoint.options : [];
    const isEditing = editingQuestionMap.has(checkpoint.id);
    const editDraft = questionEditDrafts[checkpoint.id];

    return (
      <div
        key={checkpoint.id}
        className="card border training-slide-editor"
        draggable={!isEditing}
        onDragStart={() => {
          if (!isEditing) {
            setDraggedQuestionId(checkpoint.id);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (!isEditing && draggedQuestionId) {
            reorderQuestionCheckpoint(draggedQuestionId, checkpoint.id);
          }
          setDraggedQuestionId(null);
        }}
        onDragEnd={() => setDraggedQuestionId(null)}
      >
        <div className="card-header bg-transparent d-flex align-items-center justify-content-between gap-3 flex-wrap">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="badge text-bg-primary">Question {index + 1}</span>
            {checkpoint.generatedBy === "manual" ? <span className="badge text-bg-light border text-dark">Manual</span> : null}
            {checkpoint.manualEdits ? <span className="badge text-bg-warning">Edited</span> : null}
          </div>
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={() => openQuestionEditor(checkpoint, options.questionSetId)}
            >
              {options.isActiveSet ? (isEditing ? "Editing" : "Edit") : "Switch to Edit"}
            </button>
            <button type="button" className="btn btn-sm btn-light" onClick={() => removeQuestionCheckpoint(checkpoint.id)}>
              Remove
            </button>
          </div>
        </div>
        <div className="card-body">
          <div className="training-preview-card training-question-preview-card h-100">
            {isEditing && editDraft ? (
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label">Question Prompt</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={editDraft.prompt}
                    onChange={(event) =>
                      updateQuestionEditDraft(checkpoint.id, (current) => ({
                        ...current,
                        prompt: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="col-12 col-md-4">
                  <label className="form-label">Question Type</label>
                  <select
                    className="form-select"
                    value={editDraft.questionType}
                    onChange={(event) =>
                      updateQuestionEditDraft(checkpoint.id, (current) => {
                        const nextQuestionType = event.target.value as TrainingQuestionCheckpoint["questionType"];
                        const nextOptions =
                          isChoiceQuestionType(nextQuestionType)
                            ? current.options.length
                              ? current.options
                              : ["", ""]
                            : current.options;

                        return {
                          ...current,
                          questionType: nextQuestionType,
                          options: nextOptions,
                        };
                      })
                    }
                  >
                    {editableQuestionTypes.map((questionType) => (
                      <option key={`${checkpoint.id}-${questionType}`} value={questionType}>
                        {humanizeTrainingQuestionType(questionType)}
                      </option>
                    ))}
                  </select>
                </div>
                {isChoiceQuestionType(editDraft.questionType) ? (
                  <div className="col-12">
                    <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-2">
                      <label className="form-label mb-0">Answer Options</label>
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() =>
                          updateQuestionEditDraft(checkpoint.id, (current) => ({
                            ...current,
                            options: [...current.options, ""],
                          }))
                        }
                      >
                        Add Option
                      </button>
                    </div>
                    <div className="d-grid gap-2">
                      {editDraft.options.map((option, optionIndex) => (
                        <div key={`${checkpoint.id}-option-${optionIndex}`} className="d-flex gap-2">
                          <input
                            className="form-control"
                            value={option}
                            placeholder={`Option ${optionIndex + 1}`}
                            onChange={(event) =>
                              updateQuestionEditDraft(checkpoint.id, (current) => ({
                                ...current,
                                options: current.options.map((currentOption, currentIndex) =>
                                  currentIndex === optionIndex ? event.target.value : currentOption,
                                ),
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-light"
                            disabled={editDraft.options.length <= 2}
                            onClick={() =>
                              updateQuestionEditDraft(checkpoint.id, (current) => ({
                                ...current,
                                options: current.options.filter((_, currentIndex) => currentIndex !== optionIndex),
                              }))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="form-text">Choice-based questions need at least two answer options.</div>
                  </div>
                ) : null}
                <div className="col-12">
                  <div className="d-flex gap-2 flex-wrap">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => saveQuestionEditor(checkpoint.id)}>
                      Save Question
                    </button>
                    <button type="button" className="btn btn-light btn-sm" onClick={() => closeQuestionEditor(checkpoint.id)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="training-question-preview-prompt">{checkpoint.prompt}</div>
                {previewOptions.length ? (
                  <div className="training-question-preview-options">
                    {previewOptions.map((option, optionIndex) => (
                      <div key={`${checkpoint.id}-${optionIndex}`} className="training-question-preview-option">
                        <span className="training-question-preview-option-marker" aria-hidden="true" />
                        <span>{option}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            <div className="d-flex gap-2 flex-wrap mt-3">
              <button
                type="button"
                className="btn btn-sm btn-light"
                onClick={() => toggleQuestionSection(checkpoint.id, setExpandedQuestionSettingIds)}
              >
                {expandedQuestionSettingMap.has(checkpoint.id) ? "Hide Additional Settings" : "Additional Settings"}
              </button>
            </div>
            {expandedQuestionSettingMap.has(checkpoint.id) ? (
              <div className="mt-3 pt-3 border-top">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label">Expected Answer</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={checkpoint.expectedAnswer}
                      onChange={(event) =>
                        updateQuestionCheckpoint(checkpoint.id, (current) => ({
                          ...current,
                          expectedAnswer: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Keyword Match Rules</label>
                    <input
                      className="form-control"
                      value={checkpoint.keywordMatches.join(", ")}
                      onChange={(event) =>
                        updateQuestionCheckpoint(checkpoint.id, (current) => ({
                          ...current,
                          keywordMatches: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const handleImportFiles = async (fileList: FileList | null, trainingTitle: string) => {
    if (!fileList?.length) {
      return;
    }

    const files = Array.from(fileList);

    setIsImportingMedia(true);

    try {
      const nextImports: ImportedUploadRecord[] = [];
      const nextSlides: TrainingSlideRecord[] = [];

      for (const file of files) {
        const extension = getFileExtension(file.name);

        if (file.type === "application/pdf" || extension === "pdf") {
          const assets = await extractPdfPagesToImages(file);
          const slides = assets.map((asset, assetIndex) => {
            const slideIndex = nextSlides.length + assetIndex;
            const slideTitle = `${trainingTitle || getFileStem(file.name)} - Slide ${assetIndex + 1}`;
            return buildSlideFromImportedMedia({
              asset,
              slideIndex,
              slideTitle,
            });
          });

          nextImports.push({
            id: `upload-${Date.now()}-${file.name}`,
            fileName: file.name,
            kind: "pdf",
            slideCount: slides.length,
            slideIds: slides.map((slide) => slide.id),
            assetIds: assets.map((asset) => asset.id),
          });
          nextSlides.push(...slides);
          continue;
        }

        if (extension === "pptx" || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
          const assets = await extractPptxSlidesToImages(file);
          const slides = assets.map((asset, assetIndex) => {
            const slideIndex = nextSlides.length + assetIndex;
            const slideTitle = asset.extractedText[0] || `${trainingTitle || getFileStem(file.name)} - Slide ${assetIndex + 1}`;
            return buildSlideFromImportedMedia({
              asset,
              slideIndex,
              slideTitle,
            });
          });

          nextImports.push({
            id: `upload-${Date.now()}-${file.name}`,
            fileName: file.name,
            kind: "ppt",
            slideCount: slides.length,
            slideIds: slides.map((slide) => slide.id),
            assetIds: assets.map((asset) => asset.id),
          });
          nextSlides.push(...slides);
          continue;
        }

        if (extension === "ppt") {
          throw new Error("Legacy .ppt files cannot be extracted in-browser. Please upload the deck as PDF or PPTX.");
        }
      }

      if (!nextSlides.length) {
        toast.error("Upload PDF or PPTX files only in this import flow.");
        return;
      }

      setSlidesDraft(nextSlides);
      setUploadedFiles(nextImports);
      setSelectedNarrationSlideIds(nextSlides.map((slide) => slide.id));
      toast.success(`${nextSlides.length} slide${nextSlides.length === 1 ? "" : "s"} imported successfully.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to process the selected files.");
    } finally {
      setIsImportingMedia(false);
      resetFileInput(uploadInputRef.current);
    }
  };

  const handleReplaceSlideMedia = async (fileList: FileList | null, slideId: string) => {
    const file = fileList?.[0];

    if (!file) {
      return;
    }

    try {
      let asset: SlideMediaImportRecord | null = null;

      if (file.type === "application/pdf") {
        const assets = await extractPdfPagesToImages(file);
        asset = assets[0] ?? null;

        if (assets.length > 1) {
          toast.info("Only the first PDF page was used for this slide.");
        }
      } else if (file.type.startsWith("image/")) {
        asset = await storeImageFile(file);
      }

      if (!asset) {
        toast.error("Upload an image or a PDF file to update the slide background.");
        return;
      }

      updateSlide(slideId, (current) => ({
        ...current,
        mediaAssetId: asset.id,
        mediaName: asset.name,
        mediaSource: asset.source,
        mediaPageNumber: asset.pageNumber,
        mediaMimeType: asset.mimeType,
        mediaExtractedText: asset.extractedText,
        interactiveHotspots: asset.interactiveHotspots ?? [],
        uploaded: true,
        removedMedia: current.removedMedia,
        script: current.script.trim().length > 0 ? current.script : "",
        points: buildSlidePoints(current.title, getFileStem(asset.name), asset.extractedText),
      }));

      toast.success("Slide background updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the slide background.");
    } finally {
      setPendingSlideUploadId(null);
      resetFileInput(slideMediaInputRef.current);
    }
  };

  const handlePreviewThumbnailUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Upload an image file for the launch cover thumbnail.");
      resetFileInput(previewThumbnailInputRef.current);
      return;
    }

    setIsUploadingPreviewThumbnail(true);
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    try {
      const asset = await storeImageFile(file);
      setPreviewThumbnailAssetId(asset.id);
      setPreviewThumbnailAssetName(asset.name);
      toast.success("Launch cover thumbnail updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload the launch cover thumbnail.");
    } finally {
      setIsUploadingPreviewThumbnail(false);
      resetFileInput(previewThumbnailInputRef.current);
    }
  };

  const removeImportedBatch = async (batchId: string) => {
    const batch = uploadedFiles.find((item) => item.id === batchId);

    if (!batch) {
      return;
    }

    await Promise.all(batch.assetIds.map((assetId) => removeSlideMediaAsset(assetId).catch(() => undefined)));

    setUploadedFiles((current) => current.filter((item) => item.id !== batchId));
    setSlidesDraft((current) => {
      const filtered = current.filter((slide) => !batch.slideIds.includes(slide.id));
      return filtered.length ? filtered : [buildBlankSlide(0)];
    });
    setSelectedNarrationSlideIds((current) => current.filter((id) => !batch.slideIds.includes(id)));
    toast.info("Imported media removed.");
  };

  const regenerateSlideScript = async (slideId: string, trainingTitle: string) => {
    const slideIndex = slidesDraft.findIndex((item) => item.id === slideId);

    const currentSlide = slidesDraft.find((item) => item.id === slideId);

    if (!currentSlide) {
      return;
    }

    const nextScript = await generateSlideScript({
      trainingTitle,
      slideTitle: currentSlide.title,
      mediaLabel: getFileStem(currentSlide.mediaName),
      extractedText: currentSlide.mediaExtractedText,
      index: slideIndex < 0 ? 0 : slideIndex,
    });

    updateSlide(slideId, (current) => ({
      ...current,
      script: nextScript,
    }));
    toast.success("Slide summary regenerated.");
  };

  const moveSlide = (slideId: string, direction: -1 | 1) => {
    setSlidesDraft((current) => {
      const index = current.findIndex((slide) => slide.id === slideId);
      const targetIndex = index + direction;

      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleStepTwoNext = async (trainingTitle: string) => {
    if (mode === "upload" && !hasUploadedMedia) {
      toast.error("Upload at least one PPTX or PDF deck before moving ahead.");
      return;
    }

    if (mode === "upload") {
      if (!selectedNarrationSlideIds.length) {
        toast.error("Select at least one slide to generate narration for.");
        return;
      }

      const normalizedCurrentPrompt = scriptPrompt.trim();
      const normalizedLastGeneratedPrompt = lastGeneratedScriptPrompt.trim();
      const selectedSlides = slidesDraft.filter((slide) => selectedNarrationSlideIds.includes(slide.id));
      const hasExistingScripts = selectedSlides.some((slide) => slide.script.trim());
      const promptChangedSinceGeneration =
        Boolean(normalizedLastGeneratedPrompt) && normalizedCurrentPrompt !== normalizedLastGeneratedPrompt;

      if (hasExistingScripts && promptChangedSinceGeneration) {
        setPendingScriptRegeneration({ trainingTitle });
        return;
      }

      const needsScriptGeneration = selectedSlides.some(
        (slide) =>
          !slide.script.trim() &&
          (slide.mediaExtractedText?.length || slide.mediaName.trim()),
      );

      if (needsScriptGeneration) {
        setIsGeneratingSlideScripts(true);

        try {
          const updatedSlides = await generateScriptsForSlides(selectedSlides, trainingTitle);
          setSlidesDraft((current) => mergeSlidesById(current, updatedSlides));
          setLastGeneratedScriptPrompt(normalizedCurrentPrompt);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to generate slide narration scripts.",
          );
          setIsGeneratingSlideScripts(false);
          return;
        } finally {
          setIsGeneratingSlideScripts(false);
        }
      }
    }

    setStep(3);
  };

  const handleRegenerateScriptsWithLatestPrompt = async () => {
    if (!pendingScriptRegeneration) {
      return;
    }

    setIsGeneratingSlideScripts(true);

    try {
      const selectedSlides = slidesDraft.filter((slide) => selectedNarrationSlideIds.includes(slide.id));
      const updatedSlides = await generateScriptsForSlides(
        selectedSlides,
        pendingScriptRegeneration.trainingTitle,
        { forceAll: true },
      );
      setSlidesDraft((current) => mergeSlidesById(current, updatedSlides));
      setLastGeneratedScriptPrompt(scriptPrompt.trim());
      setPendingScriptRegeneration(null);
      setStep(3);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to regenerate slide narration scripts.",
      );
    } finally {
      setIsGeneratingSlideScripts(false);
    }
  };

  // Step 4 catch-up action: generate narration for whatever is currently selected but was
  // skipped in Step 2 (e.g. the trainer remembers a missed slide). Never overwrites a slide
  // that already has a script — use the per-slide "Regenerate Summary" button for that.
  const handleGenerateNarrationForSelected = async (trainingTitle: string) => {
    const pendingSlides = slidesDraft.filter(
      (slide) =>
        selectedNarrationSlideIds.includes(slide.id) &&
        !slide.script.trim() &&
        (slide.mediaExtractedText?.length || slide.mediaName.trim()),
    );

    if (!pendingSlides.length) {
      toast.info("No selected slides are missing narration.");
      return;
    }

    setIsGeneratingSlideScripts(true);

    try {
      const updatedSlides = await generateScriptsForSlides(pendingSlides, trainingTitle);
      setSlidesDraft((current) => mergeSlidesById(current, updatedSlides));
      toast.success(`Narration generated for ${updatedSlides.length} slide${updatedSlides.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to generate slide narration scripts.",
      );
    } finally {
      setIsGeneratingSlideScripts(false);
    }
  };

  const persistTrainingRecord = async (values: TrainingSetupValues, status: TrainingStatus) => {
    try {
      const todayLabel = getTodayLabel();
      const resolvedSlides = await ensureVoiceNarrationAssets(values);
      const nextQuestionReviewStatus: TrainingQuestionCheckpoint["reviewStatus"] =
        status === "review" ? "review" : status === "approved" ? "approved" : "draft";
      const fallbackQuestionSet =
        !questionSets.length && questionCheckpoints.length
          ? [
            buildQuestionSetRecord({
              setId: activeQuestionSetId ?? `question-set-${Date.now()}`,
              label:
                activeQuestionSet?.label ||
                buildQuestionSetLabel(
                  activeQuestionSet?.slideTitle || resolvedSlides[0]?.title || "Training Slide",
                  1,
                ),
              placementMode: activeQuestionSet?.placementMode || "after_slide",
              slideId: activeQuestionSet?.slideId ?? resolvedSlides[0]?.id ?? null,
              slideTitle: activeQuestionSet?.slideTitle || resolvedSlides[0]?.title || "",
              difficultyLevel: activeQuestionSet?.difficultyLevel ?? questionGeneratorConfig.difficultyLevel,
              topicTags: activeQuestionSet?.topicTags ?? questionGeneratorConfig.topicTags,
              checkpoints: questionCheckpoints,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              isActive: true,
              isMandatory: activeQuestionSet?.isMandatory ?? true,
              sourceIds: activeQuestionSet?.sourceIds,
              sourceLabels: activeQuestionSet?.sourceLabels,
              sourceSlideIds: activeQuestionSet?.sourceSlideIds,
              sourceRangeLabel: activeQuestionSet?.sourceRangeLabel,
              plannerSummary: activeQuestionSet?.plannerSummary,
              generatedQuestionTypes: activeQuestionSet?.generatedQuestionTypes,
              generationStrategy: activeQuestionSet?.generationStrategy,
            }),
          ]
          : [];
      const resolvedActiveSetId = activeQuestionSetId ?? fallbackQuestionSet[0]?.id ?? null;
      const syncedQuestionSets = (fallbackQuestionSet.length ? fallbackQuestionSet : syncQuestionSetsWithActiveDraft()).map((questionSet) => ({
        ...questionSet,
        isActive: questionSet.id === resolvedActiveSetId,
        checkpoints: questionSet.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          reviewStatus: nextQuestionReviewStatus,
        })),
      }));
      const activeSet =
        syncedQuestionSets.find((questionSet) => questionSet.id === resolvedActiveSetId) ??
        syncedQuestionSets[0] ??
        null;
      const activeQuestionCheckpoints = activeSet?.checkpoints ?? [];
      const resolvedLocalizedVoiceovers = sanitizeLocalizedVoiceoversForStorage(
        buildSyncedLocalizedVoiceovers(values),
      );
      const resolvedTrainingType =
        values.type === "Other" && values.typeCustom.trim()
          ? values.typeCustom.trim()
          : values.type;
      const record: TrainingWorkspaceRecord = {
        id: initialTraining?.id ?? `T${String(Date.now()).slice(-6)}`,
        title: values.title,
        type: resolvedTrainingType,
        audience: initialTraining?.audience || values.audience || "All Learners",
        trainer: initialTraining?.trainer ?? currentUserName,
        status,
        created: initialTraining?.created ?? todayLabel,
        submittedOn: status === "review" ? todayLabel : initialTraining?.submittedOn ?? null,
        approvedOn: status === "approved" ? initialTraining?.approvedOn ?? todayLabel : null,
        lastActivity: "Today",
        trainingMode: values.trainingMode,
        avatarName: values.avatarName,
        avatarId: values.avatarId,
        ttsMode: values.ttsMode,
        ttsProvider: values.ttsProvider,
        voiceName: values.voiceName,
        voiceId: values.voiceId,
        manualTtsApiKey:
          values.ttsMode === "manual"
            ? values.manualApiKey.trim()
            : "",
        manualTtsApiKeyVerifiedAt:
          values.ttsMode === "manual" && values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
            ? values.manualApiKeyVerifiedAt || new Date().toISOString()
            : values.ttsMode === "manual" && values.manualApiKey.trim()
              ? new Date().toISOString()
              : null,
        presenterNotes: values.presenterNotes,
        questionButtonLabel: values.questionButtonLabel,
        askSystemPrompt: values.askSystemPrompt.trim(),
        scriptPrompt,
        previewSlideId:
          previewSlideId &&
          previewSlideId !== resolvedSlides[0]?.id &&
          resolvedSlides.some((slide) => slide.id === previewSlideId)
            ? previewSlideId
            : null,
        previewThumbnailAssetId: previewThumbnailAssetId || null,
        previewThumbnailAssetName: previewThumbnailAssetName || null,
        knowledgeDocuments,
        questionGeneratorConfig: {
          ...questionGeneratorConfig,
          totalQuestions: syncedQuestionSets.reduce((sum, questionSet) => sum + questionSet.questionCount, 0),
          activeSetId: activeSet?.id ?? null,
        },
        localizedVoiceovers: resolvedLocalizedVoiceovers,
        questionCheckpoints: activeQuestionCheckpoints,
        questionSets: syncedQuestionSets,
        isPublished: initialTraining?.isPublished ?? false,
        publishedOn: initialTraining?.publishedOn ?? null,
        durationMins: values.durationMins,
        maxDurationMins: values.maxDurationMins,
        idleRefreshMins: values.idleRefreshMins ? Number(values.idleRefreshMins) : null,
        options: {
          allowSkipAhead: values.allowSkipAhead,
          // Cost-per-attempt: always a finite limit, minimum 1 (no unlimited).
          allowMultipleAttempts: true,
          maxAttempts: Math.max(1, Number(values.maxAttempts) || 1),
          showProgressBar: values.showProgressBar,
          showSubtitles: values.showSubtitles,
          disablePreviousButton: values.disablePreviousButton,
          enableReviewMode: values.enableReviewMode,
          markAnswersInRealTime: values.markAnswersInRealTime,
          showMarksInProgressBar: values.showMarksInProgressBar,
          showFinalScore: values.showFinalScore,
          allowPublicDemoAccess: values.allowPublicDemoAccess,
          demoToken: values.demoToken || "",
          proctoringEnabled: values.proctoringEnabled,
        },
        theme: { ...values.theme },
        branding: { ...values.branding },
        trainingType: values.deliveryType,
        groupConfig:
          values.deliveryType === "group"
            ? {
                capacity: Number(values.groupCapacity || 50),
                startTime: localInputToIso(values.groupStartTime),
                endTime: localInputToIso(values.groupEndTime),
                autoStart: {
                  mode: "scheduled",
                  minParticipants: Number(values.groupMinParticipants || 1),
                  graceMins: Number(values.groupGraceMins || 15),
                },
                attendanceRules: {
                  minAttendancePct: Number(values.groupMinAttendancePct || 75),
                  activeConfirmIntervalMins: 10,
                },
                qaRules: {
                  maxSpeakSecs: Number(values.groupMaxSpeakSecs || 90),
                  silenceTimeoutSecs: 20,
                  maxQuestionsPerTrainee: Number(values.groupMaxQuestionsPerTrainee || 3),
                  handRaiseCooldownSecs: 30,
                },
                completionRules: {
                  minAttendancePct: Number(values.groupMinAttendancePct || 75),
                  requireAssessmentPass: false,
                },
                assessment: { passPct: 60, scoring: "both" },
              }
            : null,
        avatarEngine: buildAvatarEngineFromValues(values),
        slides: resolvedSlides.map((slide, index) => ({
          ...slide,
          color: slideColorCycle[index % slideColorCycle.length],
        })),
        sessions: initialTraining?.sessions ?? [],
      };

      onPersist(record);
      toast.success(status === "review" ? "Training sent for review." : "Training draft saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the training right now.");
    }
  };

  return (
    <Formik
      innerRef={formRef}
      initialValues={builderInitialValues}
      validationSchema={builderValidationSchema}
      enableReinitialize
      onSubmit={() => {
        setStep(2);
      }}
    >
      {({ submitForm, values, setFieldValue }) => (
        <>
          <WorkspaceBreadcrumb
            items={[
              { label: "Dashboard", onClick: onGoDashboard },
              { label: "Training", onClick: onCancel },
              { label: initialTraining ? "Edit Training" : "Create Training" },
            ]}
          />
          <input
            ref={uploadInputRef}
            type="file"
            className="d-none"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            multiple
            onChange={(event) => {
              void handleImportFiles(event.currentTarget.files, values.title);
            }}
          />
          <input
            ref={slideMediaInputRef}
            type="file"
            className="d-none"
            accept="image/*,application/pdf"
            onChange={(event) => {
              if (pendingSlideUploadId) {
                void handleReplaceSlideMedia(event.currentTarget.files, pendingSlideUploadId);
                return;
              }

              resetFileInput(event.currentTarget);
            }}
          />
          <input
            ref={knowledgeInputRef}
            type="file"
            className="d-none"
            accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
            multiple
            onChange={(event) => {
              void handleKnowledgeDocumentUpload(event.currentTarget.files);
            }}
          />
          <input
            ref={previewThumbnailInputRef}
            type="file"
            className="d-none"
            accept="image/*"
            onChange={(event) => {
              void handlePreviewThumbnailUpload(event.currentTarget.files);
            }}
          />
          <input
            ref={localizedLanguageUploadInputRef}
            type="file"
            className="d-none"
            accept="image/*,.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            multiple
            onChange={(event) => {
              if (pendingLocalizedUploadCode) {
                void handleUploadLocalizedSlides(event.currentTarget.files, pendingLocalizedUploadCode);
                return;
              }

              resetFileInput(event.currentTarget);
            }}
          />

          <div className="training-builder-shell">
            <div className="training-stepper mb-4">
              {["Slideshow Setup", "Upload Slides", "Generate F&Q", "Manage Slides"].map((label, index) => {
                const currentStep = index + 1;
                const isComplete = currentStep < highestUnlockedStep;
                const isActive = currentStep === step;
                const isLocked = currentStep > highestUnlockedStep;

                return (
                  <div
                    key={label}
                    className={`training-stepper-item ${isLocked ? "is-locked" : ""}`}
                    onClick={() => handleStepNavigation(currentStep)}
                    role="button"
                    aria-disabled={isLocked}
                    tabIndex={isLocked ? -1 : 0}
                    onKeyDown={(event) => {
                      if (isLocked) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleStepNavigation(currentStep);
                      }
                    }}
                  >
                    <div className={`training-stepper-dot ${isComplete ? "is-complete" : ""} ${isActive ? "is-active" : ""}`}>
                      {isComplete ? <i className="bi bi-check-lg" /> : currentStep}
                    </div>
                    <span className={`training-stepper-label ${isActive ? "is-active" : ""}`}>{label}</span>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <div className="card-body p-4">
                {step === 1 ? (
                  <Form>
                    <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-4">
                      <div>
                        <h4 className="mb-1">Create Slideshow</h4>
                        <p className="text-muted mb-0">
                          Set up training basics, learner-facing voice settings, and launch behavior.
                        </p>
                      </div>
                    </div>

                    {activeQuestionSet ? (
                      <div className="card border mb-3">
                        <div className="card-body py-3">
                          <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
                            <div>
                              <div className="d-flex align-items-center gap-2 flex-wrap">
                                <strong>{activeQuestionSet.label}</strong>
                                <span className="badge text-bg-primary">{questionCheckpoints.length} questions</span>
                                <span className="badge text-bg-light border text-dark">
                                  {formatQuestionSetPlacement({
                                    placementMode: activeQuestionSet.placementMode,
                                    slideTitle: activeQuestionSet.slideTitle,
                                  })}
                                </span>
                              </div>
                              <div className="small text-body-secondary mt-1">
                                All questions below will render together on one training slide.
                              </div>
                            </div>
                            <span className="small text-body-secondary">Editing active set</span>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="row g-4 align-items-start">
                      <div className="col-12 col-xl-6">
                        <div className="training-builder-section">
                          <div className="training-builder-caption">Experience Setup</div>

                          <div className="mb-3">
                            <label htmlFor="title" className="form-label">
                              Title
                            </label>
                            <Field id="title" name="title" className="form-control" />
                            <div className="form-text">This will appear at the top of your slideshow.</div>
                            <ErrorMessage name="title" component="small" className="text-danger" />
                          </div>

                          <div className="row g-3">
                            <div className="col-12">
                              <label htmlFor="type" className="form-label">
                                Training Type
                              </label>
                              <Field
                                as="select"
                                id="type"
                                name="type"
                                className="form-select"
                                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                  setFieldValue("type", event.target.value);

                                  if (event.target.value !== "Other") {
                                    setFieldValue("typeCustom", "");
                                  }
                                }}
                              >
                                {trainingTypeOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </Field>
                              <ErrorMessage name="type" component="small" className="text-danger" />
                            </div>
                          </div>
                          {values.type === "Other" ? (
                            <div className="mt-3">
                              <label htmlFor="typeCustom" className="form-label">
                                Custom Training Type
                              </label>
                              <Field
                                id="typeCustom"
                                name="typeCustom"
                                className="form-control"
                                placeholder="Enter training type"
                              />
                              <ErrorMessage name="typeCustom" component="small" className="text-danger" />
                            </div>
                          ) : null}

                          <div className="mt-3">
                            <label className="form-label d-block">Delivery Type</label>
                            <div className="row g-3">
                              {[
                                { value: "one_on_one", title: "One-on-One Training", caption: "Single trainee interacts directly with the AI avatar." },
                                { value: "group", title: "Group Training (Hall)", caption: "AI-managed hall: one screen, many trainees, no human trainer." },
                              ].map((option) => {
                                const isActive = values.deliveryType === option.value;
                                return (
                                  <div key={option.value} className="col-12 col-lg-6">
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => setFieldValue("deliveryType", option.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          setFieldValue("deliveryType", option.value);
                                        }
                                      }}
                                      style={{
                                        cursor: "pointer",
                                        height: "100%",
                                        padding: "16px",
                                        borderRadius: "12px",
                                        // Theme-aware (Bootstrap CSS vars) so the cards render correctly
                                        // in BOTH light and dark mode instead of a hardcoded white card.
                                        border: `1px solid ${isActive ? "#ff6200" : "var(--bs-border-color)"}`,
                                        background: isActive ? "rgba(255, 98, 0, 0.12)" : "var(--bs-tertiary-bg)",
                                        transition: "border-color 0.15s ease, background 0.15s ease",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          gap: "12px",
                                        }}
                                      >
                                        <span style={{ fontWeight: 600, color: "var(--bs-body-color)" }}>{option.title}</span>
                                        <i
                                          className={`bi ${isActive ? "bi-check-circle-fill" : "bi-circle"}`}
                                          style={{ color: isActive ? "#ff6200" : "var(--bs-secondary-color)", fontSize: "1.1rem", flexShrink: 0 }}
                                        />
                                      </div>
                                      <div style={{ marginTop: "6px", fontSize: "0.8125rem", color: "var(--bs-secondary-color)", lineHeight: 1.35 }}>
                                        {option.caption}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {values.deliveryType === "group" ? (
                            <div className="mt-3 p-3 border rounded bg-light">
                              <div className="fw-semibold mb-2">Group Training Hall Settings</div>
                              <div className="row g-3">
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Session Capacity</label>
                                  <Field type="number" min={1} name="groupCapacity" className="form-control" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Min Participants</label>
                                  <Field type="number" min={1} name="groupMinParticipants" className="form-control" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Auto-Start Grace (mins)</label>
                                  <Field type="number" min={0} name="groupGraceMins" className="form-control" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Start Time <span className="text-danger">*</span></label>
                                  <Field type="datetime-local" name="groupStartTime" className="form-control" />
                                  <ErrorMessage name="groupStartTime" component="small" className="text-danger" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">End Time</label>
                                  <Field type="datetime-local" name="groupEndTime" className="form-control" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Min Attendance %</label>
                                  <Field type="number" min={0} max={100} name="groupMinAttendancePct" className="form-control" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Max Speak (secs)</label>
                                  <Field type="number" min={10} name="groupMaxSpeakSecs" className="form-control" />
                                </div>
                                <div className="col-6 col-lg-3">
                                  <label className="form-label">Max Questions / Trainee</label>
                                  <Field type="number" min={1} name="groupMaxQuestionsPerTrainee" className="form-control" />
                                </div>
                              </div>
                              <div className="form-text mt-2">
                                A join code and QR are generated when you launch the hall from the training list. Only assigned trainees can join.
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-3">
                            <label className="form-label d-block">Training Mode</label>
                            <div className="row g-3">
                              {[
                                {
                                  value: "avatar",
                                  title: "Avatar Mode",
                                },
                                {
                                  value: "voice",
                                  title: "Voice Mode",
                                },
                              ].map((option) => (
                                <div key={option.value} className="col-12 col-lg-6">
                                  <button
                                    type="button"
                                    className={`btn w-100 text-start p-3 ${values.trainingMode === option.value ? "btn-primary" : "btn-light border"}`}
                                    onClick={() => setFieldValue("trainingMode", option.value)}
                                  >
                                    <div className="d-flex align-items-center justify-content-between gap-3">
                                      <strong>{option.title}</strong>
                                      <i className={`bi ${values.trainingMode === option.value ? "bi-check-circle-fill" : "bi-circle"}`} />
                                    </div>
                                  </button>
                                </div>
                              ))}
                            </div>
                            <ErrorMessage name="trainingMode" component="small" className="text-danger d-block mt-2" />
                          </div>

                          <div className="mb-3 mt-3">
                            <label htmlFor="avatarName" className="form-label">
                              Select Avatar
                            </label>
                            <Field
                              as="select"
                              id="avatarName"
                              name="avatarName"
                              className="form-select"
                              disabled={values.trainingMode === "voice" || isLoadingApiAvatars}
                              value={values.avatarName}
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                const selectedName = event.target.value;
                                const nextAvatar = avatarOptions.find((option) => option.avatarName === selectedName);
                                setFieldValue("avatarName", selectedName);
                                if (nextAvatar) {
                                  setFieldValue("avatarId", nextAvatar.avatarId);
                                  setFieldValue("avatarEngineAvatarId", nextAvatar.avatarId);
                                }
                              }}
                            >
                              {isLoadingApiAvatars ? (
                                <option value="">Loading avatars...</option>
                              ) : (
                                avatarOptions.map((option) => (
                                  <option key={option._id} value={option.avatarName}>
                                    {option.avatarName}
                                  </option>
                                ))
                              )}
                            </Field>
                            <div className="form-text">
                              {values.trainingMode === "voice"
                                ? "Voice mode keeps the avatar hidden during launch, but the selected profile remains saved."
                                : "Select an avatar from the Amara library. The first option is the default demo avatar."}
                            </div>
                            <ErrorMessage name="avatarName" component="small" className="text-danger" />
                          </div>

                          <div className="mb-3">
                            <label className="form-label d-block">TTS Provider</label>
                            <div className="d-flex gap-4 mb-2 flex-wrap">
                              <label className="form-check-label d-inline-flex align-items-center gap-2">
                                <input
                                  type="radio"
                                  name="ttsMode"
                                  value="auto"
                                  className="form-check-input mt-0"
                                  checked={values.ttsMode === "auto"}
                                  onChange={() => {
                                    setFieldValue("ttsMode", "auto");
                                    setManualKeyMessage("");

                                    if (values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER) {
                                      void loadElevenLabsVoices({ syncForm: true }).catch(() => undefined);
                                    }
                                  }}
                                />
                                <span>Auto</span>
                              </label>
                              <label className="form-check-label d-inline-flex align-items-center gap-2">
                                <input
                                  type="radio"
                                  name="ttsMode"
                                  value="manual"
                                  className="form-check-input mt-0"
                                  checked={values.ttsMode === "manual"}
                                  onChange={() => {
                                    setFieldValue("ttsMode", "manual");

                                    if (
                                      values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER &&
                                      values.manualApiKey.trim() &&
                                      values.manualApiKeyVerifiedAt
                                    ) {
                                      void loadElevenLabsVoices({
                                        apiKey: values.manualApiKey,
                                        syncForm: true,
                                      }).catch(() => undefined);
                                      return;
                                    }

                                    setVoiceOptions([]);
                                    setDefaultVoiceOption(null);
                                    setVoiceLoadError("");
                                    setManualKeyStatus("idle");
                                    setManualKeyMessage("Add and verify the ElevenLabs API key to load available voices.");
                                  }}
                                />
                                <span>Manual</span>
                              </label>
                            </div>
                            <Field
                              as="select"
                              id="ttsProvider"
                              name="ttsProvider"
                              className="form-select"
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                const nextProvider = event.target.value;
                                setFieldValue("ttsProvider", nextProvider);

                                if (nextProvider === DEFAULT_ELEVENLABS_PROVIDER) {
                                  if (values.ttsMode === "manual" && values.manualApiKey.trim() && values.manualApiKeyVerifiedAt) {
                                    void loadElevenLabsVoices({
                                      apiKey: values.manualApiKey,
                                      syncForm: true,
                                    }).catch(() => undefined);
                                  } else {
                                    void loadElevenLabsVoices({ syncForm: true }).catch(() => undefined);
                                  }

                                  return;
                                }

                                setFieldValue("voiceId", "auto");
                              }}
                            >
                              {ttsProviderOptions.map((provider) => (
                                <option key={provider} value={provider}>
                                  {provider}
                                </option>
                              ))}
                            </Field>
                            {values.ttsMode === "manual" ? (
                              <div className="mt-3">
                                <label htmlFor="manualApiKey" className="form-label">
                                  {values.ttsProvider} API Key
                                </label>
                                <div className="d-flex gap-2 flex-wrap">
                                  <Field
                                    id="manualApiKey"
                                    name="manualApiKey"
                                    type="password"
                                    className="form-control"
                                    placeholder={`Enter the ${values.ttsProvider} API key`}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                      setFieldValue("manualApiKey", event.target.value);
                                      setFieldValue("manualApiKeyVerifiedAt", "", false);
                                      setManualKeyStatus("idle");
                                      setManualKeyMessage(
                                        values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
                                          ? "Verify the key to load its available voices."
                                          : "This key will be saved with the selected provider. Voice fetching needs provider integration.",
                                      );
                                    }}
                                  />
                                  {values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER ? (
                                    <button
                                      type="button"
                                      className="btn btn-outline-primary"
                                      disabled={!values.manualApiKey.trim() || isLoadingVoices}
                                      onClick={() => {
                                        void loadElevenLabsVoices({
                                          apiKey: values.manualApiKey,
                                          syncForm: true,
                                          verifyKey: true,
                                        }).catch(() => undefined);
                                      }}
                                    >
                                      {manualKeyStatus === "verifying" ? "Verifying..." : "Verify Key"}
                                    </button>
                                  ) : null}
                                </div>
                                <div
                                  className={`small mt-2 ${manualKeyStatus === "verified"
                                    ? "text-success"
                                    : manualKeyStatus === "error"
                                      ? "text-danger"
                                      : "text-body-secondary"
                                    }`}
                                >
                                  {manualKeyMessage || `Use manual mode to save a client-specific ${values.ttsProvider} key.`}
                                </div>
                                <ErrorMessage name="manualApiKey" component="small" className="text-danger d-block" />
                                <ErrorMessage
                                  name="manualApiKeyVerifiedAt"
                                  component="small"
                                  className="text-danger d-block"
                                />
                              </div>
                            ) : null}
                          </div>

                          <div className="mb-3">
                            <label htmlFor="voiceId" className="form-label">
                              Voice
                            </label>
                            {values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER ? (
                              <Field
                                as="select"
                                id="voiceId"
                                name="voiceId"
                                className="form-select"
                                disabled={
                                  isLoadingVoices ||
                                  (values.ttsMode === "manual" && !values.manualApiKeyVerifiedAt) ||
                                  !voiceOptions.length
                                }
                                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                  const selectedVoice = voiceOptions.find((voice) => voice.voiceId === event.target.value);
                                  setFieldValue("voiceId", event.target.value);
                                  setFieldValue("voiceName", selectedVoice?.name ?? "");
                                  setLocalizedVoiceoversDraft(
                                    syncLocalizedVoiceovers({
                                      current: localizedVoiceoversDraft,
                                      slides: slidesDraft,
                                      defaultOption: resolveLanguageOptionFromValue(values.avatarEngineLanguage),
                                      voiceId: event.target.value,
                                      voiceName:
                                        selectedVoice?.name ?? defaultVoiceOption?.name ?? DEFAULT_ELEVENLABS_VOICE_NAME,
                                      provider: values.ttsProvider,
                                      apiKey: values.manualApiKey.trim(),
                                      askLabel: values.questionButtonLabel,
                                    }),
                                  );
                                }}
                              >
                                {values.ttsMode === "manual" && !values.manualApiKeyVerifiedAt ? (
                                  <option value="">Verify the manual API key to load voices</option>
                                ) : null}
                                {isLoadingVoices ? <option value="">Loading ElevenLabs voices...</option> : null}
                                {!isLoadingVoices && !voiceOptions.length ? (
                                  <option value="">{voiceLoadError || "No voices available for this provider."}</option>
                                ) : null}
                                {voiceOptions.map((voice) => (
                                  <option key={voice.voiceId} value={voice.voiceId}>
                                    {buildVoiceOptionLabel(voice)}
                                  </option>
                                ))}
                              </Field>
                            ) : (
                              <Field
                                id="voiceName"
                                name="voiceName"
                                className="form-control"
                                placeholder="Enter the provider voice name"
                              />
                            )}
                            <div className="form-text">
                              {values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
                                ? values.ttsMode === "manual" && !values.manualApiKeyVerifiedAt
                                  ? "Verify the entered ElevenLabs key to fetch available voices."
                                  : voiceLoadError || `Selected voice: ${values.voiceName || defaultVoiceOption?.name || DEFAULT_ELEVENLABS_VOICE_NAME}`
                                : "Enter the voice name supported by the selected provider."}
                            </div>
                            <ErrorMessage name="voiceName" component="small" className="text-danger" />
                          </div>
                          {values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER && values.voiceId ? (
                            <div className="card border shadow-sm mb-3">
                              <div className="card-body py-3">
                                <div className="small text-body-secondary mb-2">
                                  Voice ID: {values.voiceId}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-link text-decoration-none p-0 fw-semibold d-inline-flex align-items-center gap-2"
                                  onClick={() => openLanguageConfiguration(values)}
                                >
                                  <i className="bi bi-translate" aria-hidden="true" />
                                  <span>Configure Languages</span>
                                </button>
                                <div className="small text-body-secondary mt-2">
                                  {(localizedVoiceoversDraft?.languages?.length ?? 0) > 1
                                    ? `${localizedVoiceoversDraft?.languages.length ?? 0} languages configured for launch preview.`
                                    : "Add translated voiceovers so learners can switch languages during launch."}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          <div className="mb-3">
                            <label htmlFor="askSystemPrompt" className="form-label">
                              Ask Assistant Prompt
                            </label>
                            <Field
                              as="textarea"
                              id="askSystemPrompt"
                              name="askSystemPrompt"
                              rows={4}
                              className="form-control"
                              placeholder="Define this training's assistant name, company, role, tone, and answer boundaries."
                            />
                            <div className="form-text">
                              This prompt is used only for Ask mode answers in this training.
                            </div>
                            <ErrorMessage name="askSystemPrompt" component="small" className="text-danger" />
                          </div>

                          <div className="training-builder-subcaption mt-4">Launch Details</div>
                          <div className="training-builder-mini-grid">
                            <div>
                              <label htmlFor="durationMins" className="form-label">
                                Slideshow Duration (mins)
                              </label>
                              <Field id="durationMins" name="durationMins" type="number" className="form-control" />
                              <div className="form-text">Used for the learner launch timer and session report context.</div>
                              <ErrorMessage name="durationMins" component="small" className="text-danger" />
                            </div>
                          </div>

                          <div className="training-builder-subcaption mt-4">Proctoring</div>
                          <div className="training-setting-group">
                            <label className="form-label d-flex align-items-center gap-2 mb-2" style={{ cursor: "pointer" }}>
                              <Field type="checkbox" name="proctoringEnabled" className="form-check-input mt-0" />
                              Enable AI Proctoring
                            </label>
                            <div className="form-text mt-1">
                              When enabled, the user's camera and browser activity will be monitored for attention and risk events during the session. If disabled, proctoring will not be started and the report will default to 100% score (no risk).
                            </div>
                          </div>

                          <div className="training-builder-subcaption mt-4">Attempt Access</div>
                          <div className="training-setting-group">
                            <label htmlFor="maxAttempts" className="form-label d-block mb-2">Max Attempts per learner</label>
                            <Field
                              id="maxAttempts"
                              name="maxAttempts"
                              type="number"
                              min="1"
                              step="1"
                              className="form-control"
                              style={{ maxWidth: 200 }}
                            />
                            <ErrorMessage name="maxAttempts" component="small" className="text-danger d-block mt-1" />
                            <div className="form-text mt-1">
                              Default is <strong>1</strong>. Each attempt has a cost, so increase this only if learners
                              should be allowed retakes. Minimum 1 — there is no unlimited option.
                            </div>
                          </div>

                        </div>
                      </div>

                      <div className="col-12 col-xl-6">
                        <div className="training-builder-section">
                          <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                            <div>
                              <div className="training-builder-caption mb-0">Branding</div>
                              <div className="small text-body-secondary mt-1">
                                Make launch styling visual and easy to understand before publishing.
                              </div>
                            </div>
                            <div className="d-flex gap-2 align-items-center flex-nowrap">
                              <button
                                type="button"
                                className="btn btn-light btn-sm text-nowrap"
                                onClick={() => setFieldValue("theme", { ...defaultSlideshowTheme })}
                              >
                                Reset Theme
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm text-nowrap"
                                onClick={() => {
                                  setPendingBrandPresetTheme({ ...values.theme });
                                  setNewBrandPresetName(`${values.title.trim() || "Training"} Theme`);
                                  setNewBrandPresetDescription("Saved preset");
                                  setIsSaveThemeModalOpen(true);
                                }}
                              >
                                Save Theme
                              </button>
                            </div>
                          </div>

                          <div className="training-theme-preview" style={{ backgroundColor: values.theme.bgColor }}>
                            <div className="training-theme-preview-label">Live Preview</div>
                            <div className="training-theme-preview-shell">
                              <div className="training-theme-preview-actions">
                                <button
                                  type="button"
                                  className="training-theme-preview-button"
                                  style={{
                                    "--training-theme-button-radius": resolveThemeButtonRadius(values.theme.buttonRadius),
                                    "--training-theme-button-hover-background": resolveThemePrimaryHoverBackground(values.theme),
                                    "--training-theme-button-hover-border-color": values.theme.primaryBorderHover,
                                    "--training-theme-button-hover-text-color": values.theme.primaryTextHover,
                                    "--training-theme-button-active-background": resolveThemePrimaryHoverBackground(values.theme),
                                    "--training-theme-button-active-border-color": values.theme.primaryBorderHover,
                                    "--training-theme-button-active-text-color": values.theme.primaryTextHover,
                                    "--training-theme-button-background": resolveThemePrimaryBackground(values.theme),
                                    "--training-theme-button-border-color": values.theme.primaryBorder,
                                    "--training-theme-button-text": values.theme.primaryText,
                                    borderColor: values.theme.primaryBorder,
                                    color: values.theme.primaryText,
                                    borderRadius: resolveThemeButtonRadius(values.theme.buttonRadius),
                                    fontFamily: resolveThemeButtonFontFamily(values.theme.buttonFontFamily),
                                    fontWeight: Number(values.theme.buttonFontWeight),
                                    fontSize: resolveThemeButtonFontSize(values.theme.buttonFontSize),
                                    borderStyle: "solid",
                                    textDecoration: "none",
                                  } as CSSProperties}
                                >
                                  Start Training
                                </button>
                                <button
                                  type="button"
                                  className="training-theme-preview-button"
                                  style={{
                                    "--training-theme-button-radius": resolveThemeButtonRadius(values.theme.buttonRadius),
                                    "--training-theme-button-hover-background": values.theme.secondaryBgHover,
                                    "--training-theme-button-hover-border-color": values.theme.secondaryBorderHover,
                                    "--training-theme-button-hover-text-color": values.theme.secondaryTextHover,
                                    "--training-theme-button-active-background": values.theme.secondaryBgHover,
                                    "--training-theme-button-active-border-color": values.theme.secondaryBorderHover,
                                    "--training-theme-button-active-text-color": values.theme.secondaryTextHover,
                                    "--training-theme-button-background": resolveThemeSecondaryBackground(values.theme),
                                    "--training-theme-button-border-color": values.theme.secondaryBorder,
                                    "--training-theme-button-text": values.theme.secondaryText,
                                    borderColor: values.theme.secondaryBorder,
                                    color: values.theme.secondaryText,
                                    borderRadius: resolveThemeButtonRadius(values.theme.buttonRadius),
                                    fontFamily: resolveThemeButtonFontFamily(values.theme.buttonFontFamily),
                                    fontWeight: Number(values.theme.buttonFontWeight),
                                    fontSize: resolveThemeButtonFontSize(values.theme.buttonFontSize),
                                    borderStyle: "solid",
                                    textDecoration: "none",
                                  } as CSSProperties}
                                >
                                  Secondary Action
                                </button>
                              </div>
                            </div>
                            <div className="training-theme-preview-meta">
                              Background: {values.theme.bgColor} | Radius: {brandRadiusOptions.find((item) => item.value === values.theme.buttonRadius)?.label}
                            </div>
                          </div>

                          <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                            <div className="training-builder-subcaption mb-0">Brand Presets</div>
                            <button
                              type="button"
                              className="btn btn-light btn-sm training-brand-presets-trigger"
                              aria-label="View all brand presets"
                              title="View all brand presets"
                              onClick={() => setIsBrandPresetModalOpen(true)}
                            >
                              <i className="bi bi-grid-3x3-gap-fill" aria-hidden="true" />
                            </button>
                          </div>
                          <div className="training-brand-preset-grid mb-3">
                            {brandThemePresets.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className="training-brand-preset-card"
                                onClick={() => setFieldValue("theme", { ...preset.theme })}
                              >
                                <span
                                  className="training-brand-preset-swatch"
                                  style={{
                                    background:
                                      preset.theme.primaryFillMode === "gradient"
                                        ? `linear-gradient(${preset.theme.primaryGradientDirection}, ${preset.theme.primaryGradientFrom}, ${preset.theme.primaryGradientTo})`
                                        : preset.theme.primaryBg,
                                  }}
                                />
                                <strong>{preset.label}</strong>
                                <span>{preset.description}</span>
                              </button>
                            ))}
                          </div>

                          <div className="training-builder-subcaption">Primary Button Style</div>
                          <div className="training-branding-toolbar mb-3">
                            <button
                              type="button"
                              className={`btn btn-sm ${values.theme.primaryFillMode === "solid" ? "btn-primary" : "btn-light"}`}
                              onClick={() => setFieldValue("theme.primaryFillMode", "solid")}
                            >
                              Solid
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm ${values.theme.primaryFillMode === "gradient" ? "btn-primary" : "btn-light"}`}
                              onClick={() => setFieldValue("theme.primaryFillMode", "gradient")}
                            >
                              Gradient
                            </button>
                          </div>

                          <div className="training-theme-grid mb-3">
                            <div>
                              <label className="form-label small">Button Radius</label>
                              <Field as="select" name="theme.buttonRadius" className="form-select">
                                {brandRadiusOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Field>
                            </div>
                            <div>
                              <label className="form-label small">Font Style</label>
                              <Field as="select" name="theme.buttonFontFamily" className="form-select">
                                {buttonFontFamilyOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Field>
                            </div>
                            <div>
                              <label className="form-label small">Font Weight</label>
                              <Field as="select" name="theme.buttonFontWeight" className="form-select">
                                {buttonFontWeightOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Field>
                            </div>
                            <div>
                              <label className="form-label small">Font Size</label>
                              <Field as="select" name="theme.buttonFontSize" className="form-select">
                                {buttonFontSizeOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Field>
                            </div>
                          </div>

                          <div className="training-builder-subcaption">Primary Button Colours</div>
                          <div className="training-theme-grid mb-3">
                            {primaryThemeFields.map((fieldConfig) => (
                              <div key={fieldConfig.key}>
                                <label className="form-label small">{fieldConfig.label}</label>
                                <div className="training-theme-color-control">
                                  <Field type="color" name={`theme.${fieldConfig.key}`} className="form-control form-control-color" />
                                  <Field name={`theme.${fieldConfig.key}`} className="form-control training-theme-code" />
                                </div>
                              </div>
                            ))}
                          </div>

                          {values.theme.primaryFillMode === "gradient" ? (
                            <>
                              <div className="training-builder-subcaption">Gradient Options</div>
                              <div className="training-theme-grid mb-3">
                                <div>
                                  <label className="form-label small">Gradient From</label>
                                  <div className="training-theme-color-control">
                                    <Field type="color" name="theme.primaryGradientFrom" className="form-control form-control-color" />
                                    <Field name="theme.primaryGradientFrom" className="form-control training-theme-code" />
                                  </div>
                                </div>
                                <div>
                                  <label className="form-label small">Gradient To</label>
                                  <div className="training-theme-color-control">
                                    <Field type="color" name="theme.primaryGradientTo" className="form-control form-control-color" />
                                    <Field name="theme.primaryGradientTo" className="form-control training-theme-code" />
                                  </div>
                                </div>
                                <div className="training-theme-grid-span-2">
                                  <label className="form-label small">Direction</label>
                                  <Field as="select" name="theme.primaryGradientDirection" className="form-select">
                                    {gradientDirectionOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </Field>
                                </div>
                              </div>
                            </>
                          ) : null}

                          <div className="training-builder-subcaption">Secondary Button</div>
                          <div className="training-theme-grid mb-3">
                            {secondaryThemeFields.map((fieldConfig) => (
                              <div key={fieldConfig.key}>
                                <label className="form-label small">{fieldConfig.label}</label>
                                <div className="training-theme-color-control">
                                  <Field type="color" name={`theme.${fieldConfig.key}`} className="form-control form-control-color" />
                                  <Field name={`theme.${fieldConfig.key}`} className="form-control training-theme-code" />
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="training-builder-subcaption">Launch Surface</div>
                          <div className="row g-3 mb-4">
                            <div className="col-12 col-md-6">
                              <label className="form-label small">Background Colour</label>
                              <div className="training-theme-color-control">
                                <Field type="color" name="theme.bgColor" className="form-control form-control-color" />
                                <Field name="theme.bgColor" className="form-control training-theme-code" />
                              </div>
                            </div>
                            <div className="col-12 col-md-6">
                              <label className="form-label small">Avatar Panel</label>
                              <div className="training-theme-color-control">
                                <Field type="color" name="theme.avatarBoxBg" className="form-control form-control-color" />
                                <Field name="theme.avatarBoxBg" className="form-control training-theme-code" />
                              </div>
                            </div>
                          </div>
                          {/*
                          <div className="training-builder-subcaption">White-Label Details</div>
                          <div className="training-theme-grid mb-3">
                            <div>
                              <label className="form-label small">Application Name</label>
                              <Field name="branding.applicationName" className="form-control" placeholder="Trainup" />
                            </div>
                            <div>
                              <label className="form-label small">Company Name</label>
                              <Field name="branding.companyName" className="form-control" placeholder="Trainup Retail India" />
                            </div>
                            <div>
                              <label className="form-label small">Support Email</label>
                              <Field name="branding.supportEmail" type="email" className="form-control" placeholder="support@brand.com" />
                            </div>
                            <div>
                              <label className="form-label small">Logo URL</label>
                              <Field name="branding.logoUrl" className="form-control" placeholder="https://..." />
                            </div>
                            <div>
                              <label className="form-label small">Favicon URL</label>
                              <Field name="branding.faviconUrl" className="form-control" placeholder="https://..." />
                            </div>
                            <div>
                              <label className="form-label small">Loader Title</label>
                              <Field name="branding.loaderTitle" className="form-control" placeholder="Preparing Training" />
                            </div>
                            <div className="training-theme-grid-span-2">
                              <label className="form-label small">Loader Caption</label>
                              <Field name="branding.loaderCaption" className="form-control" placeholder="Camera verification and session checks are in progress." />
                            </div>
                          </div>

                          <div className="training-theme-preview-meta mb-3">
                            Theme, logo, favicon, support email, and loader copy are saved with the training for white-label reuse.
                          </div> */}

                        </div>
                      </div>
                    </div>
                  </Form>
                ) : null}

                {step === 2 ? (
                  <div>
                    <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-4">
                      <div>
                        <h4 className="mb-1">Upload Slides</h4>
                        <p className="text-muted mb-0">
                          Choose whether you want to upload a PPTX/PDF deck or create slides one by one.
                        </p>
                      </div>
                      <div className="btn-group btn-group-sm">
                        <button
                          type="button"
                          className={`btn ${mode === "upload" ? "btn-primary" : "btn-light"}`}
                          onClick={() => setMode("upload")}
                        >
                          Upload PPTX / PDF
                        </button>
                        <button
                          type="button"
                          className={`btn ${mode === "create" ? "btn-primary" : "btn-light"}`}
                          onClick={() => setMode("create")}
                        >
                          Create Slide
                        </button>
                      </div>
                    </div>

                    {mode === "upload" ? (
                      <>
                      <div className="row g-4">
                        <div className="col-12 col-xl-7">
                          <div className="training-upload-panel">
                            <button
                              type="button"
                              className="training-upload-dropzone"
                              onClick={() => uploadInputRef.current?.click()}
                              disabled={isImportingMedia}
                            >
                              {isImportingMedia ? (
                                <>
                                  <span className="spinner-border text-primary" aria-hidden="true" />
                                  <strong>Preparing slides...</strong>
                                  <small>Deck pages are being converted into slide previews.</small>
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-file-earmark-slides display-6" aria-hidden="true" />
                                  <strong>Click to upload or drag & drop</strong>
                                  <small>PDF or PPTX | Max 50MB</small>
                                </>
                              )}
                            </button>

                            {uploadedFiles.length ? (
                              <div className="experience-list">
                                {uploadedFiles.map((file) => (
                                  <div key={file.id} className="experience-list-item">
                                    <div className="d-flex align-items-center justify-content-between gap-3">
                                      <div>
                                        <div className="fw-semibold">{file.fileName}</div>
                                        <div className="small text-body-secondary">
                                          {file.kind === "ppt" ? "PPTX slides converted into slide previews" : "PDF pages extracted as slide previews"} |{" "}
                                          {file.slideCount} slide{file.slideCount === 1 ? "" : "s"}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-outline-danger"
                                        onClick={() => {
                                          void removeImportedBatch(file.id);
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="col-12 col-xl-5">
                          <div className="card h-100 border">
                            <div className="card-body">
                              <label htmlFor="scriptPrompt" className="form-label">
                                Script Generation Prompt
                              </label>
                              <textarea
                                id="scriptPrompt"
                                className="form-control"
                                rows={7}
                                value={scriptPrompt}
                                onChange={(event) => setScriptPrompt(event.target.value)}
                              />
                              <p className="small text-muted mt-3 mb-0">
                                OCR reads each imported slide, and this prompt is applied when you continue to Step 3.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {slidesDraft.length && uploadedFiles.length ? (
                        <div className="mt-4">
                          {renderSlideSelectionPicker(
                            "Narration is generated only for the slides you select below, like choosing a page range to print. You can revisit this selection later in Step 4 (Manage Slides).",
                          )}
                        </div>
                      ) : null}
                      </>
                    ) : (
                      <div className="experience-list">
                        {slidesDraft.map((slide, index) =>
                          renderEditableSlideCard({
                            slide,
                            index,
                            trainingTitle: values.title,
                            trainingMode: values.trainingMode,
                            ttsProvider: values.ttsProvider,
                            voiceName: values.voiceName,
                            voiceId: values.voiceId,
                            ttsApiKey:
                              values.ttsMode === "manual" && values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
                                ? values.manualApiKey
                                : "",
                            trainingId: initialTraining?.id,
                            deleteLabel: "Remove",
                            onDelete:
                              index > 0
                                ? () => {
                                  setSlidesDraft((current) => current.filter((item) => item.id !== slide.id));
                                  setSelectedNarrationSlideIds((current) => current.filter((id) => id !== slide.id));
                                }
                                : undefined,
                            fallbackNote: "Upload a slide image or a single PDF page to build this slide manually.",
                          }),
                        )}

                        <button
                          type="button"
                          className="training-dashed-action"
                          onClick={() => {
                            const nextSlide = buildBlankSlide(slidesDraft.length);
                            setExpandedManageSlideId(nextSlide.id);
                            setSlidesDraft((current) => [...current, nextSlide]);
                            setSelectedNarrationSlideIds((current) => [...current, nextSlide.id]);
                          }}
                        >
                          + Add New Slide
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                {step === 3 ? (
                  <div>
                    <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-4">
                      <div>
                        <h4 className="mb-1">Generate F&amp;Q using AI</h4>
                        <p className="text-muted mb-0">
                          AI reads the slide flow and uploaded knowledge base, then decides where learner knowledge checks should appear.
                        </p>
                        <div className="small text-body-secondary mt-2">
                          For a small 10-slide module, AI should usually create only 1 or 2 meaningful question sets, not a set after every slide.
                        </div>
                      </div>
                    </div>

                    <div className="row g-4">
                      <div className="col-12 col-xl-4">
                        <div className="training-builder-section h-100">
                          <div className="training-builder-caption">Knowledge Sources</div>
                          <label className="training-option-item py-0 border-0">
                            <input
                              type="checkbox"
                              checked={questionGeneratorConfig.selectedSourceIds.includes("slides")}
                              onChange={(event) =>
                                setQuestionGeneratorConfig((current) => ({
                                  ...current,
                                  selectedSourceIds: event.target.checked
                                    ? Array.from(new Set([...current.selectedSourceIds, "slides"]))
                                    : current.selectedSourceIds.filter((item) => item !== "slides"),
                                }))
                              }
                            />
                            <span>
                              <strong>Training Slides</strong>
                              <small>Use the uploaded deck, narration scripts, and slide notes as the AI source.</small>
                            </span>
                          </label>

                          <button
                            type="button"
                            className="training-knowledge-upload-tile mt-3"
                            onClick={() => knowledgeInputRef.current?.click()}
                            disabled={isUploadingKnowledgeDocuments}
                          >
                            <span className="training-knowledge-upload-icon" aria-hidden="true">
                              {isUploadingKnowledgeDocuments ? (
                                <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                              ) : (
                                <i className="bi bi-cloud-arrow-up" />
                              )}
                            </span>
                            <span className="training-knowledge-upload-copy">
                              <strong>{isUploadingKnowledgeDocuments ? "Uploading Knowledge Base..." : "Upload Knowledge Base"}</strong>
                              <small>
                                {isUploadingKnowledgeDocuments
                                  ? "Please wait while files are processed and text is extracted."
                                  : "Add PDF, TXT, or Markdown files to improve AI question planning and power Amara Ask mode responses."}
                              </small>
                            </span>
                          </button>

                          {knowledgeDocuments.length ? (
                            <div className="experience-list mt-3">
                              {knowledgeDocuments.map((document) => {
                                const checked = questionGeneratorConfig.selectedSourceIds.includes(document.id);

                                return (
                                  <div key={document.id} className="experience-list-item">
                                    <div className="d-flex align-items-start justify-content-between gap-3 w-100">
                                      <label className="d-flex align-items-start gap-3 flex-grow-1">
                                        <input
                                          type="checkbox"
                                          className="form-check-input mt-1"
                                          checked={checked}
                                          onChange={(event) =>
                                            setQuestionGeneratorConfig((current) => ({
                                              ...current,
                                              selectedSourceIds: event.target.checked
                                                ? Array.from(new Set([...current.selectedSourceIds, document.id]))
                                                : current.selectedSourceIds.filter((item) => item !== document.id),
                                            }))
                                          }
                                        />
                                        <span>
                                          <strong>{document.name}</strong>
                                          <small className="d-block text-body-secondary">
                                            {document.type.toUpperCase()} | {Math.round(document.text.length / 5)} words extracted
                                          </small>
                                        </span>
                                      </label>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-light"
                                        onClick={() => {
                                          setKnowledgeDocuments((current) => current.filter((item) => item.id !== document.id));
                                          setQuestionGeneratorConfig((current) => ({
                                            ...current,
                                            selectedSourceIds: current.selectedSourceIds.filter((item) => item !== document.id),
                                          }));
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="training-audio-player-empty mt-3">
                              Upload PDF, TXT, or Markdown knowledge documents to expand AI question coverage beyond the slide deck and give Amara richer Ask mode context.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col-12 col-xl-8">
                        <div className="training-builder-section h-100">
                          <div className="training-builder-caption">AI Preferences</div>
                          <div className="row g-3">
                            <div className="col-12 col-lg-5">
                              <label className="form-label">Difficulty</label>
                              <select
                                className="form-select"
                                value={questionGeneratorConfig.difficultyLevel}
                                onChange={(event) =>
                                  setQuestionGeneratorConfig((current) => ({
                                    ...current,
                                    difficultyLevel: event.target.value as TrainingQuestionDifficulty,
                                  }))
                                }
                              >
                                {questionDifficultyOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="mt-3">
                            <label className="form-label">Preferred Question Types</label>
                            <div className="d-flex flex-wrap gap-2">
                              {(["objective", "multi_select", "subjective", "text_area"] as TrainingQuestionCheckpoint["questionType"][]).map((questionType) => (
                                <button
                                  key={questionType}
                                  type="button"
                                  className={`btn btn-sm ${questionGeneratorConfig.preferredQuestionTypes?.includes(questionType)
                                    ? "btn-primary"
                                    : "btn-light"
                                    }`}
                                  onClick={() => togglePreferredQuestionType(questionType)}
                                >
                                  {humanizeTrainingQuestionType(questionType)}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="mt-3">
                            <label className="form-label">Custom Prompt (optional)</label>
                            <textarea
                              className="form-control"
                              rows={4}
                              value={questionGeneratorConfig.customPrompt}
                              onChange={(event) =>
                                setQuestionGeneratorConfig((current) => ({
                                  ...current,
                                  customPrompt: event.target.value,
                                }))
                              }
                              placeholder="Bias the AI towards practical learner checks, scenario prompts, or product-specific objections."
                            />
                          </div>
                          <div className="training-question-generator-actions mt-4">
                            <div className="training-question-generator-actions-copy">
                              <strong>Ready to generate?</strong>
                              <small>AI will create learner-facing F&amp;Q sets from your selected sources and preferences.</small>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={isGeneratingQuestions}
                              onClick={() => {
                                handleGenerateWithAi(values.title);
                              }}
                            >
                              {isGeneratingQuestions ? "Generating..." : "Generate F&Q"}
                            </button>
                          </div>
                          {questionGenerationError ? <div className="training-launch-audio-error mt-3">{questionGenerationError}</div> : null}
                        </div>
                      </div>
                    </div>

                    {questionSetVersions.length ? (
                      <div className="card border mt-4">
                        <div className="card-body">
                          <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                            <div>
                              <h5 className="mb-1">Question Sets</h5>
                              <p className="text-muted mb-0">
                                Each set below is one learner-facing slide. AI only adds sets where the learner should reasonably be tested after enough content.
                              </p>
                            </div>
                            <span className="badge text-bg-light border text-dark">
                              {questionSetVersions.length} planned set{questionSetVersions.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="experience-list">
                            {questionSetVersions.map((questionSet, index) => (
                              <div key={questionSet.id} className="experience-list-item">
                                <div className="training-question-set-header">
                                  <div className="training-question-set-summary">
                                    <div className="d-flex align-items-center gap-2 flex-wrap">
                                      <strong>{questionSet.label}</strong>
                                      <span className={`badge ${questionSet.isActive ? "text-bg-primary" : "text-bg-light border text-dark"}`}>
                                        {questionSet.isActive ? "Editing" : `Set ${index + 1}`}
                                      </span>
                                      <span className="badge text-bg-light border text-dark">{questionSet.questionCount} questions</span>
                                      <span className={`badge ${questionSet.isMandatory !== false ? "text-bg-warning" : "text-bg-light border text-dark"}`}>
                                        {questionSet.isMandatory !== false ? "Mandatory" : "Optional"}
                                      </span>
                                    </div>
                                    <div className="small text-body-secondary mt-1">
                                      {formatQuestionSetPlacement({
                                        placementMode: questionSet.placementMode,
                                        slideTitle: questionSet.slideTitle,
                                      })}{" "}
                                      | {questionSet.difficultyLevel} difficulty
                                    </div>
                                    {questionSet.plannerSummary ? (
                                      <div className="small text-body-secondary mt-2">{questionSet.plannerSummary}</div>
                                    ) : null}
                                    <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
                                      {questionSet.sourceRangeLabel ? (
                                        <span className="badge text-bg-light border text-dark">{questionSet.sourceRangeLabel}</span>
                                      ) : null}
                                    </div>
                                    {questionSet.topicTags.length ? (
                                      <div className="d-flex flex-wrap gap-2 mt-2">
                                        {questionSet.topicTags.map((tag) => (
                                          <span key={`${questionSet.id}-${tag}`} className="badge text-bg-light border text-dark">
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="training-question-set-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-light"
                                      onClick={() => handleQuestionSetAccordionToggle(questionSet.id)}
                                      aria-label={expandedQuestionSetMap.has(questionSet.id) ? "Collapse set" : "Expand set"}
                                    >
                                      <i
                                        className={`bi ${expandedQuestionSetMap.has(questionSet.id)
                                          ? "bi-chevron-up"
                                          : "bi-chevron-down"
                                          }`}
                                        aria-hidden="true"
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-primary"
                                      onClick={() => openQuestionSetConfig(questionSet.id)}
                                    >
                                      Configure
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => removeQuestionSet(questionSet.id)}
                                    >
                                      Delete Set
                                    </button>
                                  </div>
                                </div>
                                {expandedQuestionSetMap.has(questionSet.id) ? (
                                  <div className="mt-3 pt-3 border-top">
                                    <div className="small text-body-secondary mb-3">
                                      {questionSet.isActive
                                        ? "This set is currently active. Review the learner-facing preview below."
                                        : "Preview of learner-facing questions in this set."}
                                    </div>
                                    <div className="experience-list">
                                      {(questionSet.id === activeQuestionSetId ? questionCheckpoints : questionSet.checkpoints).map((checkpoint, checkpointIndex) =>
                                        renderQuestionCheckpointCard(checkpoint, checkpointIndex, {
                                          questionSetId: questionSet.id,
                                          isActiveSet: questionSet.id === activeQuestionSetId,
                                        }),
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {step === 4 ? (
                  <div>
                    <div className="mb-4">
                      <h4 className="mb-1">Manage Slides</h4>
                      <p className="text-muted mb-0">
                        Review scripts, adjust additional settings, and prepare the training for reviewer handoff.
                      </p>
                    </div>

                    {uploadedFiles.length ? (
                      <div className="training-import-banner mb-4">
                        <div>
                          <div className="fw-semibold">Recent Imports</div>
                          <div className="small text-body-secondary">
                            {uploadedFiles.map((item) => item.fileName).join(", ")} | {slidesDraft.length} slides ready for narration and review
                          </div>
                        </div>
                        <span className="badge text-bg-success">Media linked</span>
                      </div>
                    ) : null}

                    {slidesDraft.length ? (
                      <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-4">
                        <div className="small text-body-secondary">
                          {selectedNarrationSlideIds.length} of {slidesDraft.length} slides selected for narration.
                        </div>
                        <div className="d-flex gap-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => setShowSlidePickerInManageStep((current) => !current)}
                          >
                            {showSlidePickerInManageStep ? "Done" : "Add / Remove Slides"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={isGeneratingSlideScripts}
                            onClick={() => {
                              void handleGenerateNarrationForSelected(values.title);
                            }}
                          >
                            {isGeneratingSlideScripts ? "Generating..." : "Generate Narration for Selected"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {showSlidePickerInManageStep ? (
                      <div className="mb-4">
                        {renderSlideSelectionPicker(
                          "Pick which slides should show below and be included in narration. Deselected slides stay in the deck but stay hidden here until reselected.",
                        )}
                      </div>
                    ) : null}

                    <div className="card border mb-4">
                      <div className="card-body">
                        <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
                          <div>
                            <h5 className="mb-1">Launch Cover Thumbnail</h5>
                            <p className="text-muted mb-0">
                              By default, the launch cover uses the first slide. You can switch it to another slide or upload a dedicated cover image from your gallery.
                            </p>
                          </div>
                          <span className="badge text-bg-light border text-dark">
                            {hasCustomPreviewThumbnail ? "Gallery cover" : previewSlideId ? "Slide cover" : "Auto cover"}
                          </span>
                        </div>

                        <div className="row g-4 mt-1 align-items-start">
                          <div className="col-12 col-xl-5">
                            <label className="form-label">Cover Source</label>
                            <select
                              className="form-select"
                              value={previewSlideId ?? ""}
                              onChange={(event) => {
                                const nextValue = event.target.value.trim();
                                setPreviewSlideId(nextValue || null);
                              }}
                            >
                              <option value="">Auto: Slide 1</option>
                              {slidesDraft.map((slide, index) => (
                                <option key={slide.id} value={slide.id}>
                                  Slide {index + 1}: {slide.title || `Slide ${index + 1}`}
                                </option>
                              ))}
                            </select>
                            <div className="small text-body-secondary mt-2">
                              This controls the pre-start cover only. Once training begins, the slide flow continues from Slide 1 as usual.
                            </div>

                            <button
                              type="button"
                              className="training-knowledge-upload-tile mt-3"
                              onClick={() => previewThumbnailInputRef.current?.click()}
                              disabled={isUploadingPreviewThumbnail}
                            >
                              <span className="training-knowledge-upload-icon" aria-hidden="true">
                                {isUploadingPreviewThumbnail ? (
                                  <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                                ) : (
                                  <i className="bi bi-image" />
                                )}
                              </span>
                              <span className="training-knowledge-upload-copy">
                                <strong>{isUploadingPreviewThumbnail ? "Uploading Cover Thumbnail..." : "Upload From Gallery"}</strong>
                                <small>
                                  {isUploadingPreviewThumbnail
                                    ? "Please wait while the gallery cover is being uploaded."
                                    : "Add a dedicated launch cover image from your device."}
                                </small>
                              </span>
                            </button>

                            {previewThumbnailAssetId ? (
                              <div className="experience-list mt-3">
                                <div className="experience-list-item">
                                  <div className="d-flex align-items-center justify-content-between gap-3">
                                    <div>
                                      <div className="fw-semibold">{previewThumbnailAssetName || "Uploaded cover thumbnail"}</div>
                                      <div className="small text-body-secondary">
                                        Gallery upload overrides the slide-based cover until removed.
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => {
                                        setPreviewThumbnailAssetId(null);
                                        setPreviewThumbnailAssetName("");
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="col-12 col-xl-7">
                            <div className="training-preview-card h-100">
                              <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                                <strong>
                                  {hasCustomPreviewThumbnail
                                    ? previewThumbnailAssetName || "Custom launch cover"
                                    : selectedPreviewSlide?.title || "Launch Cover Preview"}
                                </strong>
                                <span className="badge text-bg-light border text-dark">
                                  {hasCustomPreviewThumbnail ? "Gallery" : previewSlideId ? "Selected slide" : "Auto"}
                                </span>
                              </div>
                              {hasCustomPreviewThumbnail && previewThumbnailUrl ? (
                                <div className="training-launch-cover-preview">
                                  <img src={previewThumbnailUrl} alt="Launch cover preview" />
                                </div>
                              ) : selectedPreviewSlide ? (
                                <SlideMediaPreview
                                  slide={selectedPreviewSlide}
                                  accentColor={selectedPreviewSlide.color}
                                  showLink
                                  hideBadge
                                />
                              ) : (
                                <div className="training-audio-player-empty">
                                  Upload at least one slide to preview the launch cover.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="experience-list">
                      {selectedNarrationSlideIds.length ? null : (
                        <div className="training-audio-player-empty">
                          No slides selected. Use "Add / Remove Slides" above to bring slides back into view.
                        </div>
                      )}

                      {slidesDraft
                        .map((slide, index) => ({ slide, index }))
                        .filter(({ slide }) => selectedNarrationSlideIds.includes(slide.id))
                        .map(({ slide, index }) =>
                          renderEditableSlideCard({
                            slide,
                            index,
                            trainingTitle: values.title,
                            trainingMode: values.trainingMode,
                            ttsProvider: values.ttsProvider,
                            voiceName: values.voiceName,
                            voiceId: values.voiceId,
                            ttsApiKey:
                              values.ttsMode === "manual" && values.ttsProvider === DEFAULT_ELEVENLABS_PROVIDER
                                ? values.manualApiKey
                                : "",
                            trainingId: initialTraining?.id,
                            onDelete: () => {
                              if (slidesDraft.length === 1) {
                                toast.error("At least one slide should remain in the training.");
                                return;
                              }

                              setSlidesDraft((current) => current.filter((item) => item.id !== slide.id));
                              setSelectedNarrationSlideIds((current) => current.filter((id) => id !== slide.id));
                            },
                            fallbackNote: "Upload the slide background here. Imported PDF or PPTX pages continue to appear as slide images.",
                          }),
                        )}

                      <button
                        type="button"
                        className="training-dashed-action"
                        onClick={() => {
                          const nextSlide = buildBlankSlide(slidesDraft.length);
                          setExpandedManageSlideId(nextSlide.id);
                          setSlidesDraft((current) => [...current, nextSlide]);
                          setSelectedNarrationSlideIds((current) => [...current, nextSlide.id]);
                        }}
                      >
                        + Add New Slide
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="d-flex justify-content-between gap-3 flex-wrap mt-4 pt-3 border-top">
                  <button
                    type="button"
                    className="btn btn-light"
                    onClick={() => {
                      if (step === 1) {
                        onCancel();
                        return;
                      }

                      setStep((current) => current - 1);
                    }}
                    aria-label={step === 1 ? "Cancel setup" : "Go to previous step"}
                    title={step === 1 ? "Cancel setup" : "Previous step"}
                  >
                    <i className={`bi ${step === 1 ? "bi-x-lg" : "bi-chevron-left"}`} aria-hidden="true" />
                  </button>

                  {step < 4 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        if (step === 1) {
                          void submitForm();
                          return;
                        }

                        if (step === 2) {
                          void handleStepTwoNext(values.title);
                          return;
                        }

                        setStep((current) => current + 1);
                      }}
                      disabled={isGeneratingSlideScripts}
                      aria-label={
                        isGeneratingSlideScripts
                          ? "Generating slide scripts"
                          : step === 2
                            ? "Continue to Generate F&Q"
                            : step === 3
                              ? "Continue to Manage Slides"
                              : "Next step"
                      }
                      title={
                        isGeneratingSlideScripts
                          ? "Generating slide scripts"
                          : step === 2
                            ? "Continue to Generate F&Q"
                            : step === 3
                              ? "Continue to Manage Slides"
                              : "Next step"
                      }
                    >
                      <i
                        className={`bi ${isGeneratingSlideScripts ? "bi-hourglass-split" : "bi-chevron-right"}`}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <div className="d-flex gap-2">
                      <button type="button" className="btn btn-light" onClick={() => void persistTrainingRecord(values, "draft")}>
                        Save Draft
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => void persistTrainingRecord(values, "review")}>
                        Save &amp; Send for Review
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <TrainingFormBuilderModal
            show={Boolean(activeFormSlide)}
            slide={activeFormSlide}
            onClose={() => setFormBuilderSlideId(null)}
            onSave={saveSlideFormBuilder}
          />
          <Modal
            show={isLanguageConfigOpen}
            title="Language Configuration"
            onClose={() => {
              setLocalizedVoiceoversDraft(cloneLocalizedVoiceovers(localizedVoiceoversSnapshot));
              setIsLanguageConfigOpen(false);
            }}
            size="xl"
            scrollable
          >
            {(() => {
              const languageConfig = buildSyncedLocalizedVoiceovers(values);

              return (
                <div>
                  <p className="text-body-secondary mb-4">
                    Configure supported languages for this training. Learners will see these languages in launch preview,
                    and each language can keep its own translated script, audio, and optional slide overrides.
                  </p>
                  <div className="d-flex flex-column gap-3">
                    {languageConfig.languages.map((language, index) => {
                      const selectedCodes = new Set(
                        languageConfig.languages
                          .filter((item) => item.code !== language.code)
                          .map((item) => item.code),
                      );
                      const translatedCount = language.translatedSlides.filter((slide) => String(slide.script || "").trim()).length;
                      const generatedAudioCount = language.translatedSlides.filter((slide) => slide.narrationAudio?.updatedAt).length;
                      const hasTranslatedScript = translatedCount > 0;
                      const labelsExpanded = expandedLanguageLabelCodes.includes(language.code);
                      const languageAction = languageActionState[language.code];

                      return (
                        <div key={`${language.code}-${index}`} className="card border shadow-sm">
                          <div className="card-body">
                            <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                              <div>
                                <div className="d-flex align-items-center gap-2 flex-wrap">
                                  <strong>{language.label}</strong>
                                  {language.isDefault ? (
                                    <span className="badge rounded-pill text-bg-warning">Default</span>
                                  ) : null}
                                </div>
                                <div className="small text-body-secondary mt-1">
                                  {translatedCount}/{slidesDraft.length} translated | {generatedAudioCount}/{slidesDraft.length} audio ready
                                </div>
                              </div>
                              <div className="d-flex gap-2 flex-wrap">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => {
                                    setPendingLocalizedUploadCode(language.code);
                                    localizedLanguageUploadInputRef.current?.click();
                                  }}
                                >
                                  <i className="bi bi-upload me-1" aria-hidden="true" />
                                  Upload Slides
                                </button>
                                {!language.isDefault ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-primary"
                                      disabled={Boolean(languageAction?.translating)}
                                      onClick={() => void handleTranslateLocalizedLanguage(language.code, values)}
                                    >
                                      {languageAction?.translating ? "Translating..." : "Translate"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-primary"
                                      disabled={!hasTranslatedScript || Boolean(languageAction?.generatingAudio)}
                                      onClick={() => void handleGenerateLocalizedAudio(language.code, values)}
                                    >
                                      {languageAction?.generatingAudio ? "Generating..." : "Generate Audio"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-light"
                                      disabled={index <= 1}
                                      onClick={() => handleMoveLocalizedLanguage(language.code, -1)}
                                      aria-label="Move language up"
                                      title="Move language up"
                                    >
                                      <i className="bi bi-arrow-up" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-light"
                                      disabled={index >= languageConfig.languages.length - 1}
                                      onClick={() => handleMoveLocalizedLanguage(language.code, 1)}
                                      aria-label="Move language down"
                                      title="Move language down"
                                    >
                                      <i className="bi bi-arrow-down" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => handleRemoveLocalizedLanguage(language.code)}
                                    >
                                      <i className="bi bi-x-lg" aria-hidden="true" />
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="row g-3 align-items-end">
                              <div className="col-12 col-lg-3">
                                <label className="form-label small">Language</label>
                                <select
                                  className="form-select"
                                  value={language.code}
                                  onChange={(event) => {
                                    const nextOption = supportedLocalizedLanguageOptions.find(
                                      (option) => option.code === event.target.value,
                                    );

                                    if (!nextOption || selectedCodes.has(nextOption.code)) {
                                      toast.error("That language is already configured.");
                                      return;
                                    }

                                    updateLocalizedLanguageDraft(language.code, (current) => ({
                                      ...createLocalizedLanguageRecord({
                                        option: nextOption,
                                        isDefault: current.isDefault,
                                        voiceId: current.voiceId,
                                        voiceName: current.voiceName,
                                        provider: current.provider,
                                        apiKey: current.apiKey || "",
                                        slides: slidesDraft,
                                        askLabel: current.buttonLabels?.ask || values.questionButtonLabel,
                                      }),
                                      buttonLabels: {
                                        ...defaultLocalizedButtonLabels,
                                        ...(current.buttonLabels ?? {}),
                                      },
                                    }));
                                  }}
                                >
                                  {supportedLocalizedLanguageOptions.map((option) => (
                                    <option
                                      key={option.code}
                                      value={option.code}
                                      disabled={selectedCodes.has(option.code)}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-12 col-lg-2">
                                <label className="form-label small">Provider</label>
                                <select
                                  className="form-select"
                                  value={language.provider}
                                  onChange={(event) =>
                                    updateLocalizedLanguageDraft(language.code, (current) => ({
                                      ...current,
                                      provider: event.target.value,
                                    }))
                                  }
                                >
                                  {ttsProviderOptions.map((provider) => (
                                    <option key={provider} value={provider}>
                                      {provider}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-12 col-lg-3">
                                <label className="form-label small">API Key</label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={language.apiKey || ""}
                                  placeholder="Use global key or add one here"
                                  onChange={(event) =>
                                    updateLocalizedLanguageDraft(language.code, (current) => ({
                                      ...current,
                                      apiKey: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="col-12 col-lg-4">
                                <label className="form-label small">Voice</label>
                                <select
                                  className="form-select"
                                  value={language.voiceId}
                                  onChange={(event) => {
                                    const selectedVoice = voiceOptions.find((voice) => voice.voiceId === event.target.value);

                                    updateLocalizedLanguageDraft(language.code, (current) => ({
                                      ...current,
                                      voiceId: event.target.value,
                                      voiceName: selectedVoice?.name || current.voiceName,
                                    }));
                                  }}
                                >
                                  {voiceOptions.map((voice) => (
                                    <option key={voice.voiceId} value={voice.voiceId}>
                                      {buildVoiceOptionLabel(voice)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="mt-3">
                              <button
                                type="button"
                                className="btn btn-link btn-sm text-decoration-none px-0"
                                onClick={() => toggleLanguageLabelsEditor(language.code)}
                              >
                                Button Labels {labelsExpanded ? "Hide" : "Show"}
                              </button>
                              {labelsExpanded ? (
                                <div className="row g-3 mt-1">
                                  <div className="col-12 col-md-4">
                                    <label className="form-label small">Next</label>
                                    <input
                                      type="text"
                                      className="form-control"
                                      value={language.buttonLabels?.next || defaultLocalizedButtonLabels.next}
                                      onChange={(event) =>
                                        updateLocalizedLanguageDraft(language.code, (current) => ({
                                          ...current,
                                          buttonLabels: {
                                            ...defaultLocalizedButtonLabels,
                                            ...(current.buttonLabels ?? {}),
                                            next: event.target.value,
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="col-12 col-md-4">
                                    <label className="form-label small">Previous</label>
                                    <input
                                      type="text"
                                      className="form-control"
                                      value={language.buttonLabels?.previous || defaultLocalizedButtonLabels.previous}
                                      onChange={(event) =>
                                        updateLocalizedLanguageDraft(language.code, (current) => ({
                                          ...current,
                                          buttonLabels: {
                                            ...defaultLocalizedButtonLabels,
                                            ...(current.buttonLabels ?? {}),
                                            previous: event.target.value,
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="col-12 col-md-4">
                                    <label className="form-label small">Ask</label>
                                    <input
                                      type="text"
                                      className="form-control"
                                      value={language.buttonLabels?.ask || defaultLocalizedButtonLabels.ask}
                                      onChange={(event) =>
                                        updateLocalizedLanguageDraft(language.code, (current) => ({
                                          ...current,
                                          buttonLabels: {
                                            ...defaultLocalizedButtonLabels,
                                            ...(current.buttonLabels ?? {}),
                                            ask: event.target.value,
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mt-4">
                    <button
                      type="button"
                      className="btn btn-warning"
                      disabled={
                        languageConfig.languages.length >= supportedLocalizedLanguageOptions.length ||
                        !values.voiceId
                      }
                      onClick={() => handleAddLocalizedLanguage(values)}
                    >
                      <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                      Add Language
                    </button>
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-light"
                        onClick={() => {
                          setLocalizedVoiceoversDraft(cloneLocalizedVoiceovers(localizedVoiceoversSnapshot));
                          setIsLanguageConfigOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          const nextConfig = buildSyncedLocalizedVoiceovers(values);
                          setLocalizedVoiceoversDraft(nextConfig);
                          setLocalizedVoiceoversSnapshot(cloneLocalizedVoiceovers(nextConfig));
                          setIsLanguageConfigOpen(false);
                          toast.success("Language setup saved.");
                        }}
                      >
                        Save Language Setup
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </Modal>
          <Modal
            show={isSaveThemeModalOpen}
            title="Save Theme"
            onClose={() => {
              setIsSaveThemeModalOpen(false);
              setPendingBrandPresetTheme(null);
              setNewBrandPresetName("");
              setNewBrandPresetDescription("Saved preset");
            }}
            size="md"
          >
            <div className="d-grid gap-3">
              <p className="text-body-secondary mb-0">
                This theme will appear in Brand Presets with the name and helper text you add here.
              </p>
              <div>
                <label htmlFor="brandPresetName" className="form-label">
                  Theme Name
                </label>
                <input
                  id="brandPresetName"
                  className="form-control"
                  value={newBrandPresetName}
                  onChange={(event) => setNewBrandPresetName(event.target.value)}
                  placeholder="Example: Trainup Blue Variant"
                />
              </div>
              <div>
                <label htmlFor="brandPresetDescription" className="form-label">
                  Short Description
                </label>
                <input
                  id="brandPresetDescription"
                  className="form-control"
                  value={newBrandPresetDescription}
                  onChange={(event) => setNewBrandPresetDescription(event.target.value)}
                  placeholder="Example: Sales training launch theme"
                />
              </div>
              <div className="training-brand-preset-modal-card">
                <span
                  className="training-brand-preset-swatch"
                  style={{
                    background: pendingBrandPresetTheme
                      ? resolveThemePrimaryBackground(pendingBrandPresetTheme)
                      : defaultSlideshowTheme.primaryBg,
                  }}
                />
                <strong>{newBrandPresetName.trim() || "Theme Name"}</strong>
                <span>{newBrandPresetDescription.trim() || "Saved preset"}</span>
              </div>
              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-light"
                  onClick={() => {
                    setIsSaveThemeModalOpen(false);
                    setPendingBrandPresetTheme(null);
                    setNewBrandPresetName("");
                    setNewBrandPresetDescription("Saved preset");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const nextName = newBrandPresetName.trim();
                    if (!nextName) {
                      toast.error("Theme name is required.");
                      return;
                    }
                    if (!pendingBrandPresetTheme) {
                      toast.error("Theme preview is not ready yet.");
                      return;
                    }

                    const nextPreset = {
                      id: `preset-${Date.now()}`,
                      name: nextName,
                      description: newBrandPresetDescription.trim() || "Saved preset",
                      theme: { ...pendingBrandPresetTheme },
                    };

                    setSavedBrandPresets((current) => [nextPreset, ...current].slice(0, 8));
                    setIsSaveThemeModalOpen(false);
                    setPendingBrandPresetTheme(null);
                    setNewBrandPresetName("");
                    setNewBrandPresetDescription("Saved preset");
                    toast.success("Brand theme saved for future trainings.");
                  }}
                >
                  Save Theme
                </button>
              </div>
            </div>
          </Modal>
          <Modal
            show={isBrandPresetModalOpen}
            title="Brand Presets"
            onClose={() => {
              setIsBrandPresetModalOpen(false);
              setEditingBrandPresetId(null);
              setEditingBrandPresetName("");
            }}
            size="lg"
          >
            <div className="training-brand-preset-modal-grid">
              {[
                ...brandThemePresets,
                ...savedBrandPresets.map((preset) => ({
                  id: preset.id,
                  label: preset.name,
                  description: preset.description || "Saved preset",
                  theme: preset.theme,
                  isSaved: true,
                })),
              ].map((preset) => (
                <div key={preset.id} className="training-brand-preset-modal-card">
                  <span
                    className="training-brand-preset-swatch"
                    style={{
                      background:
                        preset.theme.primaryFillMode === "gradient"
                          ? `linear-gradient(${preset.theme.primaryGradientDirection}, ${preset.theme.primaryGradientFrom}, ${preset.theme.primaryGradientTo})`
                          : preset.theme.primaryBg,
                    }}
                  />
                  {editingBrandPresetId === preset.id ? (
                    <div className="d-flex gap-2 align-items-center">
                      <input
                        className="form-control form-control-sm"
                        value={editingBrandPresetName}
                        onChange={(event) => setEditingBrandPresetName(event.target.value)}
                        placeholder="Preset name"
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const nextName = editingBrandPresetName.trim();
                          if (!nextName) {
                            toast.error("Preset name is required.");
                            return;
                          }
                          setSavedBrandPresets((current) =>
                            current.map((item) => (item.id === preset.id ? { ...item, name: nextName } : item)),
                          );
                          setEditingBrandPresetId(null);
                          setEditingBrandPresetName("");
                          toast.success("Theme updated.");
                        }}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <strong>{preset.label}</strong>
                      <span>{preset.description}</span>
                    </>
                  )}
                  <div className="training-brand-preset-modal-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setFieldValue("theme", { ...preset.theme });
                        setIsBrandPresetModalOpen(false);
                      }}
                    >
                      Apply
                    </button>
                    {"isSaved" in preset && preset.isSaved ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-light btn-sm"
                          onClick={() => {
                            setEditingBrandPresetId(preset.id);
                            setEditingBrandPresetName(preset.label);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => {
                            setSavedBrandPresets((current) => current.filter((item) => item.id !== preset.id));
                            if (editingBrandPresetId === preset.id) {
                              setEditingBrandPresetId(null);
                              setEditingBrandPresetName("");
                            }
                            toast.success("Theme deleted.");
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Modal>
          <Modal
            show={Boolean(pendingQuestionGeneration)}
            title="Generate F&Q with AI"
            onClose={() => setPendingQuestionGeneration(null)}
            size="md"
          >
            <p className="text-body-secondary mb-3">
              You already have {pendingQuestionGeneration?.existingSetCount ?? 0} generated question
              set{pendingQuestionGeneration?.existingSetCount === 1 ? "" : "s"}. Choose whether AI should replace the
              current draft or add fresh sets on top of it.
            </p>
            <div className="d-grid gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={isGeneratingQuestions}
                onClick={() => {
                  if (!pendingQuestionGeneration) {
                    return;
                  }

                  void generateAiQuestionDrafts(
                    pendingQuestionGeneration.trainingTitle,
                    null,
                    "overwrite",
                  );
                }}
              >
                Overwrite Existing Sets
              </button>
              <button
                type="button"
                className="btn btn-outline-primary"
                disabled={isGeneratingQuestions}
                onClick={() => {
                  if (!pendingQuestionGeneration) {
                    return;
                  }

                  void generateAiQuestionDrafts(
                    pendingQuestionGeneration.trainingTitle,
                    null,
                    "append",
                  );
                }}
              >
                Generate as New Set
              </button>
            </div>
            <div className="d-flex justify-content-end gap-2 flex-wrap mt-3">
              <button
                type="button"
                className="btn btn-light"
                onClick={() => setPendingQuestionGeneration(null)}
              >
                Cancel
              </button>
            </div>
          </Modal>
          <Modal
            show={Boolean(pendingScriptRegeneration)}
            title="Use Latest Script Prompt"
            onClose={() => {
              if (isGeneratingSlideScripts) {
                return;
              }

              setPendingScriptRegeneration(null);
            }}
            size="md"
          >
            <p className="text-body-secondary mb-3">
              The script prompt changed after voiceover scripts were already generated. Choose whether to keep the
              current scripts or regenerate every slide with the latest prompt.
            </p>
            <div className="d-grid gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={isGeneratingSlideScripts}
                onClick={() => void handleRegenerateScriptsWithLatestPrompt()}
              >
                {isGeneratingSlideScripts ? "Generating..." : "Generate with Latest Prompt"}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={isGeneratingSlideScripts}
                onClick={() => {
                  setPendingScriptRegeneration(null);
                  setStep(3);
                }}
              >
                Skip
              </button>
            </div>
          </Modal>
          <Modal
            show={Boolean(configuringQuestionSet)}
            title={configuringQuestionSet ? `Configure ${configuringQuestionSet.label}` : "Configure Question Set"}
            onClose={() => setConfiguringQuestionSetId(null)}
            size="lg"
          >
            {configuringQuestionSet ? (
              <div className="training-question-config-sheet">
                <div className="training-question-config-hero">
                  <div>
                    <div className="training-builder-caption mb-2">Set-Level Regeneration</div>
                    <p className="text-body-secondary mb-0">
                      Refine this question set without changing where it appears in the learner flow.
                    </p>
                  </div>
                  <div className="training-question-config-summary">
                    {configuringQuestionSet.sourceRangeLabel ? (
                      <span className="badge text-bg-light border text-dark">{configuringQuestionSet.sourceRangeLabel}</span>
                    ) : null}
                    <span className="badge text-bg-light border text-dark">
                      {configuringQuestionSet.questionCount} current question{configuringQuestionSet.questionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="training-question-config-strip">
                  <div className="training-question-config-stat">
                    <span className="training-question-config-stat-label">Learner Attempt</span>
                    <strong>{configuringQuestionSet.isMandatory !== false ? "Mandatory" : "Optional"}</strong>
                  </div>
                  <div className="training-question-config-stat">
                    <span className="training-question-config-stat-label">Difficulty</span>
                    <strong className="text-capitalize">{questionGeneratorConfig.difficultyLevel}</strong>
                  </div>
                  <div className="training-question-config-stat">
                    <span className="training-question-config-stat-label">Question Count</span>
                    <strong>{questionGeneratorConfig.maximumQuestionsPerSet ?? configuringQuestionSet.questionCount}</strong>
                  </div>
                </div>

                <div className="training-question-config-grid">
                  <section className="training-question-config-card">
                    <label className="form-label d-block">Learner Attempt</label>
                    <label className="training-option-item mb-0">
                      <input
                        type="checkbox"
                        checked={configuringQuestionSet.isMandatory !== false}
                        onChange={(event) =>
                          setQuestionSets((current) =>
                            current.map((questionSet) =>
                              questionSet.id === configuringQuestionSet.id
                                ? {
                                  ...questionSet,
                                  isMandatory: event.target.checked,
                                  updatedAt: new Date().toISOString(),
                                }
                                : questionSet,
                            ),
                          )
                        }
                      />
                      <span>
                        <strong>Mandatory knowledge check</strong>
                        <small>Learners must submit this question set before moving ahead.</small>
                      </span>
                    </label>
                  </section>

                  <section className="training-question-config-card">
                    <label className="form-label">Difficulty</label>
                    <select
                      className="form-select"
                      value={questionGeneratorConfig.difficultyLevel}
                      onChange={(event) =>
                        setQuestionGeneratorConfig((current) => ({
                          ...current,
                          difficultyLevel: event.target.value as TrainingQuestionDifficulty,
                        }))
                      }
                    >
                      {questionDifficultyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="form-text">Tune the depth of the regenerated questions for this checkpoint.</div>
                  </section>

                  <section className="training-question-config-card training-question-config-card-count">
                    <label className="form-label">Question Count</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className="form-control"
                      value={questionGeneratorConfig.maximumQuestionsPerSet ?? configuringQuestionSet.questionCount}
                      onChange={(event) =>
                        setQuestionGeneratorConfig((current) => {
                          const nextCount = Math.min(10, Math.max(1, Number(event.target.value || configuringQuestionSet.questionCount)));
                          return {
                            ...current,
                            minimumQuestionsPerSet: nextCount,
                            maximumQuestionsPerSet: nextCount,
                          };
                        })
                      }
                    />
                    <div className="form-text">Choose any value from 1 to 10 for client-side regeneration.</div>
                  </section>

                  <section className="training-question-config-card training-question-config-card-wide">
                    <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-2">
                      <label className="form-label mb-0">Question Types</label>
                      <span className="small text-body-secondary">
                        {questionGeneratorConfig.preferredQuestionTypes?.length ?? 0} selected
                      </span>
                    </div>
                    <div className="training-question-config-types">
                      {(["objective", "multi_select", "subjective", "text_area"] as TrainingQuestionCheckpoint["questionType"][]).map((questionType) => {
                        const selected = questionGeneratorConfig.preferredQuestionTypes?.includes(questionType);
                        return (
                          <button
                            key={`config-${questionType}`}
                            type="button"
                            className={`training-question-config-type-chip ${selected ? "is-active" : ""}`}
                            onClick={() => togglePreferredQuestionType(questionType)}
                          >
                            <span>{humanizeTrainingQuestionType(questionType)}</span>
                            <i className={`bi ${selected ? "bi-check2" : "bi-plus-lg"}`} aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                    <div className="form-text">Keep only the formats you want AI to use when regenerating this set.</div>
                  </section>
                </div>

                <div className="training-question-config-footer">
                  <button type="button" className="btn btn-light" onClick={() => setConfiguringQuestionSetId(null)}>
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isGeneratingQuestions}
                    onClick={() => void generateAiQuestionDrafts(values.title, configuringQuestionSet.id)}
                  >
                    {isGeneratingQuestions ? "Regenerating..." : "Regenerate Set"}
                  </button>
                </div>
              </div>
            ) : null}
          </Modal>
        </>
      )}
    </Formik>
  );
};

const TrainingDetail = ({
  role,
  training,
  sessionName,
  permission,
  detailTab,
  onBack,
  onGoDashboard,
  onChangeTab,
  onEditTraining,
  onDeleteTraining,
}: TrainingDetailProps) => {
  const dispatch = useAppDispatch();
  const reviewAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [reviewRoomOpen, setReviewRoomOpen] = useState(false);
  const [reviewMessageDraft, setReviewMessageDraft] = useState("");
  const [reviewAttachmentDrafts, setReviewAttachmentDrafts] = useState<TrainingReviewAttachment[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [traineeRecords, setTraineeRecords] = useState<UserRecord[]>([]);
  const [assignQuery, setAssignQuery] = useState("");
  const [selectedTraineeIds, setSelectedTraineeIds] = useState<string[]>([]);
  const [loadingTrainees, setLoadingTrainees] = useState(false);
  const [assigningTraining, setAssigningTraining] = useState(false);
  const [expandedReviewQuestionSetIds, setExpandedReviewQuestionSetIds] = useState<string[]>([]);
  const [expandedSlideId, setExpandedSlideId] = useState<string | null>(null);
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  const reviewerPendingCount = training.slides.flatMap((slide) => slide.comments).filter((comment) => !comment.resolved).length;
  const currentReviewAuthor = useMemo(() => buildReviewParticipantLabel(role, sessionName), [role, sessionName]);
  const currentReviewAuthorKey = useMemo(() => buildReviewParticipantKey(role, sessionName), [role, sessionName]);
  const reviewMessages = useMemo(
    () =>
      (training.reviewMessages ?? []).map((message) => ({
        ...message,
        readBy: Array.isArray(message.readBy) ? message.readBy : [],
      })),
    [training.reviewMessages],
  );
  const legacySlideReviewMessages = training.slides.flatMap((slide, slideIndex) =>
    slide.comments.map((comment) => ({
      ...comment,
      slideLabel: `Slide ${slideIndex + 1}: ${slide.title}`,
      attachments: [],
      readBy: [],
      authorKey: undefined,
    })),
  );
  const allReviewMessages = [...legacySlideReviewMessages, ...reviewMessages.map((message) => ({ ...message, slideLabel: null }))];
  const unreadReviewRoomCount = useMemo(
    () =>
      reviewMessages.filter(
        (message) =>
          (message.authorKey ? message.authorKey !== currentReviewAuthorKey : message.author !== currentReviewAuthor) &&
          !message.readBy?.includes(currentReviewAuthorKey),
      ).length,
    [currentReviewAuthor, currentReviewAuthorKey, reviewMessages],
  );
  const normalizedSessions = useMemo(() => normalizeTrainingSessions(training.sessions), [training.sessions]);
  const finalizedSessions = useMemo(
    () => normalizedSessions.filter((session) => session.status === "completed"),
    [normalizedSessions],
  );
  const completedSessions = finalizedSessions.length;
  const inProgressSessions = normalizedSessions.filter((session) => session.status === "in-progress").length;
  const notStartedSessions = normalizedSessions.filter((session) => session.status === "not-started").length;
  const canEdit = canEditTraining(permission, role);
  const isReviewableTraining = training.status !== "draft" && training.status !== "approved";
  const canReviewTraining = permission.includes(PermissionKeys.trainingReview) && isReviewableTraining;
  const canCommentOnThread = permission.includes(PermissionKeys.trainingComment) && (role === "reviewer" ? true : canEdit);
  const canResubmit = canEdit && permission.includes(PermissionKeys.trainingSubmit) && training.status !== "approved";
  const canRequestChanges = canReviewTraining && permission.includes(PermissionKeys.trainingRequestChanges);
  const canApprove = permission.includes(PermissionKeys.trainingApprove) && isReviewableTraining;
  const canAssignTraining = permission.includes(PermissionKeys.trainingAssign);
  const canDelete = canDeleteTraining(permission, role);
  const hasPublicLaunchLink = training.status === "approved";
  const expandedReviewQuestionSetMap = useMemo(
    () => new Set(expandedReviewQuestionSetIds),
    [expandedReviewQuestionSetIds],
  );

  useEffect(() => {
    if (!reviewRoomOpen || !unreadReviewRoomCount) {
      return;
    }

    dispatch(markTrainingReviewMessagesRead({ trainingId: training.id, viewerKey: currentReviewAuthorKey }));
  }, [currentReviewAuthorKey, dispatch, reviewRoomOpen, training.id, unreadReviewRoomCount]);

  const addReviewAttachments = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) {
      return;
    }

    const attachments = await Promise.all(
      files.map(
        (file) =>
          new Promise<TrainingReviewAttachment>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
              resolve({
                id: `review-attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                kind,
                name: file.name,
                url: typeof reader.result === "string" ? reader.result : "",
              });
            };
            reader.readAsDataURL(file);
          }),
      ),
    );

    setReviewAttachmentDrafts((current) => [...current, ...attachments]);
    if (reviewAttachmentInputRef.current) {
      reviewAttachmentInputRef.current.value = "";
    }
  };

  const postReviewMessage = () => {
    const text = reviewMessageDraft.trim();

    if (!text && !reviewAttachmentDrafts.length) {
      toast.error("Write a message or attach something before posting.");
      return;
    }

    dispatch(
      addTrainingReviewMessage({
        trainingId: training.id,
        author: currentReviewAuthor,
        authorKey: currentReviewAuthorKey,
        role,
        text,
        attachments: reviewAttachmentDrafts,
      }),
    );
    setReviewMessageDraft("");
    setReviewAttachmentDrafts([]);
    toast.success("Review message posted.");
  };
  const activeSessionReport =
    finalizedSessions.find((session) => session.id === reportSessionId || session.sourceSessionIds.includes(reportSessionId || "")) ||
    null;
  const activeProctoringReport = activeSessionReport?.proctoringReport || null;
  const activeRiskTone = getRiskTone(activeProctoringReport?.riskScore ?? 0);
  const activeAttentionTone = getAttentionTone(activeProctoringReport?.attentionScore ?? 100);
  const reviewQuestionSets = useMemo(
    () => deriveQuestionSetState(training, training.slides).questionSets,
    [training],
  );
  useEffect(() => {
    setExpandedReviewQuestionSetIds((current) => {
      if (current.length) {
        return current;
      }

      const firstSetId = reviewQuestionSets[0]?.id;
      return firstSetId ? [firstSetId] : [];
    });
  }, [reviewQuestionSets]);
  const loadTrainees = useCallback(async () => {
    setLoadingTrainees(true);
    const response = await AxiosHelper.getData<PaginatedResponse<UserRecord>>("/training-workspace/trainees", {
      limit: 200,
      pageNo: 1,
      query: "",
    });
    setLoadingTrainees(false);

    if (!response.data.status) {
      toast.error(response.data.message);
      return;
    }

    setTraineeRecords(response.data.data.record.filter((user) => user.status === "active"));
  }, []);

  // Feature 5: lazily load training-level group analytics so the workspace can
  // show summary cards + the "View Analytics" entry only when sessions exist.
  const [groupAnalytics, setGroupAnalytics] = useState<TrainingAnalytics | null>(null);
  const [groupAnalyticsLoading, setGroupAnalyticsLoading] = useState(false);
  useEffect(() => {
    if (training.trainingType !== "group") { setGroupAnalytics(null); return; }
    let active = true;
    setGroupAnalyticsLoading(true);
    (async () => {
      const res = await getTrainingAnalytics(training.id);
      if (!active) return;
      setGroupAnalyticsLoading(false);
      setGroupAnalytics(res.data.status && res.data.data?.analytics ? res.data.data.analytics : null);
    })();
    return () => { active = false; };
  }, [training.trainingType, training.id]);
  const openGroupAnalytics = () => window.open(withOrigin(`/training/${training.id}/analytics`), "_blank", "noopener");

  const handleLaunchHall = async () => {
    const response = await createGroupSession(training.id);
    if (!response.data.status) {
      toast.error(response.data.message || "Unable to create the group session.");
      return;
    }
    const { session, joinCode, reused } = response.data.data;
    const joinUrl = withOrigin(`/group/${session.id}`);
    const hallUrl = withOrigin(`/hall/${session.id}`);
    const dashboardUrl = withOrigin(`/group-sessions/${session.id}/live`);
    await navigator.clipboard?.writeText(`Join code: ${joinCode}\nTrainee link: ${joinUrl}`).catch(() => undefined);
    // Only one active session is ever allowed per training — if one is already
    // running, we reopen it instead of creating a second one. Say so explicitly
    // so this doesn't read as "a new session was created" to the host.
    toast.success(
      reused
        ? `This training already has an active session. Rejoining it — join code ${joinCode} copied.`
        : `Group session created. Join code ${joinCode} copied. Opening hall + live dashboard…`,
    );
    window.open(hallUrl, "_blank", "noopener");
    window.open(dashboardUrl, "_blank", "noopener");
  };

  const handleShareTraining = async () => {
    const launchUrl = buildTrainingLaunchUrl(training.id);

    try {
      if (navigator.share) {
        await navigator.share({
          title: training.title,
          text: `Access the assigned training: ${training.title}`,
          url: launchUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(launchUrl);
      toast.success("Training link copied.");
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        return;
      }

      await navigator.clipboard.writeText(launchUrl);
      toast.success("Training link copied.");
    }
  };

  const filteredTrainees = useMemo(() => {
    const needle = assignQuery.trim().toLowerCase();

    return traineeRecords.filter(
      (trainee) => !needle || [trainee.name, trainee.email].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [assignQuery, traineeRecords]);

  const openAssignTrainingModal = () => {
    if (!canAssignTraining) {
      toast.error("You do not have permission to assign training.");
      return;
    }

    setAssignModalOpen(true);
    setAssignQuery("");
    setSelectedTraineeIds([]);
    void loadTrainees();
  };

  const handleAssignTraining = async () => {
    const selectedTrainees = traineeRecords.filter((trainee) => selectedTraineeIds.includes(trainee.id));

    if (!selectedTrainees.length) {
      toast.error("Select at least one trainee.");
      return;
    }

    const existingSessionKeys = new Set(
      (training.sessions ?? []).map((session) => `${session.learnerEmail || session.ssoId}`.toLowerCase()),
    );
    const newSessions = selectedTrainees
      .filter((trainee) => !existingSessionKeys.has(trainee.email.toLowerCase()))
      .map((trainee) => buildAssignedTrainingSession(training, trainee));

    if (!newSessions.length) {
      toast.info("Selected trainees are already assigned.");
      return;
    }

    setAssigningTraining(true);
    if (isServerApiEnabled) {
      const response = await AxiosHelper.postData<
        { training: TrainingWorkspaceRecord; emailResult?: { success?: boolean; message?: string; details?: string } },
        { traineeIds: string[] }
      >(`/training-workspace/${training.id}/assign`, {
        traineeIds: selectedTraineeIds,
      });

      if (!response.data.status) {
        setAssigningTraining(false);
        toast.error(response.data.message);
        return;
      }

      dispatch(saveTraining(response.data.data.training));
      if (response.data.data.emailResult?.success === false) {
        toast.warning(response.data.data.emailResult.message || response.data.message);
      } else {
        toast.success(response.data.message);
      }
    } else {
      dispatch(
        saveTraining({
          ...training,
          sessions: [...(training.sessions ?? []), ...newSessions],
          lastActivity: "Today",
        }),
      );
      toast.success(`Training assigned to ${newSessions.length} trainee${newSessions.length === 1 ? "" : "s"}.`);
    }
    setAssigningTraining(false);
    setAssignModalOpen(false);
    setSelectedTraineeIds([]);
  };
  const reviewQuestionSetsByPlacement = useMemo(() => {
    const beforeSlide = new Map<string, TrainingQuestionSetRecord[]>();
    const afterSlide = new Map<string, TrainingQuestionSetRecord[]>();
    const endOfTraining: TrainingQuestionSetRecord[] = [];

    reviewQuestionSets.forEach((questionSet) => {
      if (questionSet.placementMode === "end_of_training" || !questionSet.slideId) {
        endOfTraining.push(questionSet);
        return;
      }

      const targetMap =
        questionSet.placementMode === "before_slide" ? beforeSlide : afterSlide;
      targetMap.set(questionSet.slideId, [
        ...(targetMap.get(questionSet.slideId) ?? []),
        questionSet,
      ]);
    });

    return {
      beforeSlide,
      afterSlide,
      endOfTraining,
    };
  }, [reviewQuestionSets]);
  const downloadSessionReport = () => {
    if (!activeSessionReport) {
      return;
    }

    const learnerName = activeSessionReport.learnerName || activeSessionReport.ssoId;
    const learnerEmail = activeSessionReport.learnerEmail || activeSessionReport.ssoId;
    const viewedSlides = Array.isArray(activeSessionReport.viewedSlideIds) && activeSessionReport.viewedSlideIds.length
      ? activeSessionReport.viewedSlideIds
      : ["No step IDs recorded"];
    const transcriptEntries = dedupeSessionAskHistory(
      Array.isArray(activeSessionReport.askTranscripts)
        ? activeSessionReport.askTranscripts
        : Array.isArray(activeSessionReport.askHistory)
          ? activeSessionReport.askHistory
          : [],
    );
    const proctoringEvents = activeProctoringReport?.events || [];
    const proctoringTimeline = activeProctoringReport?.timeline || [];

    const printableHtml = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>${escapeReportHtml(training.title)} - Session Report</title>
          <style>
            :root {
              color-scheme: light;
              --report-primary: #3e60d5;
              --report-primary-soft: rgba(62, 96, 213, 0.08);
              --report-border: #dbe4f0;
              --report-surface: #ffffff;
              --report-surface-alt: #f8fbff;
              --report-text: #1f2937;
              --report-muted: #64748b;
              --report-success: #198754;
              --report-warning: #b7791f;
              --report-danger: #c2415d;
            }

            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              color: var(--report-text);
              background: #eef4fb;
              padding: 24px;
            }

            .report-shell {
              max-width: 980px;
              margin: 0 auto;
              display: grid;
              gap: 18px;
            }

            .report-card {
              background: var(--report-surface);
              border: 1px solid var(--report-border);
              border-radius: 16px;
              padding: 20px;
            }

            .report-header {
              border-top: 4px solid var(--report-primary);
              padding-top: 18px;
            }

            .report-kicker {
              margin: 0 0 8px;
              color: var(--report-primary);
              text-transform: uppercase;
              letter-spacing: 0.12em;
              font-size: 11px;
              font-weight: 700;
            }

            h1, h2, h3, p { margin: 0; }
            h1 { font-size: 28px; margin-bottom: 8px; }
            h2 { font-size: 18px; margin-bottom: 12px; }
            .report-meta {
              display: grid;
              gap: 6px;
              color: var(--report-muted);
              font-size: 13px;
            }

            .report-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
            }

            .report-stats {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 12px;
            }

            .stat {
              background: var(--report-surface-alt);
              border: 1px solid var(--report-border);
              border-radius: 12px;
              padding: 14px;
            }

            .stat-label {
              font-size: 12px;
              color: var(--report-muted);
              margin-bottom: 6px;
            }

            .stat-value {
              font-size: 24px;
              font-weight: 700;
            }

            .progress-rail {
              margin-top: 10px;
              height: 10px;
              border-radius: 999px;
              background: #dfe7f3;
              overflow: hidden;
            }

            .progress-fill {
              height: 100%;
              border-radius: inherit;
              background: var(--report-primary);
            }

            .detail-list,
            .timeline-list,
            .transcript-list {
              display: grid;
              gap: 10px;
            }

            .detail-item,
            .timeline-item,
            .transcript-item {
              border: 1px solid var(--report-border);
              border-radius: 12px;
              padding: 12px 14px;
              background: var(--report-surface-alt);
            }

            .detail-key,
            .timeline-time,
            .transcript-label {
              color: var(--report-muted);
              font-size: 12px;
              margin-bottom: 4px;
            }

            .detail-value {
              font-weight: 600;
            }

            .badge {
              display: inline-block;
              border-radius: 999px;
              padding: 6px 10px;
              font-size: 12px;
              font-weight: 700;
              background: var(--report-primary-soft);
              color: var(--report-primary);
            }

            .tone-safe { color: var(--report-success); }
            .tone-warning { color: var(--report-warning); }
            .tone-critical { color: var(--report-danger); }

            .transcript-answer {
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px dashed var(--report-border);
            }

            @page {
              size: A4;
              margin: 14mm;
            }

            @media print {
              body {
                background: #ffffff;
                padding: 0;
              }

              .report-shell {
                max-width: none;
              }

              .report-card,
              .stat,
              .detail-item,
              .timeline-item,
              .transcript-item {
                break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="report-shell">
            <section class="report-card report-header">
              <div class="report-kicker">Training Session Report</div>
              <h1>${escapeReportHtml(training.title)}</h1>
              <div class="report-meta">
                <div>Session ID: ${escapeReportHtml(activeSessionReport.id)}</div>
                <div>Learner: ${escapeReportHtml(learnerName)} | ${escapeReportHtml(learnerEmail)}</div>
                <div>Started: ${escapeReportHtml(activeSessionReport.startedAt || "-")} | Completed: ${escapeReportHtml(activeSessionReport.completedAt || "-")}</div>
              </div>
            </section>

            <section class="report-card">
              <h2>Session Overview</h2>
              <div class="report-stats">
                <div class="stat">
                  <div class="stat-label">Time Spent</div>
                  <div class="stat-value">${escapeReportHtml(activeSessionReport.timeSpent)}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Slides Viewed</div>
                  <div class="stat-value">${escapeReportHtml(`${activeSessionReport.slidesViewed}/${activeSessionReport.totalSlides}`)}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">F&Q Score</div>
                  <div class="stat-value">${escapeReportHtml(activeSessionReport.score !== null ? `${activeSessionReport.score}%` : "Pending")}</div>
                </div>
              </div>
              <div class="progress-rail">
                <div class="progress-fill" style="width:${Math.max(6, activeSessionReport.progressPercent ?? 0)}%"></div>
              </div>
              <div style="margin-top:10px;color:#64748b;font-size:13px;">
                Progress ${escapeReportHtml(`${activeSessionReport.progressPercent ?? 0}%`)} | Status:
                <span class="badge">${escapeReportHtml(activeSessionReport.status)}</span>
              </div>
            </section>

            <section class="report-card">
              <h2>Learner and Completion Details</h2>
              <div class="report-grid">
                <div class="detail-list">
                  <div class="detail-item">
                    <div class="detail-key">Learner Name</div>
                    <div class="detail-value">${escapeReportHtml(learnerName)}</div>
                  </div>
                  <div class="detail-item">
                    <div class="detail-key">Learner Email / SSO</div>
                    <div class="detail-value">${escapeReportHtml(learnerEmail)}</div>
                  </div>
                  <div class="detail-item">
                    <div class="detail-key">Viewed Steps</div>
                    <div class="detail-value">${escapeReportHtml(getViewedSlidesLabel(activeSessionReport))}</div>
                  </div>
                </div>
                <div class="detail-list">
                  ${viewedSlides.map((slideId) => `
                    <div class="detail-item">
                      <div class="detail-key">Tracked Step ID</div>
                      <div class="detail-value">${escapeReportHtml(slideId)}</div>
                    </div>
                  `).join("")}
                </div>
              </div>
            </section>

            <section class="report-card">
              <h2>F&Q / Knowledge Check Result</h2>
              <div class="report-stats">
                <div class="stat">
                  <div class="stat-label">Correct Answers</div>
                  <div class="stat-value">${escapeReportHtml(activeSessionReport.correctAnswers ?? 0)}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Total Questions</div>
                  <div class="stat-value">${escapeReportHtml(activeSessionReport.totalQuestions ?? 0)}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Final Result</div>
                  <div class="stat-value">${escapeReportHtml(activeSessionReport.score !== null ? `${activeSessionReport.score}%` : "Pending")}</div>
                </div>
              </div>
            </section>

            <section class="report-card">
              <h2>Ask Mode Transcript</h2>
              <div class="transcript-list">
                ${transcriptEntries.length ? transcriptEntries.map((item) => `
                  <div class="transcript-item">
                    <div class="transcript-label">Learner Question${item.askedAt ? ` | ${escapeReportHtml(item.askedAt)}` : ""}</div>
                    <div class="transcript-label">Source: ${escapeReportHtml(item.inputMode || "typed")} | STT: ${escapeReportHtml(item.sttProvider || "-")} | Language: ${escapeReportHtml(item.language || "-")} | Slide: ${escapeReportHtml(item.slideId || "-")}</div>
                    <div>${escapeReportHtml(item.question)}</div>
                    <div class="transcript-answer">
                      <div class="transcript-label">Amara Reply</div>
                      <div>${escapeReportHtml(item.answer)}</div>
                    </div>
                  </div>
                `).join("") : `
                  <div class="transcript-item">
                    <div>No Ask mode conversation happened in this session.</div>
                  </div>
                `}
              </div>
            </section>

            <section class="report-card">
              <h2>Proctoring Summary</h2>
              ${activeProctoringReport ? `
                <div class="report-stats">
                  <div class="stat">
                    <div class="stat-label">Attention Score</div>
                    <div class="stat-value tone-${escapeReportHtml(activeAttentionTone)}">${escapeReportHtml(activeProctoringReport.attentionScore)}/100</div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Risk Score</div>
                    <div class="stat-value tone-${escapeReportHtml(activeRiskTone)}">${escapeReportHtml(activeProctoringReport.riskScore)}</div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Status</div>
                    <div class="stat-value" style="font-size:18px">${escapeReportHtml(activeProctoringReport.status || "Not available")}</div>
                  </div>
                </div>
                <div class="report-grid" style="margin-top:16px">
                  <div class="detail-list">
                    ${[
          ["Looking Away", activeProctoringReport.eventCounts.lookingAway],
          ["Speaking", activeProctoringReport.eventCounts.talking],
          ["Reading", activeProctoringReport.eventCounts.reading],
          ["Tab Switch", activeProctoringReport.eventCounts.tabSwitch],
          ["Candidate Returned", activeProctoringReport.eventCounts.returnedToInterview],
          ["No Face", activeProctoringReport.eventCounts.noFace],
          ["Multiple Faces", activeProctoringReport.eventCounts.multipleFaces],
          ["Another Device", activeProctoringReport.eventCounts.anotherDevice],
        ].map(([label, value]) => `
                      <div class="detail-item">
                        <div class="detail-key">${escapeReportHtml(label)}</div>
                        <div class="detail-value">${escapeReportHtml(value)}</div>
                      </div>
                    `).join("")}
                  </div>
                  <div>
                    <div class="timeline-list">
                      ${proctoringTimeline.length ? proctoringTimeline.slice(-12).map((point) => `
                        <div class="timeline-item">
                          <div class="timeline-time">${escapeReportHtml(point.elapsedLabel)}</div>
                          <div>Risk: ${escapeReportHtml(point.riskScore)} | Attention: ${escapeReportHtml(point.attentionScore)}</div>
                        </div>
                      `).join("") : `
                        <div class="timeline-item">No timeline snapshot available.</div>
                      `}
                    </div>
                  </div>
                </div>
                <div class="timeline-list" style="margin-top:16px">
                  ${proctoringEvents.length ? proctoringEvents.slice().reverse().slice(0, 20).map((entry) => `
                    <div class="timeline-item">
                      <div class="timeline-time">${escapeReportHtml(entry.timestamp)}</div>
                      <div>${escapeReportHtml(entry.message)}</div>
                    </div>
                  `).join("") : `
                    <div class="timeline-item">No proctoring events were stored for this session.</div>
                  `}
                </div>
              ` : `
                <div class="detail-item">No proctoring snapshot was saved for this session.</div>
              `}
            </section>
          </div>
          <script>
            window.addEventListener("load", () => {
              setTimeout(() => {
                window.print();
              }, 250);
            });
          </script>
        </body>
      </html>
    `;

    try {
      const reportBlob = new Blob([printableHtml], { type: "text/html;charset=utf-8" });
      const reportUrl = URL.createObjectURL(reportBlob);
      const reportWindow = window.open(reportUrl, "_blank", "width=1120,height=900");

      if (!reportWindow) {
        URL.revokeObjectURL(reportUrl);
        toast.error("Unable to open the PDF preview window.");
        return;
      }

      window.setTimeout(() => {
        URL.revokeObjectURL(reportUrl);
      }, 60000);
    } catch (error) {
      console.error("[TrainingWorkspace] Unable to prepare session report PDF preview", error);
      toast.error("Unable to prepare the PDF report.");
    }
  };

  const renderReviewQuestionSetCard = (
    questionSet: TrainingQuestionSetRecord,
    setIndex: number,
  ) => (
    <div key={questionSet.id} className="experience-list-item mb-4">
      <div className="training-question-set-header">
        <div className="training-question-set-summary">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <strong>{questionSet.label}</strong>
            <span className={`badge ${questionSet.isActive ? "text-bg-primary" : "text-bg-light border text-dark"}`}>
              {questionSet.isActive ? "Active" : `Set ${setIndex + 1}`}
            </span>
            <span className="badge text-bg-light border text-dark">{questionSet.questionCount} questions</span>
            <span className={`badge ${questionSet.isMandatory !== false ? "text-bg-warning" : "text-bg-light border text-dark"}`}>
              {questionSet.isMandatory !== false ? "Mandatory" : "Optional"}
            </span>
          </div>
          <div className="small text-body-secondary mt-1">
            {formatQuestionSetPlacement({
              placementMode: questionSet.placementMode,
              slideTitle: questionSet.slideTitle,
            })}{" "}
            | {questionSet.difficultyLevel} difficulty
          </div>
          {questionSet.plannerSummary ? (
            <div className="small text-body-secondary mt-2">{questionSet.plannerSummary}</div>
          ) : null}
          <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
            {questionSet.sourceRangeLabel ? (
              <span className="badge text-bg-light border text-dark">{questionSet.sourceRangeLabel}</span>
            ) : null}
          </div>
          {questionSet.topicTags.length ? (
            <div className="d-flex flex-wrap gap-2 mt-2">
              {questionSet.topicTags.map((tag) => (
                <span key={`${questionSet.id}-${tag}`} className="badge text-bg-light border text-dark">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="training-question-set-actions">
          <button
            type="button"
            className="btn btn-sm btn-light"
            onClick={() =>
              setExpandedReviewQuestionSetIds((current) =>
                current.includes(questionSet.id)
                  ? current.filter((item) => item !== questionSet.id)
                  : [...current, questionSet.id],
              )
            }
            aria-label={expandedReviewQuestionSetMap.has(questionSet.id) ? "Collapse set" : "Expand set"}
          >
            <i
              className={`bi ${expandedReviewQuestionSetMap.has(questionSet.id) ? "bi-chevron-up" : "bi-chevron-down"}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      {expandedReviewQuestionSetMap.has(questionSet.id) ? (
        <div className="mt-3 pt-3 border-top">
          <div className="small text-body-secondary mb-3">
            Preview of learner-facing questions in this set.
          </div>
          <div className="experience-list">
            {questionSet.checkpoints.map((checkpoint, checkpointIndex) => (
              <div key={checkpoint.id} className="experience-list-item">
                <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="d-flex gap-2 flex-wrap mb-2">
                      <span className="badge text-bg-primary">Question {checkpointIndex + 1}</span>
                      <span className="badge text-bg-light border text-dark">
                        {humanizeTrainingQuestionType(checkpoint.questionType)}
                      </span>
                    </div>
                    <div className="fw-semibold">{checkpoint.prompt}</div>
                  </div>
                  {checkpoint.sourceLabels.length ? (
                    <div className="d-flex gap-2 flex-wrap">
                      {checkpoint.sourceLabels.map((label) => (
                        <span key={`${checkpoint.id}-${label}`} className="badge text-bg-light border text-dark">
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {isChoiceQuestionType(checkpoint.questionType) && checkpoint.options.length ? (
                  <div className="training-question-preview-options mb-3">
                    {checkpoint.options.map((option, optionIndex) => (
                      <div key={`${checkpoint.id}-${optionIndex}`} className="training-question-preview-option">
                        <span className="training-question-preview-option-marker" aria-hidden="true" />
                        <span>{option}</span>
                      </div>
                    ))}
                  </div>
                ) : checkpoint.questionType === "text_area" || checkpoint.questionType === "subjective" ? (
                  <div className="training-readonly-script min-sm mb-3">
                    Learner will respond in a free-text answer area.
                  </div>
                ) : null}
                <div className="row g-3">
                  <div className="col-12 col-xl-7">
                    <div className="small text-body-secondary mb-1">Expected Answer</div>
                    <div className="training-readonly-script min-sm">
                      {checkpoint.expectedAnswer || "No expected answer defined yet."}
                    </div>
                  </div>
                  <div className="col-12 col-xl-5">
                    <div className="small text-body-secondary mb-1">Keyword Match Rules</div>
                    {checkpoint.keywordMatches.length ? (
                      <div className="d-flex gap-2 flex-wrap">
                        {checkpoint.keywordMatches.map((keyword) => (
                          <span key={`${checkpoint.id}-${keyword}`} className="badge text-bg-light border text-dark">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="training-readonly-script min-sm">No keyword rules added.</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="training-detail-shell">
      <WorkspaceBreadcrumb
        items={[
          { label: "Dashboard", onClick: onGoDashboard },
          { label: "Training", onClick: onBack },
          { label: training.title },
        ]}
      />

      <div className="training-detail-hero">
        <div className="training-detail-hero-main">
          <button type="button" className="btn btn-light btn-sm" onClick={onBack}>
            <i className="bi bi-arrow-left" /> Back
          </button>
          <div className="training-detail-title">
            <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
              <h4 className="mb-0">{training.title}</h4>
              {renderTrainingStatusBadge(training.status)}
            </div>
            <div className="text-body-secondary small">
              {training.type} | {training.slides.length} slides | Created {training.created}
            </div>
          </div>
        </div>
        <div className="training-detail-actions">
          {hasPublicLaunchLink ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleShareTraining()}
              >
                <i className="ri-share-forward-line me-1" />
                Share
              </button>
              {canAssignTraining ? (
                <button type="button" className="btn btn-light btn-sm" onClick={openAssignTrainingModal}>
                  <i className="ri-user-add-line me-1" />
                  Assign
                </button>
              ) : null}
              {training.trainingType === "group" ? (
                <button type="button" className="btn btn-warning btn-sm" onClick={() => void handleLaunchHall()}>
                  <i className="ri-tv-line me-1" />
                  Launch Hall
                </button>
              ) : null}
              {/* Feature 5: only shown for group trainings that have ≥1 session. */}
              {training.trainingType === "group" && (groupAnalytics?.totalSessions || 0) > 0 ? (
                <button type="button" className="btn btn-info btn-sm" onClick={openGroupAnalytics}>
                  <i className="bi bi-graph-up me-1" />
                  View Analytics
                </button>
              ) : null}
            </>
          ) : (
            <span className="badge text-bg-light border text-dark">Awaiting approval</span>
          )}
          {canEdit ? (
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={onEditTraining}>
              <i className="ri-pencil-line me-1" />
              Edit
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={onDeleteTraining}>
              <i className="ri-delete-bin-line me-1" />
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {/* Feature 5: group-training analytics summary (with loading/empty states). */}
      {training.trainingType === "group" ? (
        groupAnalyticsLoading ? (
          <div className="text-body-secondary small mb-3"><i className="bi bi-hourglass-split me-1" />Loading group analytics…</div>
        ) : !groupAnalytics || groupAnalytics.totalSessions === 0 ? (
          <div className="alert alert-light border small mb-3">
            <i className="bi bi-graph-up me-1" />No group sessions yet — analytics will appear after the first session runs.
          </div>
        ) : (
          <div className="row g-3 mb-3">
            {[
              ["Sessions", String(groupAnalytics.totalSessions), "bi bi-people", "text-primary"],
              ["Avg Attendance", `${groupAnalytics.avgAttendancePct}%`, "bi bi-person-check", "text-success"],
              ["Assessment Pass", `${groupAnalytics.assessmentPassRate}%`, "bi bi-mortarboard", "text-info"],
              ["Avg Risk Score", String(groupAnalytics.avgRiskScore), "bi bi-shield-exclamation", "text-danger"],
            ].map(([label, value, icon, tone]) => (
              <div key={label} className="col-6 col-xl-3">
                <div className="card admin-card-stat h-100" role="button" onClick={openGroupAnalytics}>
                  <div className="card-body">
                    <div className={`fs-3 ${tone} mb-2`}><i className={icon as string} /></div>
                    <div className="fs-4 fw-semibold">{value}</div>
                    <div className="small text-body-secondary">{label}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {/* One-on-One session stats — not relevant for Group (Hall) trainings,
          which show the group analytics cards above instead. */}
      {training.trainingType !== "group" ? (
        <div className="row g-3 mb-4">
          {[
            ["Total Sessions", finalizedSessions.length, "bi bi-people", "text-primary"],
            ["Completed", completedSessions, "bi bi-check2-circle", "text-success"],
            ["In Progress", inProgressSessions, "bi bi-hourglass-split", "text-warning"],
            ["Not Started", notStartedSessions, "bi bi-circle", "text-secondary"],
            ["Avg Score", `${getScoreAverage(finalizedSessions)}%`, "bi bi-bar-chart", "text-info"],
          ].map(([label, value, icon, tone]) => (
            <div key={label} className="col-12 col-md-6 col-xl">
              <div className="card admin-card-stat h-100">
                <div className="card-body">
                  <div className={`fs-3 ${tone} mb-2`}>
                    <i className={icon as string} />
                  </div>
                  <div className="fs-4 fw-semibold">{value}</div>
                  <div className="small text-body-secondary">{label}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {detailTab !== "report" ? (
        <div className="d-flex gap-2 flex-wrap mb-3">
          <button
            type="button"
            className={`btn btn-sm ${detailTab === "review" ? "btn-primary" : "btn-light"}`}
            onClick={() => onChangeTab("review")}
          >
            <i className="bi bi-chat-left-dots me-1" /> Review Thread
            {reviewerPendingCount ? <span className="badge text-bg-danger ms-2">{reviewerPendingCount}</span> : null}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${detailTab === "sessions" ? "btn-primary" : "btn-light"}`}
            onClick={() => onChangeTab("sessions")}
          >
            <i className="bi bi-list-check me-1" /> Sessions
          </button>
          {hasPublicLaunchLink ? (
            <button
              type="button"
              className={`btn btn-sm ${detailTab === "delivery" ? "btn-primary" : "btn-light"}`}
              onClick={() => onChangeTab("delivery")}
            >
              <i className="bi bi-share me-1" /> Share & Embed
            </button>
          ) : null}
          {activeSessionReport ? (
            <button
              type="button"
              className="btn btn-sm btn-light"
              onClick={() => onChangeTab("report")}
            >
              <i className="bi bi-file-earmark-bar-graph me-1" /> Report
            </button>
          ) : null}
        </div>
      ) : null}

      {detailTab === "delivery" && hasPublicLaunchLink ? (
        <div className="card">
          <div className="card-body">
            {training.trainingType === "group" ? (
              <>
                <div className="fw-semibold mb-2"><i className="ri-links-line me-1" />Group trainee join link</div>
                <code className="training-embed-code">{withOrigin(`/group/${training.id}`)}</code>
                <div className="d-flex gap-2 flex-wrap mt-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(withOrigin(`/group/${training.id}`));
                      toast.success("Trainee join link copied.");
                    }}
                  >
                    Copy Join Link
                  </button>
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    onClick={() => window.open(withBase(`/group/${training.id}`), "_blank", "noopener,noreferrer")}
                  >
                    Open Trainee View
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="fw-semibold mb-2"><i className="ri-code-line me-1" />Website embed code</div>
                <code className="training-embed-code">
                  {`<iframe src="${buildTrainingLaunchUrl(training.id)}" title="${training.title}" width="100%" height="720" style="border:0;border-radius:16px;overflow:hidden;" allow="autoplay; fullscreen"></iframe>`}
                </code>
                <div className="d-flex gap-2 flex-wrap mt-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        `<iframe src="${buildTrainingLaunchUrl(training.id)}" title="${training.title}" width="100%" height="720" style="border:0;border-radius:16px;overflow:hidden;" allow="autoplay; fullscreen"></iframe>`,
                      );
                      toast.success("Embed code copied.");
                    }}
                  >
                    Copy Embed Code
                  </button>
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    onClick={() => window.open(buildTrainingLaunchPath(training.id, true), "_blank", "noopener,noreferrer")}
                  >
                    Open Launch UI
                  </button>
                </div>
                <LmsLaunchLinkGenerator key={training.id} trainingId={training.id} lastLaunchLink={training.lastLaunchLink} />
              </>
            )}
          </div>
        </div>
      ) : null}

      {detailTab === "sessions" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
              <div>
                <h5 className="mb-1">Attending Sessions</h5>
                <p className="small text-muted mb-0">Learner progress, score, time spent, Ask mode transcript history, and proctoring summary.</p>
              </div>
              <button
                type="button"
                className="btn btn-light btn-sm"
                onClick={() => {
                  const rows = [
                    ["Learner", "Email", "Status", "Time Spent", "Slides Viewed", "Total Slides", "Quiz Score", "Started At", "Completed At", "Ask Transcript Count"],
                    ...finalizedSessions.map((session) => [
                      session.learnerName || session.ssoId,
                      session.learnerEmail || session.ssoId,
                      session.status,
                      session.timeSpent,
                      session.slidesViewed,
                      session.totalSlides,
                      session.score !== null ? `${session.score}%` : "",
                      session.startedAt || "",
                      session.completedAt || "",
                      session.askHistory?.length ?? 0,
                    ]),
                  ];
                  const csv = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${training.title.replace(/[^\w-]+/g, "-").toLowerCase()}-sessions.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                  toast.success("CSV exported.");
                }}
              >
                Export CSV
              </button>
            </div>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Status</th>
                    <th>Time Spent</th>
                    <th>Slides Viewed</th>
                    <th>Quiz Score</th>
                    <th>Started At</th>
                    <th className="text-end">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {finalizedSessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <div className="fw-semibold">{session.learnerName || session.ssoId}</div>
                        <div className="small text-body-secondary">{session.learnerEmail || session.ssoId}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${session.status === "completed"
                            ? "text-bg-success"
                            : session.status === "in-progress"
                              ? "text-bg-warning"
                              : "text-bg-secondary"
                            }`}
                        >
                          {session.status}
                        </span>
                      </td>
                      <td>{session.timeSpent}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span className="small fw-semibold">
                            {session.slidesViewed}/{session.totalSlides}
                          </span>
                          <div className="progress flex-grow-1" style={{ height: 6 }}>
                            <div
                              className="progress-bar"
                              style={{ width: `${(session.slidesViewed / session.totalSlides) * 100}%` }}
                            />
                          </div>
                        </div>
                        <div className="small text-body-secondary mt-1">{getViewedSlidesLabel(session)}</div>
                      </td>
                      <td>{session.score !== null ? `${session.score}%` : "-"}</td>
                      <td>{session.startedAt ?? "-"}</td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-light btn-sm"
                          onClick={() => {
                            setReportSessionId(session.id);
                            onChangeTab("report");
                          }}
                        >
                          View Report
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {detailTab === "report" && activeSessionReport ? (
        <div className="training-session-report-page">
          <div className="training-session-report-header">
            <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
              <div>
                <button type="button" className="btn btn-light btn-sm mb-3" onClick={() => onChangeTab("sessions")}>
                  <i className="bi bi-arrow-left me-1" /> Back to Sessions
                </button>
                <div className="training-session-report-kicker">Session Report</div>
                <h3 className="mb-2">{training.title}</h3>
                <div className="training-session-report-subtitle">
                  Session ID: {activeSessionReport.id} | Learner: {activeSessionReport.learnerName || activeSessionReport.ssoId}
                </div>
                <div className="training-session-report-subtitle">
                  {activeSessionReport.learnerEmail || activeSessionReport.ssoId} | Started {activeSessionReport.startedAt || "-"} | Completed {activeSessionReport.completedAt || "-"}
                </div>
              </div>
              <div className="d-flex gap-2 flex-wrap">
                <button type="button" className="btn btn-primary btn-sm" onClick={downloadSessionReport}>
                  <i className="bi bi-download me-1" /> Download PDF
                </button>
              </div>
            </div>
          </div>

          <div className="training-session-report">
            <div className="training-session-report-grid training-session-report-grid--hero">
              <div className="training-session-report-card">
                <div className="small text-body-secondary">Time Spent</div>
                <div className="training-session-report-value">{activeSessionReport.timeSpent}</div>
              </div>
              <div className="training-session-report-card">
                <div className="small text-body-secondary">Slides Viewed</div>
                <div className="training-session-report-value">
                  {activeSessionReport.slidesViewed}/{activeSessionReport.totalSlides}
                </div>
                <div className="small text-body-secondary">{getViewedSlidesLabel(activeSessionReport)}</div>
              </div>
              <div className="training-session-report-card">
                <div className="small text-body-secondary">F&amp;Q Result</div>
                <div className="training-session-report-value">
                  {activeSessionReport.correctAnswers ?? 0}/{activeSessionReport.totalQuestions ?? 0}
                </div>
                <div className="small text-body-secondary">
                  {activeSessionReport.score !== null ? `${activeSessionReport.score}% score` : "Awaiting score"}
                </div>
              </div>
              <div className={`training-session-report-card training-session-report-card--${activeAttentionTone}`}>
                <div className="small text-body-secondary">Attention Score</div>
                <div className="training-session-report-value">
                  {activeProctoringReport ? `${activeProctoringReport.attentionScore}/100` : "NA"}
                </div>
                <div className="small text-body-secondary">
                  {activeProctoringReport?.attentionLabel || "No snapshot"}
                </div>
              </div>
              <div className={`training-session-report-card training-session-report-card--${activeRiskTone}`}>
                <div className="small text-body-secondary">Risk Score</div>
                <div className="training-session-report-value">
                  {activeProctoringReport ? activeProctoringReport.riskScore : "NA"}
                </div>
                <div className="small text-body-secondary text-capitalize">
                  {activeProctoringReport?.status || "Not available"}
                </div>
              </div>
            </div>

            <div className="training-session-report-card training-session-report-card--timeline">
              <div className="d-flex justify-content-between gap-3 flex-wrap align-items-center mb-3">
                <div>
                  <div className="fw-semibold">Session Progress</div>
                  <div className="small text-body-secondary">
                    {activeSessionReport.progressPercent ?? 0}% learner progress across the module
                  </div>
                </div>
                <span className="badge text-bg-light border text-dark">
                  {activeSessionReport.status}
                </span>
              </div>
              <div className="training-session-report-progress">
                <span style={{ width: `${Math.max(6, activeSessionReport.progressPercent ?? 0)}%` }} />
              </div>
            </div>

            <div className="training-session-report-card training-session-report-card--proctor">
              <div className="d-flex justify-content-between gap-3 flex-wrap mb-3">
                <div>
                  <div className="fw-semibold">Proctoring Summary</div>
                  <div className="small text-body-secondary">
                    Severity-driven report for attention, risk, and behavior events.
                  </div>
                </div>
                <span className={`training-session-report-severity training-session-report-severity--${activeRiskTone}`}>
                  {activeProctoringReport?.attentionLabel || "Not available"}
                </span>
              </div>

              {activeProctoringReport ? (
                <>
                  <div className="training-session-report-scoreband">
                    <div className={`training-session-report-scorecard training-session-report-scorecard--${activeAttentionTone}`}>
                      <span>Attention</span>
                      <strong>{activeProctoringReport.attentionScore}/100</strong>
                    </div>
                    <div className={`training-session-report-scorecard training-session-report-scorecard--${activeRiskTone}`}>
                      <span>Risk</span>
                      <strong>{activeProctoringReport.riskScore}</strong>
                    </div>
                  </div>

                  <div className="training-session-proctor-grid">
                    <div className="training-session-proctor-metric">
                      <span>Looking Away</span>
                      <strong>{activeProctoringReport.eventCounts.lookingAway}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>Speaking</span>
                      <strong>{activeProctoringReport.eventCounts.talking}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>Reading</span>
                      <strong>{activeProctoringReport.eventCounts.reading}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>Tab Switch</span>
                      <strong>{activeProctoringReport.eventCounts.tabSwitch}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>Candidate Returned</span>
                      <strong>{activeProctoringReport.eventCounts.returnedToInterview}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>No Face</span>
                      <strong>{activeProctoringReport.eventCounts.noFace}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>Multiple Faces</span>
                      <strong>{activeProctoringReport.eventCounts.multipleFaces}</strong>
                    </div>
                    <div className="training-session-proctor-metric">
                      <span>Another Device</span>
                      <strong>{activeProctoringReport.eventCounts.anotherDevice}</strong>
                    </div>
                  </div>

                  {activeProctoringReport.timeline?.length ? (
                    <div className="training-session-report-chart">
                      {activeProctoringReport.timeline.slice(-12).map((point, index) => (
                        <div key={`${point.elapsedLabel}-${index}`} className="training-session-report-chart-bar">
                          <span
                            className={`training-session-report-chart-fill training-session-report-chart-fill--${getRiskTone(point.riskScore)}`}
                            style={{ height: `${Math.max(10, point.riskScore)}%` }}
                          />
                          <small>{point.elapsedLabel}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {activeProctoringReport.events?.length ? (
                    <div className="training-session-proctor-log">
                      {activeProctoringReport.events
                        .slice()
                        .reverse()
                        .slice(0, 10)
                        .map((entry, index) => (
                          <div
                            key={`${entry.timestamp}-${entry.message}-${index}`}
                            className="training-session-proctor-log-item"
                          >
                            <span>{entry.timestamp}</span>
                            <p>{entry.message}</p>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="small text-body-secondary">No proctoring snapshot was saved for this session.</div>
              )}
            </div>

            <div className="training-session-report-card">
              <div className="fw-semibold mb-2">F&amp;Q / Knowledge Check Result</div>
              <div className="training-session-report-grid">
                <div className="training-session-report-card training-session-report-card--inner">
                  <div className="small text-body-secondary">Correct Answers</div>
                  <div className="training-session-report-value">{activeSessionReport.correctAnswers ?? 0}</div>
                </div>
                <div className="training-session-report-card training-session-report-card--inner">
                  <div className="small text-body-secondary">Total Questions</div>
                  <div className="training-session-report-value">{activeSessionReport.totalQuestions ?? 0}</div>
                </div>
                <div className="training-session-report-card training-session-report-card--inner">
                  <div className="small text-body-secondary">Result</div>
                  <div className="training-session-report-value">
                    {activeSessionReport.score !== null ? `${activeSessionReport.score}%` : "Pending"}
                  </div>
                </div>
              </div>
            </div>

            <div className="training-session-report-card">
              <div className="fw-semibold mb-2">Ask Mode Transcript</div>
              {dedupeSessionAskHistory(
                Array.isArray(activeSessionReport.askTranscripts)
                  ? activeSessionReport.askTranscripts
                  : Array.isArray(activeSessionReport.askHistory)
                    ? activeSessionReport.askHistory
                    : [],
              ).length ? (
                <div className="training-session-transcript">
                  {dedupeSessionAskHistory(
                    Array.isArray(activeSessionReport.askTranscripts)
                      ? activeSessionReport.askTranscripts
                      : Array.isArray(activeSessionReport.askHistory)
                        ? activeSessionReport.askHistory
                        : [],
                  ).map((item, index) => (
                    <div key={`${item.question}-${index}`} className="training-session-transcript-item">
                      <div className="d-flex justify-content-between gap-3 flex-wrap mb-2">
                        <div className="small fw-semibold text-body-secondary">Learner Question</div>
                        <div className="small text-body-secondary">{item.askedAt || "-"}</div>
                      </div>
                      <div className="small text-body-secondary mb-2">
                        Source: {item.inputMode || "typed"} | STT: {item.sttProvider || "-"} | Language: {item.language || "-"} | Slide: {item.slideId || "-"}
                      </div>
                      <p className="mb-3">{item.question}</p>
                      <div className="small fw-semibold text-body-secondary">Amara Reply</div>
                      <p className="mb-0">{item.answer}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="small text-body-secondary">No Ask mode conversation happened in this session.</div>
              )}
            </div>

          </div>
        </div>
      ) : null}

      {detailTab === "review" ? (
        <>
          <div className="training-review-actionbar mb-3">
            <div>
              <div className="fw-semibold">{training.title}</div>
              <div className="small text-body-secondary">
                {training.slides.length} slides | Review mode | {reviewerPendingCount} unresolved comment
                {reviewerPendingCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setReviewRoomOpen(true)}>
                <i className="bi bi-chat-dots me-1" />
                Open Review Room
                {unreadReviewRoomCount ? <span className="badge text-bg-light text-dark ms-2">{unreadReviewRoomCount}</span> : null}
              </button>
              {role === "reviewer" ? (
                training.status === "approved" ? (
                  <span className="text-muted small align-self-center"></span>
                ) : training.status === "draft" ? (
                  <span className="text-muted small align-self-center">Trainer has not submitted this training yet.</span>
                ) : canRequestChanges || canApprove ? (
                  <>
                    {canRequestChanges ? (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => {
                          dispatch(requestTrainingChanges({ trainingId: training.id }));
                          toast.info("Changes requested for this training.");
                        }}
                      >
                        Request Changes
                      </button>
                    ) : null}
                    {canApprove ? (
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        onClick={() => {
                          dispatch(approveTraining({ trainingId: training.id }));
                          toast.success("Training approved.");
                        }}
                      >
                        Approve Training
                      </button>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted small align-self-center">This reviewer can view the thread, but approval actions are not enabled.</span>
                )
              ) : (
                <>
                  {canApprove ? (
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      onClick={() => {
                        dispatch(approveTraining({ trainingId: training.id }));
                        toast.success("Training approved.");
                      }}
                    >
                      Approve Training
                    </button>
                  ) : null}
                  {canResubmit ? (
                    <button
                      type="button"
                      className="btn btn-warning btn-sm text-white"
                      onClick={() => {
                        dispatch(submitTrainingForReview({ trainingId: training.id }));
                        toast.success("Training re-submitted for review.");
                      }}
                    >
                      Re-submit for Review
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className="experience-list">
            {training.slides.map((slide, index) => {
              const unresolvedCount = slide.comments.filter((comment) => !comment.resolved).length;
              const slideFormConfig = ensureFormConfig(slide.formConfig);
              const questionSetsBeforeSlide = reviewQuestionSetsByPlacement.beforeSlide.get(slide.id) ?? [];
              const questionSetsAfterSlide = reviewQuestionSetsByPlacement.afterSlide.get(slide.id) ?? [];

              return (
                <div key={`review-block-${slide.id}`} className="d-grid gap-3">
                  {questionSetsBeforeSlide.map((questionSet, setIndex) =>
                    renderReviewQuestionSetCard(questionSet, setIndex),
                  )}
                  <div key={slide.id} className="card border training-review-card">
                    <div className="card-header bg-transparent d-flex align-items-center justify-content-between gap-3 flex-wrap">
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge" style={{ backgroundColor: `${slide.color}20`, color: slide.color }}>
                          Slide {index + 1}
                        </span>
                        <span className="fw-semibold">{slide.title}</span>
                      </div>
                      {unresolvedCount ? <span className="badge text-bg-danger">{unresolvedCount} unresolved</span> : null}
                    </div>
                    <div className="card-body">
                      <div className="row g-4">
                        <div className="col-12 col-xl-4">
                          <div className="training-preview-card training-review-preview-card" style={{ borderColor: `${slide.color}55` }}>
                            <SlideMediaPreview slide={slide} accentColor={slide.color} showLink hideBadge />
                          </div>
                        </div>

                        <div className="col-12 col-xl-8">
                          <label className="form-label">Voiceover Script</label>
                          {canEdit ? (
                            <textarea
                              className="form-control"
                              rows={5}
                              value={slide.script}
                              onChange={(event) =>
                                dispatch(
                                  updateTrainingSlideScript({
                                    trainingId: training.id,
                                    slideId: slide.id,
                                    script: event.target.value,
                                  }),
                                )
                              }
                            />
                          ) : (
                            <div className="training-readonly-script">{slide.script}</div>
                          )}
                          <ScriptAudioPlayer
                            script={slide.script}
                            provider={training.ttsProvider}
                            voiceName={training.voiceName}
                            voiceId={training.voiceId}
                            modelId={DEFAULT_ELEVENLABS_MODEL_ID}
                            trainingId={training.id}
                            className="mt-3"
                          />
                        </div>
                        <div className="training-slide-settings-toggle training-review-settings-toggle mt-4">
                          <button
                            type="button"
                            className="training-slide-settings-trigger"
                            onClick={() => setExpandedSlideId((current) => (current === slide.id ? null : slide.id))}
                          >
                            <span>Additional Settings</span>
                            <i
                              className={`bi ${expandedSlideId === slide.id ? "bi-chevron-up" : "bi-chevron-down"}`}
                              aria-hidden="true"
                            />
                          </button>

                          {expandedSlideId === slide.id ? (
                            <div className="training-slide-settings mt-3">
                              <div className="row g-4">
                                <div className="col-12 col-xl-4">
                                  <div className="training-setting-group h-100">
                                    <div className="training-slide-manage-icon">
                                      <i className="bi bi-list-task" aria-hidden="true" />
                                    </div>
                                    <div className="training-builder-subcaption">Form</div>
                                    <div className="training-setting-summary-row">
                                      <span>Form Elements</span>
                                      <strong>{slide.formFields.length}</strong>
                                    </div>
                                    <div className="training-setting-summary-row">
                                      <span>Wait for submit</span>
                                      <strong>{slideFormConfig.waitForSubmit ? "Yes" : "No"}</strong>
                                    </div>
                                    <div className="training-setting-summary-row">
                                      <span>Timer</span>
                                      <strong>{slideFormConfig.timer}</strong>
                                    </div>
                                    {slide.formFields.length ? (
                                      <TrainingSlideForm fields={slide.formFields} formConfig={slideFormConfig} mode="readonly" className="mt-3" />
                                    ) : (
                                      <div className="training-slide-hotspot-empty mt-3">No form configured on this slide.</div>
                                    )}
                                  </div>
                                </div>
                                <div className="col-12 col-xl-4">
                                  <div className="training-setting-group h-100">
                                    <div className="training-slide-manage-icon">
                                      <i className="bi bi-link-45deg" aria-hidden="true" />
                                    </div>
                                    <div className="training-builder-subcaption">Interactive Links &amp; Videos</div>
                                    {(slide.interactiveHotspots ?? []).length ? (
                                      <div className="training-review-link-list">
                                        {(slide.interactiveHotspots ?? []).map((hotspot, hotspotIndex, hotspots) => {
                                          const kindCount = hotspots.filter((item) => item.kind === hotspot.kind).length;
                                          const kindIndex =
                                            hotspots
                                              .slice(0, hotspotIndex + 1)
                                              .filter((item) => item.kind === hotspot.kind).length - 1;

                                          return (
                                            <div key={hotspot.id} className="training-review-link-item">
                                              <span className={`badge ${hotspot.kind === "video" ? "text-bg-danger" : "text-bg-primary"}`}>
                                                {hotspot.kind === "video" ? "Video" : "Link"}
                                              </span>
                                              <div className="min-w-0 flex-grow-1">
                                                <div className="fw-semibold text-truncate">{hotspot.label || getHotspotActionText(hotspot, kindIndex, kindCount)}</div>
                                                <div className="small text-body-secondary text-truncate">{hotspot.url || "No URL added"}</div>
                                              </div>
                                              {hotspot.url ? (
                                                <a href={hotspot.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary">
                                                  Open
                                                </a>
                                              ) : null}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="training-slide-hotspot-empty mt-3">No link or video configured on this slide.</div>
                                    )}
                                  </div>
                                </div>
                                <div className="col-12 col-xl-4">
                                  <div className="training-setting-group h-100">
                                    <div className="training-slide-manage-icon">
                                      <i className="bi bi-info-circle" aria-hidden="true" />
                                    </div>
                                    <div className="training-builder-subcaption">Additional Slide Information</div>
                                    {canEdit ? (
                                      <textarea
                                        className="form-control"
                                        rows={5}
                                        value={slide.additionalInfo}
                                        onChange={(event) =>
                                          dispatch(
                                            updateTrainingSlideAdditionalInfo({
                                              trainingId: training.id,
                                              slideId: slide.id,
                                              additionalInfo: event.target.value,
                                            }),
                                          )
                                        }
                                        placeholder="Add reviewer-facing notes or extra avatar context for this slide."
                                      />
                                    ) : (
                                      <div className="training-readonly-script min-sm">
                                        {slide.additionalInfo || "No extra slide information added."}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                  {questionSetsAfterSlide.map((questionSet, setIndex) =>
                    renderReviewQuestionSetCard(questionSet, setIndex),
                  )}
                </div>
              );
            })}
            {reviewQuestionSetsByPlacement.endOfTraining.map((questionSet, setIndex) =>
              renderReviewQuestionSetCard(questionSet, setIndex),
            )}
          </div>
        </>
      ) : null}

      <Modal
        show={assignModalOpen}
        title="Assign Training"
        onClose={() => setAssignModalOpen(false)}
        size="lg"
        centered
      >
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="fw-semibold">Assign this training to active trainees</div>
            <div className="small text-body-secondary">
              Select one or more trainees. They will appear in the session list as assigned learners.
            </div>
          </div>

          <div className="position-relative">
            <i
              className="ri-search-line position-absolute text-body-secondary"
              style={{ left: 14, top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              type="search"
              className="form-control ps-5"
              placeholder="Search trainees by name or email"
              value={assignQuery}
              onChange={(event) => setAssignQuery(event.target.value)}
            />
          </div>

          <div className="border rounded-3 overflow-hidden">
            {loadingTrainees ? (
              <div className="p-4 text-center text-body-secondary small">Loading trainees...</div>
            ) : filteredTrainees.length ? (
              <div className="list-group list-group-flush">
                {filteredTrainees.map((trainee) => {
                  const isSelected = selectedTraineeIds.includes(trainee.id);

                  return (
                    <label
                      key={trainee.id}
                      className="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3"
                    >
                      <input
                        type="checkbox"
                        className="form-check-input mt-0"
                        checked={isSelected}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelectedTraineeIds((current) =>
                            checked ? [...current, trainee.id] : current.filter((item) => item !== trainee.id),
                          );
                        }}
                      />
                      <div className="rounded-circle d-flex align-items-center justify-content-center bg-primary-subtle text-primary flex-shrink-0" style={{ width: 42, height: 42 }}>
                        <i className="ri-user-line" />
                      </div>
                      <div className="min-w-0 flex-grow-1">
                        <div className="fw-semibold text-truncate">{trainee.name}</div>
                        <div className="small text-body-secondary text-truncate">{trainee.email}</div>
                      </div>
                      <span className="badge text-bg-light border text-dark text-capitalize">{trainee.role}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-center text-body-secondary small">No active trainees available.</div>
            )}
          </div>

          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div className="small text-body-secondary">
              {selectedTraineeIds.length
                ? `${selectedTraineeIds.length} trainee${selectedTraineeIds.length === 1 ? "" : "s"} selected`
                : "No trainees selected"}
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-light" onClick={() => setAssignModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAssignTraining()}
                disabled={assigningTraining || loadingTrainees}
              >
                {assigningTraining ? "Assigning..." : "Assign Training"}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        show={reviewRoomOpen}
        title="Training Review Room"
        onClose={() => setReviewRoomOpen(false)}
        size="xl"
        scrollable
      >
        <div className="training-review-room-modal">
          <div className="training-review-room-header">
            <div>
              <div className="fw-semibold">{training.title}</div>
              <div className="small text-body-secondary">
                Common communication room for all reviewers and trainers.
              </div>
            </div>
            <span className="badge text-bg-light border text-dark">
              {unreadReviewRoomCount} unread | {allReviewMessages.length} total
            </span>
          </div>

          <div className="training-review-room-thread">
            {allReviewMessages.length ? (
              allReviewMessages.map((message) => {
                const isOwnMessage = message.authorKey
                  ? message.authorKey === currentReviewAuthorKey
                  : message.author === currentReviewAuthor;

                return (
                  <div
                    key={message.id}
                    className={`training-review-room-message ${message.role === "trainer" ? "role-trainer" : "role-reviewer"} ${isOwnMessage ? "is-own" : "is-other"}`}
                  >
                    <div className="training-review-room-message-meta">
                      <span className={`badge ${message.role === "reviewer" ? "text-bg-primary" : "text-bg-info"}`}>
                        {message.role === "reviewer" ? "Reviewer" : "Trainer"}
                      </span>
                      <span>{message.author}</span>
                      <span>{message.time}</span>
                      {message.slideLabel ? <span className="badge text-bg-light border text-dark">{message.slideLabel}</span> : null}
                    </div>
                    {message.text ? <div className="training-review-room-message-text">{renderReviewMessageText(message.text)}</div> : null}
                    {message.attachments?.length ? (
                      <div className="training-review-room-attachments">
                        {message.attachments.map((attachment) => (
                          <div key={attachment.id}>{renderReviewAttachmentPreview(attachment)}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="training-review-room-empty">
                No review communication yet. Start the discussion with a note, link, image, or video.
              </div>
            )}
          </div>

          {canCommentOnThread ? (
            <div className="training-review-room-composer">
              <div className="training-review-room-composer-row">
                <textarea
                  className="form-control"
                  rows={1}
                  value={reviewMessageDraft}
                  onChange={(event) => setReviewMessageDraft(event.target.value)}
                  placeholder={role === "reviewer" ? "Share your review input..." : "Reply to reviewers or share an update..."}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      postReviewMessage();
                    }
                  }}
                />
                <input
                  ref={reviewAttachmentInputRef}
                  type="file"
                  className="d-none"
                  accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx"
                  multiple
                  onChange={(event) => void addReviewAttachments(event.currentTarget.files)}
                />
                <button
                  type="button"
                  className="btn btn-light training-review-room-icon-btn"
                  onClick={() => reviewAttachmentInputRef.current?.click()}
                  aria-label="Attach media"
                  title="Attach media"
                >
                  <i className="bi bi-paperclip" />
                </button>
                <button
                  type="button"
                  className="btn btn-primary training-review-room-icon-btn"
                  onClick={postReviewMessage}
                  aria-label="Send message"
                  title="Send message"
                >
                  <i className="bi bi-send-fill" />
                </button>
              </div>
              {reviewAttachmentDrafts.length ? (
                <div className="training-review-room-draft-attachments">
                  {reviewAttachmentDrafts.map((attachment) => (
                    <div key={attachment.id} className="training-review-room-draft-chip">
                      {renderReviewAttachmentPreview(attachment, true)}
                      <button
                        type="button"
                        className="btn-close"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() =>
                          setReviewAttachmentDrafts((current) => current.filter((item) => item.id !== attachment.id))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
};

const TrainingWorkspace = ({
  role,
  sessionName,
  sessionEmail,
  sessionImage,
  roleLabel,
  usedCredits = 0,
  totalCredits = 0,
  permission,
  allowed,
  onSignOut,
}: TrainingWorkspaceProps) => {
  const dispatch = useAppDispatch();
  const trainings = useAppSelector((state) => state.trainingWorkspace.trainings);
  const lastSyncedTrainingsRef = useRef("");
  const skipNextDetailReloadRef = useRef(false);
  const [view, setView] = useState<WorkspaceView>("dashboard");
  const [workspaceSessionName, setWorkspaceSessionName] = useState(sessionName);
  const [workspaceSessionImage, setWorkspaceSessionImage] = useState(sessionImage);
  const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("sessions");
  const [builderStartStep, setBuilderStartStep] = useState(1);
  const [builderTrainingId, setBuilderTrainingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TrainingStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<TrainingType | "all">("all");
  const [sortBy, setSortBy] = useState<"recent" | "title" | "audience" | "status">("recent");
  const [workspaceReady, setWorkspaceReady] = useState(!isServerApiEnabled);
  const [checkingTrainingLimit, setCheckingTrainingLimit] = useState(false);
  const canViewWorkspaceDashboard = hasWorkspacePermission(permission, allowed, PermissionKeys.trainingDashboardView);
  const canViewTrainingLibrary = hasWorkspacePermission(permission, allowed, PermissionKeys.trainingLibraryView);
  const canCreateTraining = hasWorkspacePermission(permission, allowed, PermissionKeys.trainingCreate);
  const loadWorkspace = useCallback(async () => {
    const response = await AxiosHelper.getData<TrainingWorkspaceRecord[]>("/training-workspace");

    if (response.data.status) {
      const serialized = JSON.stringify(response.data.data.map(sanitizeTrainingRecordForStorage));
      lastSyncedTrainingsRef.current = serialized;
      dispatch(hydrateTrainingWorkspace(response.data.data));
    }

    setWorkspaceReady(true);
  }, [dispatch]);

  // Fetches the full payload (slides, scripts, sessions, etc.) for a single
  // training and merges it into state — used when opening detail/builder so
  // the list endpoint above can stay lightweight.
  const loadTrainingDetail = useCallback(
    async (trainingId: string) => {
      const response = await AxiosHelper.getData<TrainingWorkspaceRecord>(`/training-workspace/${trainingId}`);
      if (response.data.status && response.data.data) {
        dispatch(saveTraining(response.data.data));
      }
      return response.data.status;
    },
    [dispatch],
  );

  useEffect(() => {
    setWorkspaceSessionName(sessionName);
  }, [sessionName]);

  useEffect(() => {
    setWorkspaceSessionImage(sessionImage);
  }, [sessionImage]);

  useEffect(() => {
    if (!isServerApiEnabled) {
      return;
    }
    void loadWorkspace().catch(() => undefined);
  }, [loadWorkspace]);

  // Refetch the list from the API whenever the user navigates back to the
  // dashboard or training-library view, so navigation always shows fresh
  // server data instead of stale cached/persisted state.
  useEffect(() => {
    if (!isServerApiEnabled) {
      return;
    }
    if (view === "dashboard" || view === "trainings") {
      void loadWorkspace().catch(() => undefined);
    }
  }, [view, loadWorkspace]);

  useEffect(() => {
    if (!isServerApiEnabled || view !== "detail" || !selectedTrainingId) {
      return;
    }

    if (skipNextDetailReloadRef.current) {
      skipNextDetailReloadRef.current = false;
      return;
    }

    void loadTrainingDetail(selectedTrainingId).catch(() => undefined);
  }, [detailTab, loadTrainingDetail, selectedTrainingId, view]);

  const visibleTrainings = useMemo(
    () => trainings.filter((training) => (role === "reviewer" ? training.status !== "draft" : true)),
    [role, trainings],
  );

  useEffect(() => {
    if (!visibleTrainings.length) {
      setSelectedTrainingId(null);
      return;
    }

    if (!selectedTrainingId || !visibleTrainings.some((training) => training.id === selectedTrainingId)) {
      setSelectedTrainingId(visibleTrainings[0]?.id ?? null);
    }
  }, [selectedTrainingId, visibleTrainings]);

  useEffect(() => {
    if (!isServerApiEnabled || !workspaceReady) {
      return;
    }

    const syncPayloadTrainings = trainings.map(sanitizeTrainingRecordForStorage);
    const serialized = JSON.stringify(syncPayloadTrainings);

    if (serialized === lastSyncedTrainingsRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await AxiosHelper.putData<TrainingWorkspaceRecord[], { trainings: TrainingWorkspaceRecord[] }>(
          "/training-workspace/sync",
          { trainings: syncPayloadTrainings },
        );

        if (response.data.status) {
          lastSyncedTrainingsRef.current = serialized;
        } else {
          toast.error(response.data.message || "Training changes were not saved.");
          void loadWorkspace().catch(() => undefined);
        }
      })().catch((error) => {
        toast.error(error instanceof Error ? error.message : "Training changes were not saved.");
        void loadWorkspace().catch(() => undefined);
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [loadWorkspace, trainings, workspaceReady]);

  const selectedTraining = useMemo(
    () => visibleTrainings.find((training) => training.id === selectedTrainingId) ?? visibleTrainings[0] ?? null,
    [selectedTrainingId, visibleTrainings],
  );

  const filteredTrainings = useMemo(() => {
    const filtered = visibleTrainings.filter((training) => {
      const matchesStatus = statusFilter === "all" ? true : training.status === statusFilter;
      const matchesType =
        typeFilter === "all"
          ? true
          : typeFilter === "Other"
            ? !trainingTypeOptions.includes(training.type) || training.type === "Other"
            : training.type === typeFilter;
      const needle = query.trim().toLowerCase();
      const matchesQuery =
        !needle ||
        [training.title, training.type, training.audience, training.trainer].some((value) =>
          value.toLowerCase().includes(needle),
        );

      return matchesStatus && matchesType && matchesQuery;
    });

    return [...filtered].sort((left, right) => {
      if (sortBy === "title") {
        return left.title.localeCompare(right.title);
      }
      if (sortBy === "audience") {
        return left.audience.localeCompare(right.audience);
      }
      if (sortBy === "status") {
        return left.status.localeCompare(right.status) || left.title.localeCompare(right.title);
      }
      return right.lastActivity.localeCompare(left.lastActivity);
    });
  }, [query, sortBy, statusFilter, typeFilter, visibleTrainings]);

  const pendingCount = visibleTrainings.filter((training) => training.status === "review").length;
  const approvedCount = visibleTrainings.filter((training) => training.status === "approved").length;
  const changesCount = visibleTrainings.filter((training) => training.status === "changes_requested").length;
  const activeWorkspaceItem = view === "dashboard" ? "dashboard" : view === "profile" ? "profile" : "trainings";

  const openDetail = (trainingId: string, tab: DetailTab) => {
    setSelectedTrainingId(trainingId);
    setDetailTab(tab);
    setView("detail");
    // Always pull the full, fresh record from the API when opening a training
    // (the list payload is lightweight: no slides/scripts/sessions/options).
    if (isServerApiEnabled) {
      skipNextDetailReloadRef.current = false;
      void loadTrainingDetail(trainingId).catch(() => undefined);
    }
  };

  const openBuilder = async (trainingId: string | null, startStep: number) => {
    if (!trainingId && isServerApiEnabled) {
      setCheckingTrainingLimit(true);
      try {
        const response = await AxiosHelper.getData<TrainingCapacityResponse>("/training-workspace/capacity");
        const capacity = response.data.data;

        if (!response.data.status) {
          toast.error(response.data.message || "Unable to verify training limit.");
          return;
        }

        if (!capacity.canCreateTraining) {
          toast.error(capacity.reason || "Your current plan does not allow another training.");
          return;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to verify training limit.");
        return;
      } finally {
        setCheckingTrainingLimit(false);
      }
    }

    if (trainingId && isServerApiEnabled) {
      try {
        // Must load the FULL training (slides/scripts/questions) before opening
        // the editor — the list payload is lightweight. If this fails we abort
        // rather than open a stub, otherwise a subsequent save would overwrite
        // the stored slides/content with empty values.
        const loaded = await loadTrainingDetail(trainingId);
        if (!loaded) {
          toast.error("Unable to load training details. Please try again.");
          return;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to load training details.");
        return;
      }
    }

    setBuilderTrainingId(trainingId);
    setBuilderStartStep(startStep);
    setView("builder");
  };

  const duplicateTrainingRecord = async (trainingId: string) => {
    if (isServerApiEnabled) {
      setCheckingTrainingLimit(true);
      try {
        const response = await AxiosHelper.getData<TrainingCapacityResponse>("/training-workspace/capacity");
        const capacity = response.data.data;

        if (!response.data.status) {
          toast.error(response.data.message || "Unable to verify training limit.");
          return;
        }

        if (!capacity.canCreateTraining) {
          toast.error(capacity.reason || "Your current plan does not allow another training.");
          return;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to verify training limit.");
        return;
      } finally {
        setCheckingTrainingLimit(false);
      }
    }

    // Fetch the FULL training (slides/scripts/questions) directly rather than
    // reading it back out of `trainings` — that array reflects this closure's
    // render snapshot, which would still be stale immediately after the
    // dispatch below runs.
    let source: TrainingWorkspaceRecord | null = null;

    if (isServerApiEnabled) {
      try {
        const response = await AxiosHelper.getData<TrainingWorkspaceRecord>(`/training-workspace/${trainingId}`);
        if (!response.data.status || !response.data.data) {
          toast.error(response.data.message || "Unable to load training details. Please try again.");
          return;
        }
        source = response.data.data;
        dispatch(saveTraining(source));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to load training details.");
        return;
      }
    } else {
      source = trainings.find((training) => training.id === trainingId) ?? null;
    }

    if (!source) {
      toast.error("Unable to find the training to duplicate.");
      return;
    }

    const clonedId = `T${String(Date.now()).slice(-6)}`;
    const cloned: TrainingWorkspaceRecord = {
      ...source,
      id: clonedId,
      title: `${source.title} (Copy)`,
      status: "draft",
      created: getTodayLabel(),
      submittedOn: null,
      approvedOn: null,
      isPublished: false,
      publishedOn: null,
      lastActivity: "Today",
      sessions: [],
      reviewMessages: [],
      slidesCount: undefined,
      sessionsCount: undefined,
      completedSessionsCount: undefined,
      traineesCount: undefined,
    };

    dispatch(saveTraining(cloned));
    toast.success("Training duplicated with attending sessions reset to zero.");
    // The clone hasn't reached the server yet (sync is debounced), so open the
    // builder directly against the in-memory copy instead of routing through
    // openBuilder(), which would otherwise re-fetch the (not-yet-created) clone
    // from the API and fail.
    setBuilderTrainingId(clonedId);
    setBuilderStartStep(1);
    setView("builder");
  };

  const deleteTrainingRecord = async (trainingId: string) => {
    const targetTraining = trainings.find((training) => training.id === trainingId);

    if (!targetTraining) {
      return;
    }

    const result = await Swal.fire({
      title: `Delete ${targetTraining.title}?`,
      text: "This removes the training and its slide media from the workspace.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const assetIds = Array.from(
      new Set(
        targetTraining.slides
          .flatMap((slide) => [slide.mediaAssetId, slide.removedMedia?.assetId])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const deletionResults = await Promise.allSettled(assetIds.map((assetId) => removeSlideMediaAsset(assetId)));
    dispatch(removeTraining({ trainingId }));

    if (selectedTrainingId === trainingId) {
      setSelectedTrainingId(null);
    }

    if (builderTrainingId === trainingId || view === "detail") {
      setView("trainings");
    }

    const failedAssetDeletes = deletionResults.filter((result) => result.status === "rejected").length;
    toast.success("Training deleted.");

    if (failedAssetDeletes) {
      toast.warn("Training was deleted, but some media assets could not be removed.");
    }
  };

  if (!workspaceReady) {
    return (
      <RoleWorkspaceShell
        role={role}
        sessionName={sessionName}
        sessionEmail={sessionEmail}
        sessionImage={sessionImage}
        roleLabel={roleLabel}
        usedCredits={usedCredits}
        totalCredits={totalCredits}
        permission={permission}
        allowed={allowed}
        activeItem="dashboard"
        onSelectItem={() => undefined}
        onSignOut={onSignOut}
      >
        <div className="card">
          <div className="card-body p-4">Loading training workspace...</div>
        </div>
      </RoleWorkspaceShell>
    );
  }

  return (
    <RoleWorkspaceShell
      role={role}
      sessionName={workspaceSessionName}
      sessionEmail={sessionEmail}
      sessionImage={workspaceSessionImage}
      roleLabel={roleLabel}
      usedCredits={usedCredits}
      totalCredits={totalCredits}
      permission={permission}
      allowed={allowed}
      activeItem={activeWorkspaceItem}
      onSelectItem={(item) => setView(item)}
      onSignOut={onSignOut}
    >
      {view === "dashboard" ? (
        <>
          <WorkspaceBreadcrumb items={[{ label: "Dashboard" }]} />
          {canViewWorkspaceDashboard ? (
            <PageShell
              title="Platform overview"
              description="Monitor training throughput, review cycles, and publishing readiness across learning modules."
            >
              <div className="row g-3 mb-4">
                {[
                  ["Total Trainings", visibleTrainings.length, "bi bi-journal-richtext", "#3e60d5"],
                  ["Awaiting Review", pendingCount, "bi bi-hourglass-split", "#ffbc00"],
                  ["Approved & Live", approvedCount, "bi bi-check2-circle", "#0acf97"],
                  ["Changes Requested", changesCount, "bi bi-arrow-repeat", "#fa5c7c"],
                ].map(([label, value, icon, color]) => (
                  <div key={label} className="col-12 col-md-6 col-xl-3">
                    <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": color as string } as CSSProperties}>
                      <div className="card-body">
                        <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                          <div className="small text-body-secondary">{label}</div>
                          <div className="admin-stat-icon" aria-hidden="true">
                            <i className={icon as string} />
                          </div>
                        </div>
                        <div className="fs-2 fw-semibold">{value}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="row g-3">
                <div className="col-12 col-xl-6">
                  <div className="card h-100">
                    <div className="card-header bg-transparent border-0 pb-0">
                      <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                        <div>
                          <h5 className="mb-1">Awaiting Review</h5>
                          <p className="small text-muted mb-0">This dashboard stays consistent for both trainers and reviewers.</p>
                        </div>
                        <span className="badge text-bg-warning">{pendingCount} pending</span>
                      </div>
                    </div>
                    <div className="card-body">
                      <div className="experience-list">
                        {visibleTrainings
                          .filter((training) => training.status === "review" || training.status === "changes_requested")
                          .map((training) => (
                            <button
                              key={training.id}
                              type="button"
                              className="experience-list-item text-start"
                              onClick={() => openDetail(training.id, "review")}
                            >
                              <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                                <div>
                                  <div className="fw-semibold">{training.title}</div>
                                  <div className="small text-body-secondary">
                                    {training.trainer} | {training.slidesCount ?? training.slides.length} slides | {training.lastActivity}
                                  </div>
                                </div>
                                {renderTrainingStatusBadge(training.status)}
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-12 col-xl-6">
                  <div className="card h-100">
                    <div className="card-header bg-transparent border-0 pb-0">
                      <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                        <div>
                          <h5 className="mb-1">Recently Approved</h5>
                          <p className="small text-muted mb-0">Reviewer approval publishes the training, and the approved status is visible to both roles.</p>
                        </div>
                        <span className="badge text-bg-success">{approvedCount} live</span>
                      </div>
                    </div>
                    <div className="card-body">
                      <div className="experience-list">
                        {visibleTrainings
                          .filter((training) => training.status === "approved")
                          .slice(0, 4)
                          .map((training) => (
                            <button
                              key={training.id}
                              type="button"
                              className="experience-list-item text-start"
                              onClick={() => openDetail(training.id, "sessions")}
                            >
                              <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                                <div>
                                  <div className="fw-semibold">{training.title}</div>
                                  <div className="small text-body-secondary">
                                    Approved {training.approvedOn} | {training.completedSessionsCount ?? normalizeTrainingSessions(training.sessions).filter((session) => session.status === "completed").length} session
                                    {(training.completedSessionsCount ?? normalizeTrainingSessions(training.sessions).filter((session) => session.status === "completed").length) === 1 ? "" : "s"}
                                  </div>
                                </div>
                                <span className="small text-body-secondary">Live</span>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </PageShell>
          ) : (
            <div className="card">
              <div className="card-body p-4">This account does not have permission to open the workspace dashboard.</div>
            </div>
          )}
        </>
      ) : null}

      {view === "trainings" ? (
        <>
          <WorkspaceBreadcrumb items={[{ label: "Dashboard", onClick: () => setView("dashboard") }, { label: "Training" }]} />

          <PageShell
            title="Training management"
            description="View the shared training library, manage slide reviews, and track publication state."
            actions={canCreateTraining ? (
              <button type="button" className="btn btn-primary" disabled={checkingTrainingLimit} onClick={() => void openBuilder(null, 1)}>
                <i className="ri-add-line me-1" />
                {checkingTrainingLimit ? "Checking..." : "Create training"}
              </button>
            ) : (
              <div className="badge text-bg-info px-3 py-2 rounded-pill">
                {pendingCount} training{pendingCount === 1 ? "" : "s"} awaiting review
              </div>
            )}
          >

            {canViewTrainingLibrary ? (
              <>
                <div className="admin-reference-toolbar">
                  <div className="admin-filter-row w-100">
                    <div className="admin-filter-controls">
                      <input
                        className="form-control"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search training, audience, or trainer"
                      />
                      <select
                        className="form-select"
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as any)}
                      >
                        <option value="all">All status</option>
                        {role === "trainer" && <option value="draft">Draft</option>}
                        <option value="review">Awaiting Review</option>
                        <option value="changes_requested">Changes Requested</option>
                        <option value="approved">Approved</option>
                      </select>
                      <select className="form-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TrainingType | "all")}>
                        <option value="all">All types</option>
                        {trainingTypeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <select className="form-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as "recent" | "title" | "audience" | "status")}>
                        <option value="recent">Sort by recent activity</option>
                        <option value="title">Sort by title</option>
                        <option value="audience">Sort by audience</option>
                        <option value="status">Sort by status</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="card admin-reference-table-card">
                  <div className="card-body">
                    <div className="admin-reference-table-wrapper">
                      <table className="table table-bordered table-hover align-middle admin-reference-table mb-0">
                        <thead>
                          <tr>
                            <th>Training</th>
                            <th>Trainer</th>
                            <th>Slides</th>
                            <th>Status</th>
                            <th>Delivery Type</th>
                            <th className="text-end">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTrainings.length ? (
                            filteredTrainings.map((training) => {
                              const editable = canEditTraining(permission, role);
                              const deletable = canDeleteTraining(permission, role);
                              const canReviewRow =
                                permission.includes(PermissionKeys.trainingReview) &&
                                training.status !== "draft" &&
                                training.status !== "approved";

                              return (
                                <tr key={training.id}>
                                  <td>
                                    <div className="fw-semibold">{training.title}</div>
                                    <div className="small text-body-secondary">ID: {training.id}</div>
                                  </td>
                                  <td>{training.trainer}</td>
                                  <td>{training.slidesCount ?? training.slides.length}</td>
                                  <td>
                                    {renderTrainingStatusBadge(training.status)}
                                  </td>
                                  <td>
                                    <span className={`badge ${training.trainingType === "group" ? "text-bg-warning" : "text-bg-secondary"}`}>
                                      {training.trainingType === "group" ? "Group (Hall)" : "One-on-One"}
                                    </span>
                                  </td>
                                  <td className="text-end">
                                    <ActionDropdown label={`Open actions for ${training.title}`}>
                                      {({ close }) => (
                                        <>
                                          <button
                                            type="button"
                                            className="dropdown-item"
                                            onClick={() => {
                                              close();
                                              openDetail(training.id, "sessions");
                                            }}
                                          >
                                            <i className="bi bi-eye" />
                                            <span>View details</span>
                                          </button>
                                          {canReviewRow ? (
                                            <button
                                              type="button"
                                              className="dropdown-item"
                                              onClick={() => {
                                                close();
                                                openDetail(training.id, "review");
                                              }}
                                            >
                                              <i className="bi bi-chat-left-dots" />
                                              <span>Review slides</span>
                                            </button>
                                          ) : null}
                                          {editable && permission.includes(PermissionKeys.trainingComment) && training.status !== "draft" ? (
                                            <button
                                              type="button"
                                              className="dropdown-item"
                                              onClick={() => {
                                                close();
                                                openDetail(training.id, "review");
                                              }}
                                            >
                                              <i className="bi bi-chat-square-text" />
                                              <span>Review thread</span>
                                            </button>
                                          ) : null}
                                          {editable ? (
                                            <button
                                              type="button"
                                              className="dropdown-item"
                                              onClick={() => {
                                                close();
                                                openBuilder(training.id, 1);
                                              }}
                                            >
                                              <i className="bi bi-pencil-square" />
                                              <span>Edit</span>
                                            </button>
                                          ) : null}
                                          {editable ? (
                                            <button
                                              type="button"
                                              className="dropdown-item"
                                              onClick={() => {
                                                close();
                                                void duplicateTrainingRecord(training.id);
                                              }}
                                            >
                                              <i className="bi bi-files" />
                                              <span>Duplicate</span>
                                            </button>
                                          ) : null}
                                          {deletable ? (
                                            <button
                                              type="button"
                                              className="dropdown-item text-danger"
                                              onClick={() => {
                                                close();
                                                void deleteTrainingRecord(training.id);
                                              }}
                                            >
                                              <i className="bi bi-trash" />
                                              <span>Delete</span>
                                            </button>
                                          ) : null}
                                        </>
                                      )}
                                    </ActionDropdown>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={8}>
                                <div className="admin-empty-state">No trainings matched the selected filters.</div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="card">
                <div className="card-body p-4">This account does not have permission to open the training library.</div>
              </div>
            )}
          </PageShell>
        </>
      ) : null}

      {view === "builder" ? (
        <TrainingBuilder
          key={`${builderTrainingId ?? "new"}-${builderStartStep}`}
          currentUserName={sessionName}
          initialTraining={builderTrainingId ? trainings.find((training) => training.id === builderTrainingId) ?? null : null}
          initialStep={builderStartStep}
          onCancel={() => setView("trainings")}
          onGoDashboard={() => setView("dashboard")}
          onPersist={(training) => {
            skipNextDetailReloadRef.current = true;
            dispatch(saveTraining(training));
            setSelectedTrainingId(training.id);
            setDetailTab(training.status === "review" ? "review" : "sessions");
            setView("detail");
          }}
        />
      ) : null}

      {view === "detail" && selectedTraining ? (
        <TrainingDetail
          role={role}
          training={selectedTraining}
          sessionName={sessionName}
          permission={permission}
          detailTab={detailTab}
          onBack={() => setView("trainings")}
          onGoDashboard={() => setView("dashboard")}
          onChangeTab={setDetailTab}
          onEditTraining={() => openBuilder(selectedTraining.id, 1)}
          onDeleteTraining={() => void deleteTrainingRecord(selectedTraining.id)}
        />
      ) : null}
      {view === "profile" ? (
        <>
          <WorkspaceBreadcrumb items={[{ label: "Dashboard", onClick: () => setView("dashboard") }, { label: "Profile" }]} />
          <PageShell title="Profile" description="Update your account details for this client workspace.">
            <WorkspaceProfilePanel
              onProfileChange={(profile) => {
                setWorkspaceSessionName(profile.fullname || profile.name);
                setWorkspaceSessionImage(profile.image || "");
              }}
            />
          </PageShell>
        </>
      ) : null}
    </RoleWorkspaceShell>
  );
};

export default TrainingWorkspace;
