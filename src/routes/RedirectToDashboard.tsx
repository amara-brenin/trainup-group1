import { Navigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import { getAdminHomePath } from "../helper/adminHome";
import { getLastAppRoute } from "../helper/authSession";
import { getScopedAppPath } from "../helper/appShell";
import { getPublicRoleRedirectPath } from "../helper/publicRoleAuth";

const RedirectToDashboard = () => {
  const admin = useAppSelector((state) => state.admin);

  if (admin.role === "trainer" || admin.role === "reviewer") {
    return <Navigate to={getPublicRoleRedirectPath(admin.role as "trainer" | "reviewer")} replace />;
  }

  return <Navigate to={getScopedAppPath(getLastAppRoute() || getAdminHomePath(admin.allowed, admin.role), admin.role)} replace />;
};

export default RedirectToDashboard;
