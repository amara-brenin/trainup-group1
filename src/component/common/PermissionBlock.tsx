import type { PropsWithChildren, ReactNode } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useAppSelector } from "../../app/hooks";
import { routePermissions } from "../../constant/routePermissions";

type BlockProps = PropsWithChildren<{
  permissionKey?: string;
  allowedKey?: string;
  fallback?: ReactNode;
}>;

export const PermissionBlock = ({
  permissionKey,
  allowedKey,
  fallback = null,
  children,
}: BlockProps) => {
  const { allowed, permission, authResolved, role } = useAppSelector((state) => state.admin);

  if (!authResolved) {
    return null;
  }

  if (role === "super_admin") {
    return <>{children}</>;
  }

  const hasAccess =
    (!permissionKey || permission.includes(permissionKey)) &&
    (!allowedKey || allowed.includes(allowedKey));

  return hasAccess ? <>{children}</> : <>{fallback}</>;
};

export const CheckPermission = ({ children }: PropsWithChildren) => {
  const location = useLocation();
  const { allowed, permission, authResolved, role } = useAppSelector((state) => state.admin);

  const currentRoute = routePermissions.find((item) =>
    matchPath({ path: item.path, end: true }, location.pathname),
  );

  if (!currentRoute) {
    return <>{children}</>;
  }

  if (!authResolved) {
    return null;
  }

  if (role === "super_admin") {
    return <>{children}</>;
  }

  const hasAccess =
    (!currentRoute.key || permission.includes(currentRoute.key)) &&
    (!currentRoute.allowed || allowed.includes(currentRoute.allowed));

  if (hasAccess) {
    return <>{children}</>;
  }

  return (
    <div className="row">
      <div className="col-12">
        <div className="card">
          <div className="card-body p-5 text-center">
            <div className="admin-403-icon mb-3">
              <i className="bi bi-shield-lock" />
            </div>
            <h1 className="h4 fw-semibold mb-2">Permission required</h1>
            <p className="mb-0 text-body-secondary">
              Your account can access the admin shell, but this section is not enabled for your role.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
