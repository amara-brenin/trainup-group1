import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch } from "../../app/hooks";
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
import TraineePanel from "./TraineePanel";

const TraineeWorkspacePanel = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(() => getPublicRoleSession("trainee"));
  const isSignedOut = useRef(false);

  const signOut = useCallback(() => {
    if (isSignedOut.current) return;
    isSignedOut.current = true;
    clearPublicRoleSession("trainee");
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

      if (!response.data.status || response.data.data.role !== "trainee") {
        signOut();
        return;
      }

      const nextSession = buildPublicRoleSessionFromAdmin("trainee", response.data.data, getPublicRoleSession("trainee"));
      setPublicRoleSession("trainee", nextSession);
      setSession(nextSession);
      dispatch(updateAdmin(response.data.data));
    } catch {
      // Network hiccup — not a definitive "unauthorized", so don't sign out.
    }
  }, [dispatch, signOut]);

  useForceLogoutWatcher({ enabled: Boolean(session) });

  useEffect(() => {
    setPublicRoleLastPath("trainee", `${location.pathname}${location.search}${location.hash}`);
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
    <TraineePanel
      sessionName={session.name}
      sessionImage={session.image}
      onSignOut={signOut}
    />
  );
};

export default TraineeWorkspacePanel;
