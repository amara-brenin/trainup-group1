import type { RouteObject } from "react-router-dom";
import { safeImport } from "../helper/safeImport";

export const superAdminProtectedRoutes: RouteObject[] = [
  {
    path: "/",
    lazy: async () => {
      const module = await safeImport(() => import("../layouts/SuperAdminLayout"));
      return { Component: module.default };
    },
    children: [
      {
        index: true,
        lazy: async () => {
          const module = await safeImport(() => import("../routes/RedirectToDashboard"));
          return { Component: module.default };
        },
      },
      {
        path: "dashboard",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/Dashboard"));
          return { Component: module.default };
        },
      },
      {
        path: "clients",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/clients/Clients"));
          return { Component: module.default };
        },
      },
      {
        path: "clients/create",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/clients/Clients"));
          return { Component: module.default };
        },
      },

      {
        path: "staff",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/super-admin/SuperAdmins"));
          return { Component: module.default };
        },
      },

      {
        path: "upgrade-billing",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/super-admin/UpgradeBillingHub"));
          return { Component: module.default };
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const module = await safeImport(() => import("../routes/super-admin/PlanManagement"));
              return { Component: module.default };
            },
          },
          {
            path: "insights",
            lazy: async () => {
              const module = await safeImport(() => import("../routes/super-admin/BillingInsights"));
              return { Component: module.default };
            },
          },
          {
            path: "settings",
            lazy: async () => {
              const module = await safeImport(() => import("../routes/super-admin/GlobalSettings"));
              return { Component: module.default };
            },
          },
        ],
      },


      {
        path: "clients/:clientId",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/clients/ClientDetail"));
          return { Component: module.default };
        },
      },
      {
        path: "profile",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/profile/Profile"));
          return { Component: module.default };
        },
      },
      {
        path: "*",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/NotFound"));
          return { Component: module.default };
        },
      },
    ],
  },
];
