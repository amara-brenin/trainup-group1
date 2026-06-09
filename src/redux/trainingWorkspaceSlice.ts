import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { trainingWorkspaceSeed } from "../constant/trainingWorkspaceData";
import type {
  AvatarProfile,
  TrainingCommentRole,
  TrainingFormField,
  TrainingReviewAttachment,
  TrainingStatus,
  TrainingWorkspaceRecord,
} from "../constant/interfaces";

type TrainingWorkspaceState = {
  trainings: TrainingWorkspaceRecord[];
  avatarProfiles: AvatarProfile[];
};

const STORAGE_KEY = "trainup-training-workspace";

const getTodayLabel = () =>
  new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const buildAvatarEmbed = (profile: AvatarProfile) => ({
  iframe: `<iframe src="https://embed.amara.ai/avatar/${profile.id}" width="100%" height="720" allow="camera; microphone" frameborder="0"></iframe>`,
  avatarEnvironmentJson: JSON.stringify(
    {
      avatarId: profile.id,
      appearanceType: profile.appearanceType,
      backgroundType: profile.backgroundType,
      backgroundValue: profile.backgroundValue,
      environment3d: profile.environment3d,
    },
    null,
    2,
  ),
  clientJson: JSON.stringify(
    {
      name: profile.name,
      project: profile.project,
      foundationMode: profile.foundationMode,
      model: profile.model,
      ttsProvider: profile.ttsProvider,
      voiceName: profile.voiceName,
    },
    null,
    2,
  ),
});

