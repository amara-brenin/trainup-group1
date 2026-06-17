import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isSuperAdmin = env.VITE_APP_VARIANT === "superadmin";
  const port = Number(env.VITE_PORT || (isSuperAdmin ? 5174 : 5173));
  const isVercelBuild =
    env.VERCEL === "1" || env.CI === "true" || process.env.VERCEL === "1";

  let basePrefix = env.VITE_BASE_URL || "/";
  if (!basePrefix.endsWith("/")) {
    basePrefix += "/";
  }
  
  const finalBase = isSuperAdmin && !basePrefix.endsWith("/console")
    ? `${basePrefix}`
    : basePrefix;

  return {
    base: finalBase,
    plugins: [react()],
    server: {
      port,
      strictPort: true,
    },
    preview: {
      port,
      strictPort: true,
    },
    build: {
      outDir: isVercelBuild
        ? "dist"
        : isSuperAdmin
          ? "dist-superadmin"
          : "dist-admin",
      chunkSizeWarningLimit: 1300,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return;
            }

            if (id.includes("pdfjs-dist")) {
              return "pdfjs";
            }

            if (id.includes("jszip")) {
              return "office-parser";
            }

            if (id.includes("tesseract.js")) {
              return "ocr-engine";
            }

            if (id.includes("@aws-sdk") || id.includes("@smithy")) {
              return "aws";
            }

            if (
              id.includes("formik") ||
              id.includes("yup") ||
              id.includes("sweetalert2") ||
              id.includes("react-toastify")
            ) {
              return "forms-ui";
            }

            if (id.includes("bootstrap") || id.includes("bootstrap-icons")) {
              return "ui-kit";
            }

            if (id.includes("mespeak")) {
              return "speech-engine";
            }

            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("react-router") ||
              id.includes("react-redux") ||
              id.includes("@reduxjs/toolkit")
            ) {
              return "react-core";
            }
          },
        },
      },
    },
  };
});