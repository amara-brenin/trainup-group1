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

export const askGroupQuestion = (gsId: string, token: string, message: string) =>
  groupPost<{ reply: string }>(`/group/${gsId}/ask`, { token, message });
