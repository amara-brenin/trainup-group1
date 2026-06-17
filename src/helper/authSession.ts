import { isSuperAdminApp } from "./appVariant";

const AUTH_TOKEN_KEY = isSuperAdminApp ? "trainup-superadmin-auth-token" : "trainup-admin-auth-token";
const LAUNCH_AUTH_TOKEN_KEY = "trainup-launch-auth-token";
const LAST_APP_ROUTE_KEY = "trainup-last-app-route";
const LAUNCH_SESSION_KEY_PREFIX = "trainup-launch-session:";

export type PersistedLaunchQuestionHistoryItem = {
  question: string;
  answer: string;
  askedAt?: string | null;
};

export type PersistedLaunchSessionSnapshot = {
  trainingId: string;
  sessionId: string;
  sessionStartedAt: number | null;
  currentSlideIndex: number;
  viewedSlideIds: string[];
  hasStarted: boolean;
  questionHistory: PersistedLaunchQuestionHistoryItem[];
};

export const getAuthToken = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
};

export const setAuthToken = (token: string) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
};

export const clearAuthToken = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
};

const normalizeRouteValue = (route: string) => {
  const normalized = String(route || "").trim();

  if (!normalized || normalized === "/" || normalized.startsWith("/login")) {
    return "";
  }

  return normalized;
};

export const getLastAppRoute = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return normalizeRouteValue(window.sessionStorage.getItem(LAST_APP_ROUTE_KEY) ?? "");
};

export const setLastAppRoute = (route: string) => {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeRouteValue(route);

  if (!normalized) {
    window.sessionStorage.removeItem(LAST_APP_ROUTE_KEY);
    return;
  }

  window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, normalized);
};

export const getLaunchAuthToken = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.sessionStorage.getItem(LAUNCH_AUTH_TOKEN_KEY) ?? "";
};

export const setLaunchAuthToken = (token: string) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.sessionStorage.removeItem(LAUNCH_AUTH_TOKEN_KEY);
    return;
  }

  window.sessionStorage.setItem(LAUNCH_AUTH_TOKEN_KEY, token);
};

export const clearLaunchAuthToken = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(LAUNCH_AUTH_TOKEN_KEY);
};

// Token to use for Group Training Hall calls. Trainees may be authenticated via
// the launch/SSO workflow (launch token in sessionStorage) or the main app
// login (admin token in localStorage). Prefer the launch token so SSO/launch
// trainees are recognized; fall back to the main token (admins/hosts). Both are
// standard JWTs issued by /auth/login and verified identically server-side.
export const getGroupAuthToken = () => getLaunchAuthToken() || getAuthToken();

const DEMO_SESSION_KEY = "trainup-demo-session";

export type DemoSessionInfo = {
  demoToken: string;
  trainingId: string;
  guestName: string;
  guestEmail: string;
};

export const getDemoSession = (): DemoSessionInfo | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DEMO_SESSION_KEY);
    return raw ? (JSON.parse(raw) as DemoSessionInfo) : null;
  } catch {
    return null;
  }
};

export const setDemoSession = (info: DemoSessionInfo) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(info));
};

export const clearDemoSession = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(DEMO_SESSION_KEY);
};

const getLaunchSessionKey = (trainingId: string) =>
  `${LAUNCH_SESSION_KEY_PREFIX}${String(trainingId || "").trim()}`;

export const getLaunchSessionSnapshot = (
  trainingId: string,
): PersistedLaunchSessionSnapshot | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const normalizedTrainingId = String(trainingId || "").trim();

  if (!normalizedTrainingId) {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(
    getLaunchSessionKey(normalizedTrainingId),
  );

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistedLaunchSessionSnapshot;

    if (
      !parsed ||
      String(parsed.trainingId || "").trim() !== normalizedTrainingId ||
      !String(parsed.sessionId || "").trim()
    ) {
      return null;
    }

    return {
      trainingId: normalizedTrainingId,
      sessionId: String(parsed.sessionId || "").trim(),
      sessionStartedAt:
        typeof parsed.sessionStartedAt === "number"
          ? parsed.sessionStartedAt
          : null,
      currentSlideIndex: Math.max(0, Number(parsed.currentSlideIndex || 0)),
      viewedSlideIds: Array.isArray(parsed.viewedSlideIds)
        ? parsed.viewedSlideIds
          .map((item) => String(item || "").trim())
          .filter(Boolean)
        : [],
      hasStarted: Boolean(parsed.hasStarted),
      questionHistory: Array.isArray(parsed.questionHistory)
        ? parsed.questionHistory.map((item) => ({
          question: String(item?.question || "").trim(),
          answer: String(item?.answer || "").trim(),
          askedAt: item?.askedAt ?? null,
        }))
        : [],
    };
  } catch (_error) {
    window.sessionStorage.removeItem(getLaunchSessionKey(normalizedTrainingId));
    return null;
  }
};

export const setLaunchSessionSnapshot = (
  trainingId: string,
  snapshot: PersistedLaunchSessionSnapshot,
) => {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedTrainingId = String(trainingId || "").trim();

  if (!normalizedTrainingId) {
    return;
  }

  window.sessionStorage.setItem(
    getLaunchSessionKey(normalizedTrainingId),
    JSON.stringify({
      ...snapshot,
      trainingId: normalizedTrainingId,
      sessionId: String(snapshot.sessionId || "").trim(),
      currentSlideIndex: Math.max(0, Number(snapshot.currentSlideIndex || 0)),
      viewedSlideIds: Array.isArray(snapshot.viewedSlideIds)
        ? snapshot.viewedSlideIds
        : [],
      hasStarted: Boolean(snapshot.hasStarted),
      questionHistory: Array.isArray(snapshot.questionHistory)
        ? snapshot.questionHistory
        : [],
    }),
  );
};

export const clearLaunchSessionSnapshot = (trainingId: string) => {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedTrainingId = String(trainingId || "").trim();

  if (!normalizedTrainingId) {
    return;
  }

  window.sessionStorage.removeItem(getLaunchSessionKey(normalizedTrainingId));
};
