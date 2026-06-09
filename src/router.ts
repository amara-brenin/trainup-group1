import { createBrowserRouter } from "react-router-dom";
import { authRoutes } from "./sub-routes/authRoutes";
import { isSuperAdminApp } from "./helper/appVariant";
import { publicRoutes } from "./sub-routes/publicRoutes";
import { protectedRoutes } from "./sub-routes/protectedRoutes";
import { superAdminProtectedRoutes } from "./sub-routes/superAdminProtectedRoutes";
 
export const router = createBrowserRouter(
  [
    ...(isSuperAdminApp ? [] : publicRoutes),
    ...authRoutes,
    ...(isSuperAdminApp ? superAdminProtectedRoutes : protectedRoutes),
  ],
  {
    basename: import.meta.env.BASE_URL,
  },
);