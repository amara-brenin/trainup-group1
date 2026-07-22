import type { ReactNode } from "react";

export type SystemUserRole = "super_admin" | "admin" | "trainer" | "reviewer" | "trainee";
export type UserRole = SystemUserRole | (string & {});
export type PermissionSource = "role" | "custom";
export type RoleRecordStatus = "active" | "inactive";
export type TrainingStatus = "draft" | "review" | "changes_requested" | "approved";
export type PlanType = "FREE" | "PRO" | "ENTERPRISE" | "Enterprise" | "Pro" | "Trial" | "Starter";
export type EntityStatus = "active" | "inactive" | "trial";
export type SsoStatus = "connected" | "pending" | "not_configured";
export type DomainStatus = "verified" | "pending" | "not_configured";
export type DeliveryTestStatus = "success" | "failed" | "pending" | "not_tested";
export type PaymentMode = "test" | "live";
export type ApiKeyPermission = "Read Only" | "Read / Write";
export type ClientSettingsSection = "company" | "domain" | "whitelabel" | "integrations" | "smtp" | "clientAdmin" | "billing";
export type TrainingType = "Product" | "Soft Skills" | "Technical" | "Compliance" | "Other" | (string & {});
export type TrainingCommentRole = "trainer" | "reviewer";
export type TrainingSessionStatus = "completed" | "in-progress" | "not-started";
export type LegacyTrainingFieldType = "short_text" | "long_text" | "single_select" | "audio" | "video";
export type TrainingFieldType =
  | LegacyTrainingFieldType
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "phone"
  | "date"
  | "time"
  | "url"
  | "password"
  | "drawing"
  | "fileupload"
  | "recording"
  | "dropdown"
  | "radio"
  | "checkbox"
  | "toggle"
  | "rating"
  | "slider"
  | "matrix"
  | "calculated"
  | "heading"
  | "subtitle"
  | "divider"
  | "spacer"
  | "media"
  | "filedownload"
  | "submit"
  | "reset";
export type TrainingSlideMediaSource = "seed" | "image" | "pdf_page" | "ppt_slide";
export type TrainingTtsMode = "auto" | "manual";
export type TrainingMode = "avatar" | "voice";
export type TrainingAvatarBorderStyle = "None" | "Circle" | "Rounded Square";
export type TrainingAvatarAspectRatio = "Auto (default)" | "16:9" | "4:3" | "1:1";
export type TrainingAvatarPosition = "Bottom Left" | "Bottom Right" | "Top Left" | "Top Right" | "Center";
export type TrainingFormPosition = "Opposite to Avatar (default)" | "Left" | "Right" | "Bottom";
export type TrainingDesktopSizing = "Fit (show full media)" | "Fill" | "Stretch";
export type TrainingMobileSizing = "Fit (show full media)" | "Fill";
export type TrainingQuestionType = "subjective" | "objective" | "multi_select" | "text_area";
export type TrainingQuestionPlacementMode = "before_slide" | "after_slide" | "end_of_training";
export type TrainingQuestionReviewStatus = "draft" | "review" | "approved";
export type TrainingQuestionTriggerType = "placement" | "engagement";
export type TrainingKnowledgeDocumentType = "pdf" | "text" | "markdown";
export type TrainingButtonRadiusPreset = "zero" | "small" | "medium" | "large" | "pill";
export type TrainingButtonFillMode = "solid" | "gradient";
export type TrainingGradientDirection =
  | "to right"
  | "to left"
  | "to bottom"
  | "to top"
  | "135deg";
export type TrainingFontFamilyPreset = "System" | "Poppins" | "Manrope";
export type TrainingFontWeightPreset = "400" | "500" | "600" | "700";
export type TrainingFontSizePreset = "sm" | "md" | "lg";

export interface SmtpEmailTemplateSettings {
  trainingAssignmentSubject: string;
  trainingAssignmentTemplate: string;
}

export interface AdminUser {
  _id: string;
  clientId: string;
  clientName: string;
  currentPlan?: PlanType;
  name: string;
  fullname: string;
  email: string;
  phone: string;
  title: string;
  department: string;
  role: UserRole;
  roleName: string;
  permission: string[];
  allowed: string[];
  image: string;
  usedCredits: number;
  totalCredits: number;
  planExpired?: boolean;
  isUnreadNotifications: boolean;
  impersonation?: {
    active: boolean;
    level: number;
    rootRole: string;
    currentName: string;
    currentRole: string;
    returnToRole: string;
    returnLabel: string;
  } | null;
}

