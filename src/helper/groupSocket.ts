import { io, type Socket } from "socket.io-client";
import { clientApiBaseUrl } from "./runtimeApi";

// The Socket.IO server is attached to the backend HTTP root (default path
// /socket.io). The REST base URL includes the API prefix (e.g. ".../api-v1"),
// so we strip the path to reach the origin the socket server listens on.
const resolveSocketOrigin = () => {
  if (!clientApiBaseUrl) {
    // Local dev with no explicit API base: same origin as the page.
    return window.location.origin;
  }
  try {
    return new URL(clientApiBaseUrl).origin;
  } catch (_error) {
    return clientApiBaseUrl.replace(/\/api-v1\/?$/, "");
  }
};

export type GroupSocketAuth = {
  token: string; // group-session token (trainee/host) or admin JWT
  gsId?: string; // required only for admin-observer connections
};

export const connectGroupSocket = (auth: GroupSocketAuth): Socket =>
  io(resolveSocketOrigin(), {
    transports: ["websocket", "polling"],
    auth,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });
