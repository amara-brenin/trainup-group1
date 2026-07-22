import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import Footer from "../component/common/Footer";
import { Loader } from "../component/common/Loader";
import type { AdminUser } from "../constant/interfaces";
import AxiosHelper from "../helper/AxiosHelper";
import { getAdminHomePath } from "../helper/adminHome";
import { getLastAppRoute } from "../helper/authSession";
import {
  buildPublicRoleSessionFromAdmin,
  getPublicRoleRedirectPath,
  setPublicRoleSession,
} from "../helper/publicRoleAuth";
import { updateAdmin } from "../redux/authSlice";

const AuthLayout = () => {
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const [checking, setChecking] = useState(true);

  const checkProfile = useCallback(async () => {
    try {
      const response = await AxiosHelper.getData<AdminUser>("/profile");
      if (response.data.status) {
        const user = response.data.data;
        if (user.role === "trainer" || user.role === "reviewer" || user.role === "trainee") {
          const publicRole = user.role as "trainer" | "reviewer" | "trainee";
          setPublicRoleSession(publicRole, buildPublicRoleSessionFromAdmin(publicRole, user));
        }
        dispatch(updateAdmin(user));
      }
    } catch (error) {
      console.error("Auth check failed", error);
    } finally {
      setChecking(false);
    }
  }, [dispatch]);

  useEffect(() => {
    void checkProfile();
  }, [checkProfile]);

  if (checking) {
    return <Loader />;
  }

  if (admin._id) {
    if (admin.role === "trainer" || admin.role === "reviewer" || admin.role === "trainee") {
      return <Navigate to={getPublicRoleRedirectPath(admin.role as "trainer" | "reviewer" | "trainee")} replace />;
    }
    return <Navigate to={getLastAppRoute() || getAdminHomePath(admin.allowed)} replace />;
  }

  return (
    <>
      <div className="account-pages pt-2 pt-sm-5 pb-4 pb-sm-5 position-relative">
        <div className="container">
          <Outlet />
        </div>
      </div>
      <Footer />
    </>
  );
};

export default AuthLayout;
