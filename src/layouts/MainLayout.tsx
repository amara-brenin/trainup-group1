import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import BreadCrumb from "../component/common/BreadCrumb";
import Footer from "../component/common/Footer";
import { Loader } from "../component/common/Loader";
import Navbar from "../component/common/Navbar";
import Sidebar from "../component/common/Sidebar";
import { CheckPermission } from "../component/common/PermissionBlock";
import type { AdminUser } from "../constant/interfaces";
import AxiosHelper from "../helper/AxiosHelper";
import { clearAuthToken, setLastAppRoute } from "../helper/authSession";
import { useForceLogoutWatcher } from "../hooks/useForceLogoutWatcher";
import { AllowedKeys } from "../constant/permissions";
import { getScopedAppPath, isSuperAdminRole, stripSuperAdminPrefix } from "../helper/appShell";
import { getRequiredAppUrlForRole, isAdminApp, isRoleAllowedInCurrentApp } from "../helper/appVariant";
import {
  buildPublicRoleSessionFromAdmin,
  getPublicRoleHomePath,
  setPublicRoleSession,
} from "../helper/publicRoleAuth";
import { loggedOutAdmin, updateAdmin } from "../redux/authSlice";
import { closeSidebar } from "../redux/themeSlice";

const MainLayout = () => {
  const navigation = useNavigation();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const { sidenavSize, menuActive } = useAppSelector((state) => state.theme);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  const updateProfile = useCallback(async () => {
    try {
      const response = await AxiosHelper.getData<AdminUser>("/profile");
      if (response.data.status) {
        const user = response.data.data;
        if (user.role === "trainer" || user.role === "reviewer") {
          const publicRole = user.role === "trainer" ? "trainer" : "reviewer";
          setPublicRoleSession(publicRole, buildPublicRoleSessionFromAdmin(publicRole, user));
        }
        dispatch(updateAdmin(user));
        setIsLoggedIn(true);
        return;
      }
    } catch (error) {
      console.error("MainLayout: Profile check failed", error);
    }

    dispatch(loggedOutAdmin());
    clearAuthToken();
    setIsLoggedIn(false);
  }, [dispatch]);

  useEffect(() => {
    void updateProfile();
  }, [updateProfile]);

  // Immediately sign the user out if a super-admin deletes/deactivates this
  // account while they're still on the page (socket push + polling fallback).
  useForceLogoutWatcher({ enabled: Boolean(admin._id) });

  useEffect(() => {
    if (!admin._id) {
      return;
    }

    const nextRoute = stripSuperAdminPrefix(`${location.pathname}${location.search}${location.hash}`);
    setLastAppRoute(nextRoute);
  }, [admin._id, location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (!admin._id || isRoleAllowedInCurrentApp(admin.role)) {
      return;
    }

    clearAuthToken();
    dispatch(loggedOutAdmin());

    if (isAdminApp && isSuperAdminRole(admin.role) && typeof window !== "undefined") {
      window.location.replace(getRequiredAppUrlForRole(admin.role));
    }
  }, [admin._id, admin.role, dispatch]);

  if (navigation.state !== "idle" || isLoggedIn === null) {
    return <Loader />;
  }

  if (!admin._id) {
    return <Navigate to="/login" replace />;
  }

  if (!isRoleAllowedInCurrentApp(admin.role)) {
    if (isAdminApp && isSuperAdminRole(admin.role)) {
      return null;
    }
    return <Navigate to="/login" replace />;
  }

  const publicRoleOnlyKeys = new Set<string>([AllowedKeys.trainingWorkspace, AllowedKeys.profile]);
  const trainerOrReviewerHasAdminShellAccess = admin.allowed.some((allowedKey) => !publicRoleOnlyKeys.has(allowedKey));

  if ((admin.role === "trainer" || admin.role === "reviewer") && !trainerOrReviewerHasAdminShellAccess) {
    return <Navigate to={getPublicRoleHomePath(admin.role as "trainer" | "reviewer")} replace />;
  }

  if (isSuperAdminRole(admin.role)) {
    return <Navigate to={getScopedAppPath(location.pathname, admin.role)} replace />;
  }

  return (
    <CheckPermission>
      <>
        <div className="wrapper">
          <Navbar />
          <Sidebar />
          <div className="content-page">
            <div className="content">
              <div className="container-fluid pt-4 pt-md-2">
                <BreadCrumb />
                <Outlet />
              </div>
            </div>
            <Footer />
          </div>
        </div>
        {sidenavSize === "full" && menuActive ? (
          <div className="offcanvas-backdrop fade show" onClick={() => dispatch(closeSidebar())} />
        ) : null}
      </>
    </CheckPermission>
  );
};

export default MainLayout;
