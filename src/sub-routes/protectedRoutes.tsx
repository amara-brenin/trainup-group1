import type { RouteObject } from "react-router-dom";
import { safeImport } from "../helper/safeImport";

export const protectedRoutes: RouteObject[] = [
  {
    path: "/",
    lazy: async () => {
      const module = await safeImport(() => import("../layouts/MainLayout"));
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
        path: "clients/:clientId",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/clients/ClientDetail"));
          return { Component: module.default };
        },
      },
      {
        path: "users",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/users/Users"));
          return { Component: module.default };
        },
      },
      {
        path: "trainees",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/users/Trainees"));
          return { Component: module.default };
        },
      },
      {
        path: "trainees/:traineeId/report",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/users/TraineeReport"));
          return { Component: module.default };
        },
      },
      {
        path: "trainees/:traineeId/report/:sessionId",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/users/TraineeReport"));
          return { Component: module.default };
        },
      },
      {
        path: "roles",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/users/Roles"));
          return { Component: module.default };
        },
      },
      {
        path: "settings",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/settings/Settings"));
          return { Component: module.default };
        },
      },
      {
        path: "email-center",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/settings/EmailCenter"));
          return { Component: module.default };
        },
      },
      {
        path: "upgrade-billings",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/UpgradeBillings"));
          return { Component: module.default };
        },
      },
      {
        path: "upgrade-billings/:checkoutPlan",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/UpgradeBillings"));
          return { Component: module.default };
        },
      },
      {
        path: "avatar-creator",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/avatar/AvatarCreator"));
          return { Component: module.default };
        },
      },
      {
        path: "api-keys",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/integrations/ApiKeys"));
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
        path: "webhooks",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/integrations/WebhookSettings"));
          return { Component: module.default };
        },
      },
      {
        path: "iframe",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/integrations/IframeConfiguration"));
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
