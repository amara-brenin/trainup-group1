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
import { loggedOutAdmin, updateAdmin } from "../../redux/authSlice";

const ReviewerWorkspacePanel = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(() => getPublicRoleSession("reviewer"));
  const isSignedOut = useRef(false);

  const refreshSession = useCallback(async () => {
    if (isSignedOut.current) return;

    try {
      const response = await AxiosHelper.getData<AdminUser>("/profile");

      if (isSignedOut.current) return;

      if (!response.data.status || response.data.data.role !== "reviewer") {
        return;
      }

      const nextSession = buildPublicRoleSessionFromAdmin("reviewer", response.data.data, getPublicRoleSession("reviewer"));
      setPublicRoleSession("reviewer", nextSession);
      setSession(nextSession);
      dispatch(updateAdmin(response.data.data));
    } catch {
      // Silently ignore — likely a 401 after logout
    }
  }, [dispatch]);

  useEffect(() => {
    setPublicRoleLastPath("reviewer", `${location.pathname}${location.search}${location.hash}`);
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
      role="reviewer"
      sessionName={session.name}
      sessionEmail={session.email}
      sessionImage={session.image}
      roleLabel={session.roleLabel}
      usedCredits={Number(session.usedCredits ?? 0)}
      totalCredits={Number(session.totalCredits ?? 0)}
      permission={session.permission ?? []}
      allowed={session.allowed ?? []}
      onSignOut={() => {
        isSignedOut.current = true;
        clearPublicRoleSession("reviewer");
        clearAuthToken();
        dispatch(loggedOutAdmin());
        navigate("/login", { replace: true });
      }}
    />
  );
};

export default ReviewerWorkspacePanel;
