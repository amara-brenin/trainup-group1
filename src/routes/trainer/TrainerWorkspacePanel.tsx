import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch } from "../../app/hooks";
import TrainingWorkspace from "../../component/training-workspace/TrainingWorkspace";
import type { AdminUser } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";
import { clearAuthToken } from "../../helper/authSession";
import {
  buildPublicRoleSessionFromAdmin,
  clearPublicRoleSession,
  getPublicRoleSession,
  setPublicRoleLastPath,
  setPublicRoleSession,
} from "../../helper/publicRoleAuth";
import { useForceLogoutWatcher } from "../../hooks/useForceLogoutWatcher";
import { loggedOutAdmin, updateAdmin } from "../../redux/authSlice";

const TrainerWorkspacePanel = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(() => getPublicRoleSession("trainer"));
  const isSignedOut = useRef(false);

  const signOut = useCallback(() => {
    if (isSignedOut.current) return;
    isSignedOut.current = true;
    clearPublicRoleSession("trainer");
    clearAuthToken();
    dispatch(loggedOutAdmin());
    setSession(null);
    navigate("/login", { replace: true });
  }, [dispatch, navigate]);

  const refreshSession = useCallback(async () => {
    if (isSignedOut.current) return;

    try {
      const response = await AxiosHelper.getData<AdminUser>("/profile");

      if (isSignedOut.current) return;

      if (!response.data.status || response.data.data.role !== "trainer") {
        // The account no longer exists, was deactivated, or was reassigned to a
        // different role — either way this session is no longer valid, so sign
        // out instead of silently leaving the stale cached session in place
        // (which previously just kept re-firing 401s forever).
        signOut();
        return;
      }

      const nextSession = buildPublicRoleSessionFromAdmin("trainer", response.data.data, getPublicRoleSession("trainer"));
      setPublicRoleSession("trainer", nextSession);
      setSession(nextSession);
      dispatch(updateAdmin(response.data.data));
    } catch {
      // Network hiccup — not a definitive "unauthorized", so don't sign out.
    }
  }, [dispatch, signOut]);

  // Immediate kick if a super-admin or client admin deletes/deactivates this
  // trainer while they're on this page (socket push + polling fallback).
  useForceLogoutWatcher({ enabled: Boolean(session) });

  useEffect(() => {
    setPublicRoleLastPath("trainer", `${location.pathname}${location.search}${location.hash}`);
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    void refreshSession();

    const handleFocus = () => {
      void refreshSession();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshSession]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <TrainingWorkspace
      role="trainer"
      sessionName={session.name}
      sessionEmail={session.email}
      sessionImage={session.image}
      roleLabel={session.roleLabel}
      usedCredits={Number(session.usedCredits ?? 0)}
      totalCredits={Number(session.totalCredits ?? 0)}
      permission={session.permission ?? []}
      allowed={session.allowed ?? []}
      onSignOut={signOut}
    />
  );
};

export default TrainerWorkspacePanel;