const encodeSvg = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const buildAvatarPreview = (
  name: string,
  accent: string,
  background: string,
  skin: string,
  hair: string,
  shirt: string,
  shape: "circle" | "rounded" = "circle",
) =>
  encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${background}" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <rect width="320" height="320" rx="${shape === "circle" ? 160 : 34}" fill="url(#bg)" />
      <circle cx="160" cy="108" r="54" fill="${skin}" />
      <path d="M108 92c6-34 30-54 52-54 31 0 57 26 57 61 0 7-1 14-3 20-8-18-27-30-53-30-24 0-41 7-53 22-4-6-5-12-5-19z" fill="${hair}" />
      <path d="M88 280c15-53 50-86 72-86s58 33 72 86" fill="${shirt}" />
      <rect x="112" y="178" width="96" height="22" rx="10" fill="${skin}" opacity="0.92" />
      <circle cx="140" cy="106" r="5" fill="#1f2937" />
      <circle cx="180" cy="106" r="5" fill="#1f2937" />
      <path d="M142 132c10 8 26 8 36 0" fill="none" stroke="#7c2d12" stroke-width="4" stroke-linecap="round" />
      <text x="160" y="302" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="rgba(15,23,42,0.78)">
        ${name}
      </text>
    </svg>
  `);

const buildDummyAvatarProfile = (
  appearanceType: AvatarProfile["appearanceType"],
  index: number,
  name: string,
  accent: string,
  background: string,
  skin: string,
  hair: string,
  shirt: string,
): AvatarProfile => ({
  id: `${appearanceType}-${index + 1}`,
  name,
  project: "Shared Avatar Library",
  avatarPhoto: buildAvatarPreview(
    name.split(" ")[0],
    accent,
    background,
    skin,
    hair,
    shirt,
    appearanceType === "image" ? "circle" : "rounded",
  ),
  appearanceType,
  backgroundType: appearanceType === "video" ? "video" : "image",
  backgroundValue: "Managed by super admin",
  environment3d: "Corporate Studio",
  foundationMode: "Composite",
  avatarEngine:
    appearanceType === "image"
      ? "Image Avatar Engine"
      : appearanceType === "video"
        ? "Video Avatar Engine"
        : "3D Avatar Engine",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "demo_key",
  model: "llama-3.3-70b-versatile",
  prompt: `${name} shared library avatar profile.`,
  memoryEnabled: true,
  maxMemoryTokens: "2048",
  sttProvider: "Trulience STT",
  contextPhrases: [name, "training", "shared avatar"],
  language: "en-IN",
  additionalLanguages: ["en-US"],
  ttsProvider: "ElevenLabs",
  ttsApiKey: "el_demo_key",
  ttsModel: "eleven_flash_v2_5",
  voiceName: name,
  knowledgeBaseItems: [],
  functions: [],
  advanced: {
    general: "Shared avatar library profile.",
    usageLimits: "Reusable across multiple projects.",
    interruptions: "Standard interruption handling.",
    vad: "Balanced sensitivity.",
    launchVisibility: "Visible in admin picker.",
    styling: "Blue brand aligned styling.",
  },
  embed: { iframe: "", avatarEnvironmentJson: "", clientJson: "" },
  lastUpdated: "2026-05-04 07:14:51",
  onlineUsers: index % 3,
});

const defaultAvatarProfiles: AvatarProfile[] = [
  ...[
    ["Sarah (Westpac demo)", "#4f6ee8", "#9fd3ff", "#f3c7a6", "#38261d", "#1d4ed8"],
    ["Amara Retail", "#3050c8", "#d9efff", "#dba07a", "#1f2937", "#0f766e"],
    ["Aiden Coach", "#6f86ff", "#d8e4ff", "#e7c4a8", "#3f2b1d", "#334155"],
    ["Nora Sales", "#3c63d6", "#eef4ff", "#f1d0b5", "#442f2a", "#7c3aed"],
    ["Mira Support", "#6d7ae8", "#dbeafe", "#c98b67", "#2f211b", "#be185d"],
    ["Liam Advisor", "#526ae6", "#e0f2fe", "#f0c9a4", "#2d1b14", "#2563eb"],
    ["Eva Guide", "#4262d6", "#d9f0ff", "#e2bb98", "#111827", "#059669"],
    ["Zara Expert", "#324ebf", "#ebf3ff", "#b97c5a", "#2b2118", "#9333ea"],
  ].map(([name, accent, background, skin, hair, shirt], index) => buildDummyAvatarProfile("image", index, name, accent, background, skin, hair, shirt)),
  ...[
    ["Ava Presenter", "#2948bf", "#dde9ff", "#f2c9a9", "#4a342c", "#1e40af"],
    ["Rehan Host", "#255ad4", "#dbeafe", "#c98562", "#201712", "#0891b2"],
    ["Clara Motion", "#5872ea", "#edf3ff", "#efc7ab", "#33231f", "#7c2d12"],
    ["Mason Speaker", "#365bd1", "#d9ecff", "#dfb594", "#111827", "#334155"],
    ["Ira Narrator", "#7184ef", "#eef4ff", "#f3cfb3", "#3b2d29", "#0f766e"],
    ["Noah Demo", "#2847bb", "#dde7ff", "#bb7b57", "#201a17", "#2563eb"],
    ["Kiara Launch", "#4065e8", "#ebf2ff", "#efc4a2", "#2d1f1a", "#be123c"],
    ["Ryan Studio", "#5878df", "#ddeeff", "#d39a78", "#221914", "#7c3aed"],
  ].map(([name, accent, background, skin, hair, shirt], index) => buildDummyAvatarProfile("video", index, name, accent, background, skin, hair, shirt)),
  ...[
    ["Nova 3D", "#4d6eff", "#edf2ff", "#efc7ab", "#2f241d", "#2563eb"],
    ["Aiden 3D", "#3157dd", "#dce8ff", "#cd8a67", "#201712", "#059669"],
    ["Sia 3D", "#627cf0", "#edf5ff", "#f0ceb5", "#38261d", "#7c3aed"],
    ["Rhea 3D", "#3d62da", "#dfefff", "#dfa987", "#2a1d16", "#be185d"],
    ["Kai 3D", "#5570f2", "#ebf2ff", "#efc8a2", "#111827", "#0f766e"],
    ["Meera 3D", "#3859cb", "#d8eaff", "#b9734e", "#2e2018", "#1d4ed8"],
    ["Juno 3D", "#4968e0", "#edf4ff", "#f2d2ba", "#45312a", "#c2410c"],
    ["Omar 3D", "#5f79eb", "#e3eeff", "#d89d78", "#211812", "#475569"],
  ].map(([name, accent, background, skin, hair, shirt], index) => buildDummyAvatarProfile("upper_body_3d", index, name, accent, background, skin, hair, shirt)),
  ...[
    ["Atlas Full", "#3f5dd8", "#ebf2ff", "#ecbfa0", "#221813", "#334155"],
    ["Mika Full", "#6a7ff0", "#dfe8ff", "#f2d4bc", "#38251f", "#9333ea"],
    ["Rohan Full", "#2f54c9", "#e7f1ff", "#ca8b65", "#1c1510", "#0f766e"],
    ["Sara Full", "#4c6ae4", "#dde9ff", "#efc5a7", "#3a2b25", "#1d4ed8"],
    ["Lena Full", "#375ccd", "#eef4ff", "#e2b28d", "#2b1f19", "#be185d"],
    ["Aria Full", "#6882f1", "#ddeeff", "#f1ccb2", "#131313", "#7c3aed"],
    ["Yash Full", "#4465d4", "#e6efff", "#bb7a56", "#221811", "#2563eb"],
    ["Tara Full", "#5873e0", "#edf3ff", "#f0caaa", "#402d27", "#0891b2"],
  ].map(([name, accent, background, skin, hair, shirt], index) => buildDummyAvatarProfile("full_body_3d", index, name, accent, background, skin, hair, shirt)),
];

const normalizedDefaultAvatarProfiles = defaultAvatarProfiles.map((profile) => ({
  ...profile,
  embed: buildAvatarEmbed(profile),
}));

const loadInitialState = (): TrainingWorkspaceState => {
  if (typeof window === "undefined") {
    return { trainings: trainingWorkspaceSeed, avatarProfiles: normalizedDefaultAvatarProfiles };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { trainings: trainingWorkspaceSeed, avatarProfiles: normalizedDefaultAvatarProfiles };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TrainingWorkspaceState>;
    return {
      trainings: Array.isArray(parsed.trainings) ? parsed.trainings : trainingWorkspaceSeed,
      avatarProfiles: Array.isArray(parsed.avatarProfiles) && parsed.avatarProfiles.length >= 32
        ? parsed.avatarProfiles.map((profile) => ({
          ...profile,
          embed: buildAvatarEmbed(profile),
        }))
        : normalizedDefaultAvatarProfiles,
    };
  } catch {
    return { trainings: trainingWorkspaceSeed, avatarProfiles: normalizedDefaultAvatarProfiles };
  }
};

const initialState: TrainingWorkspaceState = loadInitialState();

const upsertTrainingRecord = (trainings: TrainingWorkspaceRecord[], record: TrainingWorkspaceRecord) => {
  const existingIndex = trainings.findIndex((training) => training.id === record.id);

  if (existingIndex === -1) {
    trainings.unshift(record);
    return;
  }

  trainings[existingIndex] = record;
};

export const sanitizeTrainingRecordForStorage = (training: TrainingWorkspaceRecord): TrainingWorkspaceRecord => ({
  ...training,
  slides: training.slides.map((slide) => ({
    ...slide,
    narrationAudio: slide.narrationAudio
      ? {
        ...slide.narrationAudio,
        src: "",
      }
      : null,
  })),
  localizedVoiceovers: training.localizedVoiceovers
    ? {
      ...training.localizedVoiceovers,
      languages: training.localizedVoiceovers.languages.map((language) => ({
        ...language,
        apiKey: language.apiKey ? "" : language.apiKey,
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
    }
    : null,
});

const trainingWorkspaceSlice = createSlice({
  name: "trainingWorkspace",
  initialState,
  reducers: {
    hydrateTrainingWorkspace: (state, action: PayloadAction<TrainingWorkspaceRecord[]>) => {
      state.trainings = action.payload;
    },
    saveTraining: (state, action: PayloadAction<TrainingWorkspaceRecord>) => {
      upsertTrainingRecord(state.trainings, action.payload);
    },
    saveAvatarProfile: (state, action: PayloadAction<AvatarProfile>) => {
      const record = {
        ...action.payload,
        lastUpdated: new Date().toISOString().replace("T", " ").slice(0, 19),
        embed: buildAvatarEmbed(action.payload),
      };
      const existingIndex = state.avatarProfiles.findIndex((item) => item.id === record.id);

      if (existingIndex === -1) {
        state.avatarProfiles.unshift(record);
        return;
      }

      state.avatarProfiles[existingIndex] = record;
    },
    deleteAvatarProfile: (state, action: PayloadAction<{ avatarId: string }>) => {
      state.avatarProfiles = state.avatarProfiles.filter((item) => item.id !== action.payload.avatarId);
    },
    removeTraining: (state, action: PayloadAction<{ trainingId: string }>) => {
      state.trainings = state.trainings.filter((training) => training.id !== action.payload.trainingId);
    },
    submitTrainingForReview: (state, action: PayloadAction<{ trainingId: string }>) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);

      if (!training) {
        return;
      }

      training.status = "review";
      training.submittedOn = getTodayLabel();
      training.approvedOn = null;
      training.isPublished = false;
      training.publishedOn = null;
      training.lastActivity = "Today";
      training.questionCheckpoints = (training.questionCheckpoints ?? []).map((checkpoint) => ({
        ...checkpoint,
        reviewStatus: "review",
      }));
      training.questionSets = (training.questionSets ?? []).map((questionSet) => ({
        ...questionSet,
        checkpoints: questionSet.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          reviewStatus: "review",
        })),
      }));
    },
    requestTrainingChanges: (state, action: PayloadAction<{ trainingId: string }>) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);

      if (!training) {
        return;
      }

      training.status = "changes_requested";
      training.isPublished = false;
      training.publishedOn = null;
      training.lastActivity = "Today";
      training.questionCheckpoints = (training.questionCheckpoints ?? []).map((checkpoint) => ({
        ...checkpoint,
        reviewStatus: "draft",
      }));
      training.questionSets = (training.questionSets ?? []).map((questionSet) => ({
        ...questionSet,
        checkpoints: questionSet.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          reviewStatus: "draft",
        })),
      }));
    },
    approveTraining: (state, action: PayloadAction<{ trainingId: string }>) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);

      if (!training) {
        return;
      }

      training.status = "approved";
      training.approvedOn = getTodayLabel();
      training.isPublished = true;
      training.publishedOn = getTodayLabel();
      training.lastActivity = "Today";
      training.questionCheckpoints = (training.questionCheckpoints ?? []).map((checkpoint) => ({
        ...checkpoint,
        reviewStatus: "approved",
      }));
      training.questionSets = (training.questionSets ?? []).map((questionSet) => ({
        ...questionSet,
        checkpoints: questionSet.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          reviewStatus: "approved",
        })),
      }));
    },
    addSlideComment: (
      state,
      action: PayloadAction<{
        trainingId: string;
        slideId: string;
        author: string;
        role: TrainingCommentRole;
        text: string;
      }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training) {
        return;
      }

      const slide = training.slides.find((item) => item.id === action.payload.slideId);

      if (!slide) {
        return;
      }

      slide.comments.push({
        id: `comment-${Date.now()}`,
        author: action.payload.author,
        role: action.payload.role,
        time: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        text: action.payload.text,
        resolved: false,
      });
      training.lastActivity = "Today";
    },
    addTrainingReviewMessage: (
      state,
      action: PayloadAction<{
        trainingId: string;
        author: string;
        authorKey: string;
        role: TrainingCommentRole;
        text: string;
        attachments?: TrainingReviewAttachment[];
      }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training) {
        return;
      }

      training.reviewMessages = training.reviewMessages ?? [];
      training.reviewMessages.push({
        id: `review-message-${Date.now()}`,
        author: action.payload.author,
        authorKey: action.payload.authorKey,
        role: action.payload.role,
        time: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        text: action.payload.text,
        attachments: action.payload.attachments ?? [],
        readBy: [action.payload.authorKey],
      });
      training.lastActivity = "Today";
    },
    markTrainingReviewMessagesRead: (
      state,
      action: PayloadAction<{ trainingId: string; viewerKey: string }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training?.reviewMessages?.length) {
        return;
      }

      training.reviewMessages = training.reviewMessages.map((message) => {
        const messageAuthorKey = message.authorKey ?? "";
        const currentReadBy = Array.isArray(message.readBy) ? message.readBy : [];

        if (messageAuthorKey === action.payload.viewerKey || currentReadBy.includes(action.payload.viewerKey)) {
          return message;
        }

        return {
          ...message,
          readBy: [...currentReadBy, action.payload.viewerKey],
        };
      });
    },
    resolveSlideComment: (
      state,
      action: PayloadAction<{ trainingId: string; slideId: string; commentId: string }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training) {
        return;
      }

      const slide = training.slides.find((item) => item.id === action.payload.slideId);
      const comment = slide?.comments.find((item) => item.id === action.payload.commentId);

      if (!comment) {
        return;
      }

      comment.resolved = true;
      training.lastActivity = "Today";
    },
    updateTrainingSlideScript: (
      state,
      action: PayloadAction<{ trainingId: string; slideId: string; script: string }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training) {
        return;
      }

      const slide = training.slides.find((item) => item.id === action.payload.slideId);

      if (!slide) {
        return;
      }

      slide.script = action.payload.script;
      training.lastActivity = "Today";
    },
    updateTrainingSlideAdditionalInfo: (
      state,
      action: PayloadAction<{ trainingId: string; slideId: string; additionalInfo: string }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training) {
        return;
      }

      const slide = training.slides.find((item) => item.id === action.payload.slideId);

      if (!slide) {
        return;
      }

      slide.additionalInfo = action.payload.additionalInfo;
      training.lastActivity = "Today";
    },
    updateTrainingSlideFormFields: (
      state,
      action: PayloadAction<{ trainingId: string; slideId: string; formFields: TrainingFormField[] }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);
      if (!training) {
        return;
      }

      const slide = training.slides.find((item) => item.id === action.payload.slideId);

      if (!slide) {
        return;
      }

      slide.formFields = action.payload.formFields;
      training.lastActivity = "Today";
    },
    markTrainingStatus: (
      state,
      action: PayloadAction<{ trainingId: string; status: TrainingStatus }>,
    ) => {
      const training = state.trainings.find((item) => item.id === action.payload.trainingId);

      if (!training) {
        return;
      }

      training.status = action.payload.status;
      training.lastActivity = "Today";
    },
    resetTrainingWorkspace: () => ({
      trainings: trainingWorkspaceSeed,
      avatarProfiles: normalizedDefaultAvatarProfiles,
    }),
  },
});

export const persistTrainingWorkspaceState = (state: TrainingWorkspaceState) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state,
        trainings: state.trainings.map(sanitizeTrainingRecordForStorage),
      }),
    );
  } catch (error) {
    console.warn("[trainingWorkspace] Unable to persist workspace state to localStorage.", error);
  }
};

export const {
  addTrainingReviewMessage,
  addSlideComment,
  approveTraining,
  deleteAvatarProfile,
  hydrateTrainingWorkspace,
  markTrainingReviewMessagesRead,
  markTrainingStatus,
  removeTraining,
  requestTrainingChanges,
  resetTrainingWorkspace,
  saveAvatarProfile,
  resolveSlideComment,
  saveTraining,
  submitTrainingForReview,
  updateTrainingSlideAdditionalInfo,
  updateTrainingSlideFormFields,
  updateTrainingSlideScript,
} = trainingWorkspaceSlice.actions;

export default trainingWorkspaceSlice.reducer;
