import { io, type Socket } from "socket.io-client";
import { clientApiBaseUrl } from "./runtimeApi";

// Mirrors groupSocket.ts's origin/path resolution so this connection rides the
// same reverse-proxy route ("<apiPrefix>/socket.io") as the rest of realtime.
const resolveSocketOrigin = () => {
  if (!clientApiBaseUrl) {
    return window.location.origin;
  }
  try {
    return new URL(clientApiBaseUrl).origin;
  } catch (_error) {
    return clientApiBaseUrl.replace(/\/api-v1\/?$/, "");
  }
};

const resolveSocketPath = () => {
  let apiPath = "/api-v1";
  if (clientApiBaseUrl) {
    try {
      apiPath = new URL(clientApiBaseUrl).pathname.replace(/\/+$/, "") || "/api-v1";
    } catch (_error) {
      apiPath = "/api-v1";
    }
  }
  return `${apiPath}/socket.io`;
};

// A lightweight, presence-only connection: authenticates with the normal admin
// JWT (no gsId), joins nothing but the server's per-user room, and exists only
// so the backend can push an immediate "auth:force-logout" event the instant a
// super-admin deletes or deactivates this account — instead of waiting for the
// next REST call or a page refresh to notice the account is gone.
export const connectPresenceSocket = (token: string): Socket => {
  const origin = resolveSocketOrigin();
  const path = resolveSocketPath();

  return io(origin, {
    path,
    transports: ["polling", "websocket"],
    upgrade: true,
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });
};