export interface AppSettings {
  application_name: string;
  logo: string;
  dark_logo: string;
  favicon: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  email: string;
  copyright: string;
  phone: string;
  path: string;
}

export interface ClientRecord {
  id: string;
  name: string;
  industry: string;
  plan: PlanType;
  monthlyCredits?: number;
  purchasedCredits?: number;
  usedCredits?: number;
  totalCredits?: number;
  planExpired?: boolean;
  expiresOn?: string | null;
  // Mirror of the client's own Upgrade & Billing view (expiry-aware credits,
  // start/expiry dates, plan usage, purchase history) for the super-admin detail page.
  billing?: BillingSummary;
  billingCycle?: "monthly";
  trainingCreditCost?: number;
  userCreditCost?: number;
  sessionCreditCost?: number;
  creditCostOverrides?: {
    training: number | null;
    session: number | null;
    user: number | null;
  };
  planLimits?: {
    trainings: number | null;
    users: number | null;
    sessions: number | null;
  };
  status: EntityStatus;
  domain: string;
  domainStatus: DomainStatus;
  subdomain: string;
  activeUsers: number;
  trainings: number;
  sessions: number;
  joined: string;
  csm: string;
  logo: string;
  logoColor: string;
  logoBg: string;
  iframeEnabled: boolean;
  ssoType: string;
  ssoStatus: SsoStatus;
  ssoProviderType?: string;
  ssoClientId?: string;
  ssoClientSecret?: string;
  ssoTenantId?: string;
  ssoIssuerUrl?: string;
  ssoEntryPoint?: string;
  ssoAudience?: string;
  ssoRedirectUri?: string;
  ssoButtonLabel?: string;
  ssoAllowedDomains?: string[];
  ssoAutoProvisionUsers?: boolean;
  supportEmail: string;
  companyPhone?: string;
    companyAddress?: string;
    applicationName?: string;
    primaryColor?: string;
    secondaryColor?: string;
    logoUrl?: string;
    darkLogoUrl?: string;
    faviconUrl?: string;
    // Present only on the lightweight /clients list response: server-resolved
    // logoUrl ?? darkLogoUrl, so the list table only ever receives one image.
    thumbnailUrl?: string;
  allowedOrigins: string[];
  webhookUrl: string;
  webhookSigningSecret?: string;
  lastWebhookTestAt?: string;
  lastWebhookTestStatus?: DeliveryTestStatus;
  lastWebhookTestMessage?: string;
  apiScope: string;
  iframeBaseUrl?: string;
  iframeAllowedParentDomains?: string[];
  ltiClientId?: string;
  ltiDeploymentId?: string;
  ltiPlatformKeysetUrl?: string;
  ltiAccessTokenUrl?: string;
  ltiOidcAuthUrl?: string;
  scormEnabled?: boolean;
  xapiEnabled?: boolean;
  xapiLrsEndpoint?: string;
  xapiClientId?: string;
  xapiClientSecret?: string;
  emailDeliveryEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpFromName?: string;
  smtpFromEmail?: string;
  smtpSecure?: boolean;
  smtpTestRecipient?: string;
  lastSmtpTestAt?: string;
  lastSmtpTestStatus?: DeliveryTestStatus;
  lastSmtpTestMessage?: string;
  smtpTrainingAssignmentSubject?: string;
  smtpTrainingAssignmentTemplate?: string;
  domainVerificationToken?: string;
  domainVerificationHost?: string;
  domainLastCheckedAt?: string;
  domainLastCheckedResult?: string;
  domainVerifiedAt?: string;
  paymentProvider?: string;
  paymentMode?: PaymentMode;
  billingCurrency?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  enterpriseMonthlyPrice?: number;
  enterpriseMonthlyCredits?: number;
  enterpriseSupportNotes?: string;
  enterpriseRequests?: Array<{
    id: string;
    requestedAt: string;
    requestedByName: string;
    requestedByEmail: string;
    message: string;
    approxUsers?: number | null;
    approxTrainings?: number | null;
    approxSessions?: number | null;
    approxBudget?: number | null;
    status: string;
    resolvedAt?: string;
    offerPrice?: number | null;
    offerCredits?: number | null;
    offerValidityDays?: number | null;
    rejectReason?: string;
  }>;
  clientAdminUserId?: string;
  firstUserName?: string;
  firstUserEmail?: string;
  clientAdminPermission?: string[];
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleName?: string;
  status: "active" | "inactive";
  trainings: number;
  lastActive: string;
  permission: string[];
  allowed: string[];
  permissionSource?: PermissionSource;
  isPrimaryAdmin?: boolean;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key: string;
  permission: ApiKeyPermission;
  createdAt: string;
  lastUsed: string;
  callsToday: number;
  status: "active" | "revoked";
}

