import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { useAppDispatch } from "../app/hooks";
import AxiosHelper from "../helper/AxiosHelper";
import { clearAuthToken, getAuthToken } from "../helper/authSession";
import { connectPresenceSocket } from "../helper/presenceSocket";
import { loggedOutAdmin } from "../redux/authSlice";

// How often to re-check "/profile" while the app is open. This is the fallback
// path: it fires even if the socket never connects (proxy blocks websockets,
// browser is offline momentarily, etc.), so a deleted/deactivated user is
// never logged in for longer than this interval.
const POLL_INTERVAL_MS = 25_000;

type Options = {
  /** Only run the watcher once the user is actually logged in. */
  enabled: boolean;
};

// Detects "this account no longer exists / is no longer active" as fast as
// possible via two independent signals:
//  1. Socket push: the backend emits "auth:force-logout" the instant a
//     super-admin deletes/deactivates this user (see backend/src/socket/index.js
//     forceLogoutUser + the userController/superAdminController/clientController
//     delete & deactivate paths).
//  2. Polling fallback: every POLL_INTERVAL_MS, re-check GET /profile, which
//     already 401s once authTokenAdmin.js can no longer find/activate the user.
// Either signal immediately clears the token and logs the user out client-side.
export const useForceLogoutWatcher = ({ enabled }: Options) => {
  const dispatch = useAppDispatch();
  const socketRef = useRef<Socket | null>(null);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const performLogout = () => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      dispatch(loggedOutAdmin());
      clearAuthToken();
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
    };

    const token = getAuthToken();
    if (!token) {
      return;
    }

    // --- 1. Socket push ---
    const socket = connectPresenceSocket(token);
    socketRef.current = socket;
    socket.on("auth:force-logout", () => {
      performLogout();
    });

    // --- 2. Polling fallback ---
    const pollId = window.setInterval(() => {
      void (async () => {
        try {
          const response = await AxiosHelper.getData<unknown>("/profile");
          if (!response.data.status) {
            performLogout();
          }
        } catch (_error) {
          // Network hiccups shouldn't log the user out; only an explicit
          // unsuccessful response (401/403 from authTokenAdmin.js) should.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(pollId);
      socket.off("auth:force-logout");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [dispatch, enabled]);
};
