import { io, type Socket } from "socket.io-client";
import { clientApiBaseUrl } from "./runtimeApi";

// The REST base URL includes the API prefix (e.g. ".../api-v1"). We connect the
// socket to that origin AND mount it under the SAME API path
// ("<apiPrefix>/socket.io") so it rides the existing reverse-proxy route. The
// default "/socket.io" path is often NOT proxied under a subpath deployment,
// which silently breaks all realtime events (attendance, queue, slide sync).
const resolveSocketOrigin = () => {
  if (!clientApiBaseUrl) {
    return window.location.origin; // local dev / same-origin
  }
  try {
    return new URL(clientApiBaseUrl).origin;
  } catch (_error) {
    return clientApiBaseUrl.replace(/\/api-v1\/?$/, "");
  }
};

// "/api-v1/socket.io" — derived from the configured API base path.
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

export type GroupSocketAuth = {
  token: string; // group-session token (trainee/host) or admin JWT
  gsId?: string; // required only for admin-observer connections
};

export const connectGroupSocket = (auth: GroupSocketAuth, label = "client"): Socket => {
  const origin = resolveSocketOrigin();
  const path = resolveSocketPath();
  const socket = io(origin, {
    path,
    transports: ["websocket", "polling"],
    auth,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  /* eslint-disable no-console */
  // --- Live connection diagnostics (proof, not assumptions) ---
  socket.on("connect", () => {
    console.info(`[group-socket:${label}] CONNECTED`, {
      socketId: socket.id,
      connected: socket.connected,
      transport: socket.io.engine?.transport?.name,
      namespace: (socket as unknown as { nsp?: string }).nsp ?? "/",
      origin,
      path,
    });
  });
  socket.io.engine?.on?.("upgrade", (t: { name: string }) =>
    console.info(`[group-socket:${label}] transport upgraded →`, t?.name),
  );
  socket.on("disconnect", (reason) => console.warn(`[group-socket:${label}] DISCONNECT`, reason));
  // EXACT failure reason for a persistent "Reconnecting…".
  socket.on("connect_error", (err) => {
    console.error(`[group-socket:${label}] connect_error:`, err?.message, "| origin:", origin, "| path:", path);
  });
  // Every inbound event + payload (so you can verify session:state/queue/etc.).
  socket.onAny((event, ...args) => console.debug(`[group-socket:${label}] ◀ recv`, event, args[0]));
  // Wrap emit to log outbound events too.
  const rawEmit = socket.emit.bind(socket);
  socket.emit = ((event: string, ...args: unknown[]) => {
    if (event !== "newListener") console.debug(`[group-socket:${label}] ▶ send`, event, args[0]);
    return rawEmit(event, ...args);
  }) as typeof socket.emit;
  /* eslint-enable no-console */

  return socket;
};