export interface ApiConfiguration {
  baseUrl: string;
  rateLimitPerMinute: number;
  tokenExpiryHours: number;
  corsAllowedOrigins: string[];
  endpoints: Array<{
    method: string;
    path: string;
    description: string;
    badgeClass: string;
  }>;
}

export interface WebhookEventPreference {
  key: string;
  description: string;
  enabled: boolean;
}

export interface WebhookLogRecord {
  id: string;
  timestamp: string;
  event: string;
  ssoId: string;
  status: number;
  latencyMs: number | null;
}

export interface WebhookConfiguration {
  url: string;
  signingSecret: string;
  retryAttempts: number;
  timeoutSeconds: number;
  events: WebhookEventPreference[];
  logs: WebhookLogRecord[];
}

export interface ActionResponse {
  success: boolean;
  status: DeliveryTestStatus;
  message: string;
  checkedAt: string;
  details?: string;
}

export interface IframeConfiguration {
  baseUrl: string;
  defaultWidth: string;
  height: number;
  allowedParentDomains: string[];
  ssoParameterName: string;
  allowFullscreen: boolean;
  autoResize: boolean;
  blockRightClick: boolean;
}

export interface DashboardSummary {
  kpis: Array<{
    label: string;
    value: string;
    icon: string;
    color: string;
    subtle: string;
    hint: string;
  }>;
  apiUsage: Array<{
    endpoint: string;
    calls: number;
    percentage: number;
  }>;
  integrationHealth: Array<{
    name: string;
    uptime: string;
    latency: string;
  }>;
  recentWebhookEvents: WebhookLogRecord[];
  quickActions: Array<{
    title: string;
    description: string;
    icon: string;
    route: string;
    color: string;
    subtle: string;
    permissionKey?: string;
    allowedKey?: string;
  }>;
}

export interface BillingPlanCatalogItem {
  code: "FREE" | "PRO" | "ENTERPRISE";
  monthlyCredits: number;
  monthlyPrice?: number;
  firstMonthPrice?: number;
  trialDays?: number;
  limits: {
    trainings: number | null;
    users: number | null;
    sessions: number | null;
  };
  contactSales?: boolean;
}

export interface BillingSummary {
  currentPlan: PlanType;
  billingCycle: "monthly";
  planStatus?: "active" | "expired";
  planExpired?: boolean;
  startedOn?: string | null;
  expiresOn?: string | null;
  planUsage?: {
    trainings: number;
    users: number;
    sessions: number;
  };
  activeUsers?: number;
  trainings?: number;
  sessions?: number;
  usedCredits: number;
  totalCredits: number;
  availableCredits: number;
  monthlyCredits: number;
  purchasedCredits: number;
  costPerTraining: number;
  costPerUser: number;
  costPerSession: number;
  paymentProvider?: string;
  paymentMode?: PaymentMode;
  billingCurrency?: string;
  razorpayKeyId?: string;
  gatewayReady?: boolean;
  planPrice?: number;
  freeTrialActive?: boolean;
  freeTrialEndsOn?: string | null;
  enterpriseMonthlyPrice?: number;
  enterpriseMonthlyCredits?: number;
  pendingEnterpriseRequests?: number;
  enterpriseRequests?: Array<{
    id: string;
    requestedAt: string;
    status: string;
    message?: string;
    offerPrice?: number | null;
    offerCredits?: number | null;
    offerValidityDays?: number | null;
    rejectReason?: string;
  }>;
  planLimits: {
    trainings: number | null;
    users: number | null;
    sessions: number | null;
  };
  // One entry per currently-active plan purchase/assignment — each has its
  // own credits/limits and its own expiry (see the batch-ledger fix).
  activePlans?: Array<{
    batchId: string;
    planCode: string;
    label: string;
    monthlyCredits: number;
    usedCredits: number;
    purchasedAt: string;
    expiresAt: string;
    trainingLimit: number | null;
    sessionLimit: number | null;
    userLimit: number | null;
  }>;
  planCatalog: BillingPlanCatalogItem[];
  recentTransactions: Array<{
    id?: string;
    type?: string;
    credits?: number;
    amount?: number;
    currency?: string;
    note?: string;
    reason?: string;
    createdAt?: string;
    status?: string;
    invoiceId?: string;
    orderId?: string;
    receipt?: string;
    planCode?: string;
  }>;
}

