import type { RouteObject } from "react-router-dom";
import { safeImport } from "../helper/safeImport";

export const authRoutes: RouteObject[] = [
  {
    path: "/",
    lazy: async () => {
      const module = await safeImport(() => import("../layouts/AuthLayout"));
      return { Component: module.default };
    },
    children: [
      {
        path: "login",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/Auth/Login"));
          return { Component: module.default };
        },
      },
      {
        path: "forgot-password",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/Auth/PasswordAccess"));
          const PasswordAccess = module.default;
          return { Component: () => <PasswordAccess mode="forgot" /> };
        },
      },
      {
        path: "set-password",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/Auth/PasswordAccess"));
          const PasswordAccess = module.default;
          return { Component: () => <PasswordAccess mode="set" /> };
        },
      },
      {
        path: "reset-password",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/Auth/PasswordAccess"));
          const PasswordAccess = module.default;
          return { Component: () => <PasswordAccess mode="reset" /> };
        },
      },
    ],
  },
];
