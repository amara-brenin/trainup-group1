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
import { getAdminHomePath, isSuperAdminRole, stripSuperAdminPrefix } from "../helper/appShell";
import { getRequiredAppUrlForRole, isRoleAllowedInCurrentApp } from "../helper/appVariant";
import { loggedOutAdmin, updateAdmin } from "../redux/authSlice";
import { closeSidebar } from "../redux/themeSlice";

const SuperAdminLayout = () => {
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
        dispatch(updateAdmin(response.data.data));
        setIsLoggedIn(true);
        return;
      }
    } catch (error) {
      console.error("SuperAdminLayout: Profile check failed", error);
    }

    dispatch(loggedOutAdmin());
    clearAuthToken();
    setIsLoggedIn(false);
  }, [dispatch]);

  useEffect(() => {
    void updateProfile();
  }, [updateProfile]);

  useEffect(() => {
    if (!admin._id || !isSuperAdminRole(admin.role)) {
      return;
    }

    const nextRoute = stripSuperAdminPrefix(`${location.pathname}${location.search}${location.hash}`);
    setLastAppRoute(nextRoute);
  }, [admin._id, admin.role, location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (!admin._id || isRoleAllowedInCurrentApp(admin.role)) {
      return;
    }

    clearAuthToken();
    dispatch(loggedOutAdmin());

    if (typeof window !== "undefined") {
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
    return null;
  }

  if (!isSuperAdminRole(admin.role)) {
    return <Navigate to={getAdminHomePath(admin.allowed, admin.role)} replace />;
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

export default SuperAdminLayout;