export interface NotificationRecord {
  id: string;
  title: string;
  message: string;
  category: string;
  severity: "info" | "success" | "warning" | "error" | (string & {});
  link: string;
  createdAt: string;
  readAt: string;
  actorName?: string;
  isRead: boolean;
}

export interface NotificationPayload {
  unreadCount: number;
  notifications: NotificationRecord[];
}

export interface PaginatedResponse<T> {
  count: number;
  totalPages: number;
  record: T[];
  pagination: number[];
}

export interface ApiEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface AuthLoginResponse {
  token: string;
  user: AdminUser;
}

export interface MenuItem {
  label: string;
  link?: string;
  icon?: string;
  permission_key?: string;
  allowed_key?: string;
  children?: MenuItem[];
  separator?: boolean;
  superAdminOnly?: boolean;
}

export interface RoutePermission {
  path: string;
  key?: string;
  allowed?: string;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

export interface TrainingSlideComment {
  id: string;
  author: string;
  role: TrainingCommentRole;
  time: string;
  text: string;
  resolved: boolean;
}

export interface TrainingReviewAttachment {
  id: string;
  kind: "link" | "image" | "video" | "file";
  name: string;
  url: string;
}

export interface TrainingReviewMessage {
  id: string;
  author: string;
  authorKey?: string;
  role: TrainingCommentRole;
  time: string;
  text: string;
  attachments?: TrainingReviewAttachment[];
  readBy?: string[];
}

export type AvatarAppearanceType = "image" | "video" | "upper_body_3d" | "full_body_3d";
export type AvatarBackgroundType = "image" | "video" | "solid" | "transparent";
export type AvatarFoundationMode = "Simple" | "Composite" | "Speech to Speech" | "3rd Party AI";

export interface AvatarFunctionRecord {
  id: string;
  name: string;
  description: string;
}

export interface AvatarProfile {
  id: string;
  name: string;
  project: string;
  avatarPhoto?: string;
  appearanceType: AvatarAppearanceType;
  backgroundType: AvatarBackgroundType;
  backgroundValue: string;
  environment3d: string;
  foundationMode: AvatarFoundationMode;
  avatarEngine: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  memoryEnabled: boolean;
  maxMemoryTokens: string;
  sttProvider: string;
  contextPhrases: string[];
  language: string;
  additionalLanguages: string[];
  ttsProvider: string;
  ttsApiKey: string;
  ttsModel: string;
  voiceName: string;
  knowledgeBaseItems: string[];
  functions: AvatarFunctionRecord[];
  advanced: {
    general: string;
    usageLimits: string;
    interruptions: string;
    vad: string;
    launchVisibility: string;
    styling: string;
  };
  embed: {
    iframe: string;
    avatarEnvironmentJson: string;
    clientJson: string;
  };
  lastUpdated: string;
  onlineUsers: number;
}

export interface TrainingFormField {
  id: string;
  type: TrainingFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
  helpText?: string;
  tableCol?: boolean;
  uniqueVal?: boolean;
  correctAnswer?: boolean;
  cols?: string[];
  min?: number;
  max?: number;
  step?: number;
  maxRating?: number;
  maxLength?: number;
  allowMultiple?: boolean;
  accept?: string;
  assetUrl?: string;
  assetName?: string;
  assetMimeType?: string;
  correctValue?: string | string[] | number | boolean | Record<string, string>;
}

export interface TrainingFormConfig {
  waitForSubmit: boolean;
  requireCorrect: boolean;
  limitSubmissions: boolean;
  submissionLimit: number;
  onCorrectSlide: string;
  onIncorrectSlide: string;
  timer: string;
}

export interface TrainingSlideSettings {
  avatarPosition: TrainingAvatarPosition;
  formPosition: TrainingFormPosition;
  desktopRespectSafeArea: boolean;
  desktopSizing: TrainingDesktopSizing;
  mobileRespectSafeArea: boolean;
  mobileSizing: TrainingMobileSizing;
  waitForAudio: boolean;
  waitForVideo: boolean;
  autoAdvanceDelayMs: number;
  disableAutoAdvance: boolean;
  hidePauseButton: boolean;
  hideAskQuestionButton: boolean;
  hidePreviousButton: boolean;
  hideAutoplayButton: boolean;
  avatarInitiatesConversation: boolean;
}

export type TrainingInteractiveHotspotKind = "link" | "video";

export interface TrainingInteractiveHotspot {
  id: string;
  kind: TrainingInteractiveHotspotKind;
  label: string;
  url: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

export interface TrainingRemovedMedia {
  assetId: string;
  name: string;
  source?: TrainingSlideMediaSource;
  pageNumber?: number | null;
  mimeType?: string | null;
  extractedText?: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
}

export interface TrainingNarrationAudioAsset {
  src: string;
  cacheKey: string;
  provider: string;
  voiceName: string;
  voiceId: string;
  updatedAt: string;
}

export interface TrainingLocalizedButtonLabels {
  next: string;
  previous: string;
  ask: string;
}

export interface TrainingLocalizedSlideVoiceover {
  slideId: string;
  script: string;
  narrationAudio?: TrainingNarrationAudioAsset | null;
  translatedAt?: string | null;
  audioUpdatedAt?: string | null;
  mediaAssetId?: string | null;
  mediaName?: string | null;
  mediaSource?: TrainingSlideMediaSource | null;
  mediaPageNumber?: number | null;
  mediaMimeType?: string | null;
  mediaExtractedText?: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
  mediaUrl?: string;
}

export interface TrainingLocalizedVoiceLanguage {
  code: string;
  locale: string;
  label: string;
  isDefault: boolean;
  provider: string;
  apiKey?: string;
  voiceId: string;
  voiceName: string;
  translatedSlides: TrainingLocalizedSlideVoiceover[];
  buttonLabels?: TrainingLocalizedButtonLabels;
}

export interface TrainingLocalizedVoiceovers {
  defaultLanguageCode: string;
  languages: TrainingLocalizedVoiceLanguage[];
}

export interface TrainingSlideRecord {
  id: string;
  title: string;
  color: string;
  mediaName: string;
  mediaAssetId?: string | null;
  mediaSource?: TrainingSlideMediaSource;
  mediaPageNumber?: number | null;
  mediaMimeType?: string | null;
  mediaExtractedText?: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
  script: string;
  points: string[];
  uploaded: boolean;
  additionalInfo: string;
  narrationAudio?: TrainingNarrationAudioAsset | null;
  formFields: TrainingFormField[];
  formConfig?: TrainingFormConfig;
  settings?: TrainingSlideSettings;
  removedMedia?: TrainingRemovedMedia | null;
  comments: TrainingSlideComment[];
}

export interface TrainingKnowledgeDocument {
  id: string;
  name: string;
  type: TrainingKnowledgeDocumentType;
  text: string;
  uploadedAt: string;
  selectedByDefault: boolean;
}

export type TrainingQuestionDifficulty = "easy" | "medium" | "hard";
export type TrainingQuestionGenerationMode = "ai_planned_v2";

export interface TrainingQuestionGeneratorConfig {
  totalQuestions: number;
  customPrompt: string;
  difficultyLevel: TrainingQuestionDifficulty;
  topicTags: string[];
  selectedSourceIds: string[];
  activeSetId?: string | null;
  lastGeneratedAt?: string | null;
  generationMode?: TrainingQuestionGenerationMode;
  minimumQuestionsPerSet?: number;
  maximumQuestionsPerSet?: number;
  preferredQuestionTypes?: TrainingQuestionType[];
}

export interface TrainingQuestionCheckpoint {
  id: string;
  title: string;
  prompt: string;
  questionType: TrainingQuestionType;
  options: string[];
  expectedAnswer: string;
  keywordMatches: string[];
  placementMode: TrainingQuestionPlacementMode;
  placementSlideId?: string | null;
  triggerType?: TrainingQuestionTriggerType;
  reviewStatus: TrainingQuestionReviewStatus;
  generatedBy: "ai" | "manual";
  manualEdits?: boolean;
  difficultyLevel?: string;
  topicFocus?: string;
  topicTags: string[];
  generationSetId?: string;
  generationSetLabel?: string;
  originSlideId?: string | null;
  originSlideTitle?: string;
  sourceIds: string[];
  sourceLabels: string[];
}

export interface TrainingQuestionSetRecord {
  id: string;
  label: string;
  placementMode: TrainingQuestionPlacementMode;
  slideId?: string | null;
  slideTitle?: string;
  isMandatory?: boolean;
  difficultyLevel: TrainingQuestionDifficulty;
  topicTags: string[];
  sourceIds: string[];
  sourceLabels: string[];
  questionCount: number;
  sourceSlideIds?: string[];
  sourceRangeLabel?: string;
  plannerSummary?: string;
  generatedQuestionTypes?: TrainingQuestionType[];
  generationStrategy?: "ai_planned" | "manual";
  createdAt: string;
  updatedAt: string;
  isActive?: boolean;
  checkpoints: TrainingQuestionCheckpoint[];
}

export interface TrainingSessionRecord {
  id: string;
  ssoId: string;
  learnerName?: string;
  learnerEmail?: string;
  status: TrainingSessionStatus;
  timeSpent: string;
  slidesViewed: number;
  totalSlides: number;
  viewedSlideIds?: string[];
  score: number | null;
  startedAt: string | null;
  completedAt?: string | null;
  correctAnswers?: number;
  totalQuestions?: number;
  progressPercent?: number;
  mode?: "preview" | "public";
  askHistory?: TrainingAskTranscriptRecord[];
  askTranscripts?: TrainingAskTranscriptRecord[];
  attemptNo?: number;
  maxAttempts?: number;
  isRetake?: boolean;
  bestScore?: number | null;
  latestScore?: number | null;
  resetByAdmin?: boolean;
  resetAt?: string | null;
  resetBy?: string | null;
  proctoringReport?: TrainingProctoringReport | null;
}

export interface TrainingAskTranscriptRecord {
  question: string;
  answer: string;
  askedAt?: string | null;
  inputMode?: "typed" | "browser-voice" | "avatar" | string;
  sttProvider?: string | null;
  language?: string | null;
  slideId?: string | null;
}

export interface TraineeSessionRecord extends TrainingSessionRecord {
  trainingId: string;
  trainingTitle: string;
  trainingType: string;
  trainingAudience: string;
}

export interface TraineeSessionReportPayload {
  trainee: UserRecord;
  sessions: TraineeSessionRecord[];
  summary: {
    totalSessions: number;
    completedSessions: number;
    inProgressSessions: number;
    notStartedSessions: number;
    averageScore: number | null;
  };
}

export interface TrainingProctoringEventCounts {
  reading: number;
  talking: number;
  lookingAway: number;
  tabSwitch: number;
  noFace: number;
  multipleFaces: number;
  returnedToInterview: number;
  anotherDevice: number;
}

export interface TrainingProctoringTimelinePoint {
  elapsedLabel: string;
  riskScore: number;
  attentionScore: number;
  eventCode: string;
}

export interface TrainingProctoringEventEntry {
  timestamp: string;
  message: string;
}

export interface TrainingProctoringReport {
  status: "idle" | "connecting" | "monitoring" | "stopped" | "error";
  attentionScore: number;
  riskScore: number;
  attentionLabel: string;
  startedAt?: string | null;
  completedAt?: string | null;
  aiVisionEnabled?: boolean;
  sourceUrl?: string;
  eventCounts: TrainingProctoringEventCounts;
  timeline: TrainingProctoringTimelinePoint[];
  events: TrainingProctoringEventEntry[];
}

export interface TrainingAvatarEngineConfig {
  provider: string;
  framework: string;
  baseUrl: string;
  model: string;
  prompt: string;
  memoryEnabled: boolean;
  sttProvider: string;
  language: string;
  additionalLanguages: string[];
  avatarId: string;
  engineType: string;
}

export interface TrainingSlideshowTheme {
  primaryBg: string;
  primaryBgHover: string;
  primaryBorder: string;
  primaryBorderHover: string;
  primaryText: string;
  primaryTextHover: string;
  secondaryBg: string;
  secondaryBgHover: string;
  secondaryBorder: string;
  secondaryBorderHover: string;
  secondaryText: string;
  secondaryTextHover: string;
  bgColor: string;
  avatarBorderStyle: TrainingAvatarBorderStyle;
  avatarBoxBg: string;
  avatarAspectRatio: TrainingAvatarAspectRatio;
  buttonRadius: TrainingButtonRadiusPreset;
  primaryFillMode: TrainingButtonFillMode;
  primaryGradientFrom: string;
  primaryGradientTo: string;
  primaryGradientDirection: TrainingGradientDirection;
  buttonFontFamily: TrainingFontFamilyPreset;
  buttonFontWeight: TrainingFontWeightPreset;
  buttonFontSize: TrainingFontSizePreset;
}

export interface TrainingBrandingSettings {
  applicationName: string;
  companyName: string;
  supportEmail: string;
  logoUrl: string;
  faviconUrl: string;
  loaderTitle: string;
  loaderCaption: string;
}

export interface TrainingGroupConfig {
  capacity: number;
  startTime?: string | null;
  endTime?: string | null;
  autoStart?: { mode?: string; minParticipants?: number; graceMins?: number };
  attendanceRules?: { minAttendancePct?: number; activeConfirmIntervalMins?: number };
  qaRules?: {
    maxSpeakSecs?: number;
    silenceTimeoutSecs?: number;
    maxQuestionsPerTrainee?: number;
    handRaiseCooldownSecs?: number;
  };
  completionRules?: { minAttendancePct?: number; requireAssessmentPass?: boolean };
  assessment?: { passPct?: number; scoring?: "individual" | "group" | "both" };
}

export interface TrainingWorkspaceRecord {
  id: string;
  title: string;
  type: TrainingType;
  audience: string;
  trainer: string;
  status: TrainingStatus;
  created: string;
  submittedOn: string | null;
  approvedOn: string | null;
  lastActivity: string;
  lastLaunchLink?: {
    launchUrl?: string;
    expiresInMinutes?: number;
    learnerName?: string;
    learnerEmail?: string;
  } | null;
  trainingType?: "one_on_one" | "group";
  groupConfig?: TrainingGroupConfig | null;
  trainingMode?: TrainingMode;
  avatarName: string;
  avatarId: string;
  ttsMode?: TrainingTtsMode;
  ttsProvider: string;
  voiceName: string;
  voiceId: string;
  manualTtsApiKey?: string;
  manualTtsApiKeyVerifiedAt?: string | null;
  presenterNotes: string;
  questionButtonLabel: string;
  scriptPrompt?: string;
  previewSlideId?: string | null;
  previewThumbnailAssetId?: string | null;
  previewThumbnailAssetName?: string | null;
  askSystemPrompt?: string;
  knowledgeDocuments?: TrainingKnowledgeDocument[];
  questionGeneratorConfig?: TrainingQuestionGeneratorConfig;
  questionCheckpoints?: TrainingQuestionCheckpoint[];
  questionSets?: TrainingQuestionSetRecord[];
  localizedVoiceovers?: TrainingLocalizedVoiceovers | null;
  isPublished?: boolean;
  publishedOn?: string | null;
  durationMins: number;
  maxDurationMins: number;
  idleRefreshMins: number | null;
  options: {
    allowSkipAhead: boolean;
    allowMultipleAttempts: boolean;
    maxAttempts?: number;
    showProgressBar: boolean;
    showSubtitles: boolean;
    disablePreviousButton: boolean;
    enableReviewMode: boolean;
    markAnswersInRealTime: boolean;
    showMarksInProgressBar: boolean;
    showFinalScore: boolean;
    proctoringEnabled: boolean;
    allowPublicDemoAccess?: boolean;
    demoToken?: string;
  };
  theme?: TrainingSlideshowTheme;
  branding?: TrainingBrandingSettings;
  avatarEngine?: TrainingAvatarEngineConfig;
  reviewMessages?: TrainingReviewMessage[];
  slides: TrainingSlideRecord[];
  sessions: TrainingSessionRecord[];
  // Present on the lightweight workspace-list response (GET /training-workspace);
  // slides/sessions are empty there and these counts stand in for their lengths.
  slidesCount?: number;
  sessionsCount?: number;
  completedSessionsCount?: number;
  traineesCount?: number;
}

export interface ClientFormValues {
  id?: string;
  name: string;
  industry: string;
  plan: PlanType;
  status: EntityStatus;
  csm: string;
  activeUsers: number;
  trainings: number;
  sessions: number;
  subdomain: string;
  domain: string;
  supportEmail?: string;
  companyPhone?: string;
    companyAddress?: string;
    applicationName?: string;
    primaryColor?: string;
    secondaryColor?: string;
    logoUrl?: string;
    darkLogoUrl?: string;
  faviconUrl?: string;
  webhookUrl?: string;
  webhookSigningSecret?: string;
  apiScope?: string;
  allowedOrigins?: string;
  iframeEnabled?: boolean;
  iframeBaseUrl?: string;
  iframeAllowedParentDomains?: string;
  ssoType?: string;
  ssoProviderType?: string;
  ssoClientId?: string;
  ssoClientSecret?: string;
  ssoTenantId?: string;
  ssoIssuerUrl?: string;
  ssoEntryPoint?: string;
  ssoAudience?: string;
  ssoRedirectUri?: string;
  ssoButtonLabel?: string;
  ssoAllowedDomains?: string;
  ssoAutoProvisionUsers?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpFromName?: string;
  smtpFromEmail?: string;
  smtpSecure?: boolean;
  emailDeliveryEnabled?: boolean;
  smtpTestRecipient?: string;
  paymentProvider?: string;
  paymentMode?: PaymentMode;
  billingCurrency?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  enterpriseMonthlyPrice?: number;
  enterpriseMonthlyCredits?: number;
  firstUserName?: string;
  firstUserEmail?: string;
  clientAdminPermission?: string[];
}

export interface UserFormValues {
  id?: string;
  name: string;
  email: string;
  role: UserRole;
  status: "active" | "inactive";
  password: string;
  phone?: string;
  title?: string;
  department?: string;
  permission: string[];
}

export interface SuperAdminRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "inactive";
  image: string;
  createdAt: string;
}

export interface SuperAdminFormValues {
  id?: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  status: "active" | "inactive";
  image: string;
}

export interface TenantSettingsPayload {
  company: {
    name: string;
    industry: string;
    supportEmail: string;
    companyPhone: string;
    companyAddress: string;
    status: EntityStatus;
    csm: string;
  };
  whitelabel: {
    applicationName: string;
    primaryColor: string;
    secondaryColor: string;
    logoUrl: string;
    darkLogoUrl: string;
    faviconUrl: string;
  };
  integrations: {
    ssoType: string;
    ssoStatus: SsoStatus;
    ssoProviderType: string;
    ssoClientId: string;
    ssoClientSecret: string;
    ssoTenantId: string;
    ssoIssuerUrl: string;
    ssoEntryPoint: string;
    ssoAudience: string;
    ssoRedirectUri: string;
    ssoButtonLabel: string;
    ssoAllowedDomains: string[];
    ssoAutoProvisionUsers: boolean;
    webhookUrl: string;
    webhookSigningSecret: string;
    lastWebhookTestAt: string;
    lastWebhookTestStatus: DeliveryTestStatus;
    lastWebhookTestMessage: string;
    apiScope: string;
    allowedOrigins: string[];
    iframeEnabled: boolean;
    iframeBaseUrl: string;
    iframeAllowedParentDomains: string[];
    domain: string;
    subdomain: string;
    domainStatus: DomainStatus;
    domainVerificationToken: string;
    domainVerificationHost: string;
    domainLastCheckedAt: string;
    domainLastCheckedResult: string;
    domainVerifiedAt: string;
    // LMS Integration (LMS_INTEGRATION_RESEARCH.md)
    ltiClientId: string;
    ltiDeploymentId: string;
    ltiPlatformKeysetUrl: string;
    ltiAccessTokenUrl: string;
    ltiOidcAuthUrl: string;
    scormEnabled: boolean;
    xapiEnabled: boolean;
    xapiLrsEndpoint: string;
    xapiClientId: string;
    xapiClientSecret: string;
  };
  smtp: {
    emailDeliveryEnabled: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
    secure: boolean;
    testRecipient: string;
    lastTestAt: string;
    lastTestStatus: DeliveryTestStatus;
    lastTestMessage: string;
  } & SmtpEmailTemplateSettings;
}

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
}

export interface PermissionModuleDefinition {
  id: string;
  label: string;
  description: string;
  allowedKey: string;
  permissions: PermissionDefinition[];
}

export interface RoleDefinitionRecord {
  id: string;
  name: string;
  roleName: string;
  description: string;
  status: RoleRecordStatus;
  createdAt: string;
  isSystem?: boolean;
  permission: string[];
  allowed: string[];
}

export interface RolePermissionsPayload {
  roles: RoleDefinitionRecord[];
  modules: PermissionModuleDefinition[];
}

export interface ApiKeyFormValues {
  id?: string;
  name: string;
  permission: ApiKeyPermission;
}

export interface PageParamState {
  limit: number;
  pageNo: number;
  query: string;
}

export interface ModalProps {
  show: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  centered?: boolean;
  scrollable?: boolean;
  dialogClassName?: string;
  contentClassName?: string;
  bodyClassName?: string;
  headerActions?: ReactNode;
}
