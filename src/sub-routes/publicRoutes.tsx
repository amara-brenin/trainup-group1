import type { RouteObject } from "react-router-dom";
import { safeImport } from "../helper/safeImport";

export const publicRoutes: RouteObject[] = [
  {
    path: "slideshows/:trainingId",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/TrainingLaunch"));
      return { Component: module.default };
    },
  },
  {
    path: "hall/:gsId",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/GroupHallScreen"));
      return { Component: module.default };
    },
  },
  {
    path: "group/:joinToken",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/GroupTraineeController"));
      return { Component: module.default };
    },
  },
  {
    path: "group-sessions/:gsId/live",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/GroupSessionDashboard"));
      return { Component: module.default };
    },
  },
  {
    path: "training/:trainingId/analytics",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/GroupTrainingAnalytics"));
      return { Component: module.default };
    },
  },
  {
    path: "demo-training/:demoToken",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/DemoTrainingLaunch"));
      return { Component: module.default };
    },
  },
  {
    // Signed external launch link for embedding inside an LMS (Method A/E).
    path: "secure-launch/:launchToken",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/launch/SecureTrainingLaunch"));
      return { Component: module.default };
    },
  },
  {
    path: "trainer",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/trainer/TrainerWorkspacePanel"));
      return { Component: module.default };
    },
  },
  {
    path: "reviewer",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/reviewer/ReviewerWorkspacePanel"));
      return { Component: module.default };
    },
  },
  {
    path: "trainee",
    lazy: async () => {
      const module = await safeImport(() => import("../routes/trainee/TraineeWorkspacePanel"));
      return { Component: module.default };
    },
  },
  {
    path: "/",
    lazy: async () => {
      const module = await safeImport(() => import("../layouts/PublicLayout"));
      return { Component: module.default };
    },
    children: [
      {
        index: true,
        lazy: async () => {
          const module = await safeImport(() => import("../routes/RedirectToLogin"));
          return { Component: module.default };
        },
      },
      {
        path: "trainer/login",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/RedirectToLogin"));
          return { Component: module.default };
        },
      },
      {
        path: "reviewer/login",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/RedirectToLogin"));
          return { Component: module.default };
        },
      },
      {
        path: "trainee/login",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/RedirectToLogin"));
          return { Component: module.default };
        },
      },
      {
        path: "employee-sso",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/employee/EmployeeSso"));
          return { Component: module.default };
        },
      },
      {
        path: "employee-sso/login",
        lazy: async () => {
          const module = await safeImport(() => import("../routes/employee/EmployeeSso"));
          return { Component: module.default };
        },
      },
    ],
  },
];
