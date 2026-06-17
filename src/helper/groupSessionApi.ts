import axios from "axios";
import type { ApiEnvelope } from "../constant/interfaces";
import { getGroupAuthToken } from "./authSession";
import { getRequestUrl } from "./runtimeApi";

// Thin wrappers over the Group Training Hall endpoints.
//
// These deliberately use the GROUP auth token (launch/SSO token if present, else
// the main app token) rather than AxiosHelper's main-token-only default, so that
// trainees authenticated via the launch/SSO workflow are recognized. Both tokens
// are standard JWTs verified identically by the backend.
type ApiResp<T> = Promise<{ data: ApiEnvelope<T> }>;

const groupConfig = () => {
  const token = getGroupAuthToken();
  return {
    validateStatus: () => true,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
};

const groupGet = <T>(url: string): ApiResp<T> =>
  axios.get<ApiEnvelope<T>>(getRequestUrl(url), groupConfig()) as ApiResp<T>;
const groupPost = <T, P = unknown>(url: string, payload: P): ApiResp<T> =>
  axios.post<ApiEnvelope<T>>(getRequestUrl(url), payload, groupConfig()) as ApiResp<T>;

export type GroupSessionView = {
  id: string;
  trainingId: string;
  trainingTitle: string;
  lifecycle: string;
  phase: string;
  status: string;
  currentSlideId: string;
  currentSlideIndex: number;
  currentTopic: string;
  activeSpeakerId: string;
  queue: Array<{ traineeId: string; name: string; raisedAt: string }>;
  attendeeCount: number;
  capacity: number;
  minParticipants?: number;
  autoEnter?: boolean;
  startTime: string | null;
  endTime: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

export type GroupMetrics = {
  invited: number;
  joined: number;
  connected: number;
  waiting: number;
  present: number;
  completed: number;
};

export const createGroupSession = (trainingId: string, config?: Record<string, unknown>) =>
  groupPost<{ session: GroupSessionView; joinCode: string; qrToken: string }>(
    `/training-workspace/${trainingId}/group-session`,
    { config: config ?? {} },
  );

export const getGroupLiveSnapshot = (gsId: string) =>
  groupGet<{ session: GroupSessionView & { metrics: GroupMetrics; attendees: unknown[]; transcripts: unknown[]; transitions: unknown[] } }>(
    `/group-sessions/${gsId}/live`,
  );

export const controlGroupSession = (gsId: string, action: string, extra?: Record<string, unknown>) =>
  groupPost(`/group-sessions/${gsId}/control`, { action, ...(extra ?? {}) });

export const resolveGroupJoin = (joinToken: string) =>
  groupGet<{ session: GroupSessionView; branding: Record<string, unknown>; joinCode?: string; ended?: boolean }>(
    `/group/${joinToken}/resolve`,
  );

export const joinGroupSession = (gsId: string) =>
  groupPost<{
    token: string;
    session: GroupSessionView;
    training: Record<string, unknown>;
    me: { traineeId: string; name: string };
    // present on failure envelopes (status=false) so the client can pick the
    // correct error screen: not-assigned | expired | at-capacity | blocked | ...
    reason?: string;
  }>(`/group/${gsId}/join`, {});

export const bootstrapGroupHost = (gsId: string) =>
  groupGet<{ token: string; session: GroupSessionView; qrToken: string; joinCode: string; training: Record<string, unknown> }>(
    `/group/${gsId}/host`,
  );

export const askGroupQuestion = (
  gsId: string,
  token: string,
  message: string,
  questionType: "voice" | "text" = "voice",
) => groupPost<{ reply: string }>(`/group/${gsId}/ask`, { token, message, questionType });

// ---- Phase 1: Consolidated report (read-only) ----
export type GroupReportStatus = "live" | "final";
export type GroupReport = {
  reportStatus: GroupReportStatus;
  dataQuality: {
    reportStatus: GroupReportStatus;
    hasQuestionTypes: boolean;
    hasResponseTimes: boolean;
    hasSpeakerDurations: boolean;
    hasAssessmentData: boolean;
    hasProctoringData: boolean;
  };
  sessionSummary: {
    trainingName: string; trainingId: string; sessionId: string; lifecycle: string;
    date: string | null; startTime: string | null; endTime: string | null; durationMin: number;
    invitedCount: number; joinedCount: number; completedCount: number; dropOffCount: number;
    averageAttendancePct: number; averageDurationMin: number; totalQuestions: number;
    totalVoiceQuestions: number; totalTextQuestions: number; textQuestionRatio: number; totalHandRaises: number;
    assessmentSubmittedCount: number; assessmentPassedCount: number;
    assessmentPassRatePct: number; averageAssessmentScore: number | null;
    averageRiskScore: number; totalProctoringEvents: number;
  };
  participants: Array<{
    name: string; email: string; joinTime: string | null; leaveTime: string | null; durationMin: number;
    attendancePct: number; completionStatus: string; questionsAsked: number; handRaises: number;
    questionTypes: string[] | null; lastActivity: string | null;
    assessmentScore: number | null; assessmentPassFail: string | null; assessmentTimeTakenMs: number | null;
    proctoringRiskScore: number; proctoringEventCount: number;
  }>;
  interactions: Array<{
    question: string; questionType: string | null; askedBy: string;
    askedAt: string | null; answeredAt: string | null; responseTimeSec: number | null;
    speakerDurationMs: number | null;
  }>;
  engagement: {
    mostActiveParticipant: string; mostQuestionsAsked: string;
    highestAttendance: { name: string; pct: number } | null;
    lowestAttendance: { name: string; pct: number } | null;
    dropOffRatePct: number; participationRatePct: number;
  };
};

export type TrainingGroupReport = {
  trainingId: string; trainingName: string;
  sessionsCount: number; finalSessionsCount: number;
  invitedCount: number; joinedCount: number; completedCount: number;
  avgAttendancePct: number; avgQuestionsAsked: number;
  assessmentPassRatePct: number; avgAssessmentScore: number | null; averageRiskScore: number;
  sessions: Array<{
    sessionId: string; reportStatus: GroupReportStatus; date: string | null; durationMin: number;
    joinedCount: number; completedCount: number; averageAttendancePct: number; totalQuestions: number;
    averageAssessmentScore: number | null; assessmentPassRatePct: number;
  }>;
};

// Feature 2: end-of-training assessment.
export type GroupAssessmentQuestion = { id: string; prompt: string; questionType: string; options: string[] };
export type GroupAssessmentView = {
  available: boolean; skipAllowed: boolean; passPct: number;
  alreadySubmitted: boolean; result: { score: number | null; passFail: string } | null;
  checkpoints: GroupAssessmentQuestion[];
};

export const getGroupAssessment = (gsId: string, token: string) =>
  groupGet<GroupAssessmentView>(`/group/${gsId}/assessment?token=${encodeURIComponent(token)}`);

export const submitGroupAssessment = (
  gsId: string,
  token: string,
  answers: Record<string, string | string[]>,
  startedAt?: string,
) => groupPost<{ score: number | null; passFail: string; completionStatus: string }>(
  `/group/${gsId}/assessment`,
  { token, answers, startedAt },
);

// Feature 4: batched proctoring events (no video/frames).
export type ProctoringEventType =
  | "CAMERA_DENIED" | "CAMERA_OFF" | "MULTIPLE_FACES" | "NO_FACE" | "TAB_SWITCH" | "WINDOW_BLUR";
export const submitProctoringEvents = (
  gsId: string,
  token: string,
  events: Array<{ type: ProctoringEventType; ts: string }>,
) => groupPost<{ riskScore: number; eventCount: number }>(
  `/group/${gsId}/proctoring`,
  { token, events },
);

export const getGroupReport = (gsId: string) =>
  groupGet<{ report: GroupReport }>(`/group-sessions/${gsId}/report`);

export const getTrainingGroupReport = (trainingId: string) =>
  groupGet<{ report: TrainingGroupReport }>(`/training-workspace/${trainingId}/group-report`);

// Feature 3: training-level analytics dashboard.
export type TrainingAnalyticsTrend = {
  sessionId: string; sessionDate: string | null; reportStatus: GroupReportStatus;
  joinedCount: number; attendancePct: number; questionsAsked: number;
  assessmentPassRate: number; riskScore: number;
};
export type TrainingAnalytics = {
  trainingId: string; trainingName: string;
  totalSessions: number; completedSessions: number; liveSessions: number;
  totalInvited: number; totalJoined: number; totalCompleted: number;
  avgAttendancePct: number; avgSessionDuration: number; avgQuestionsPerSession: number;
  totalQuestions: number; totalVoiceQuestions: number; totalTextQuestions: number; textQuestionRatio: number;
  avgAssessmentScore: number | null; assessmentPassRate: number;
  avgRiskScore: number; totalProctoringEvents: number;
  sessionTrend: TrainingAnalyticsTrend[];
};

export const getTrainingAnalytics = (trainingId: string) =>
  groupGet<{ analytics: TrainingAnalytics }>(`/training/${trainingId}/analytics`);
