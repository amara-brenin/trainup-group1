import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AppSettings } from "../constant/interfaces";
import Logo from "../assets/images/logo.png";
import LogoDark from "../assets/images/logo-dark.png";
import Favicon from "../assets/images/favicon.png";

const isSuperAdminApp = import.meta.env.VITE_APP_VARIANT === "superadmin";

const initialState: AppSettings = {
  application_name: isSuperAdminApp ? "Brenin Inc." : "Trainup",
  logo: Logo,
  dark_logo: LogoDark,
  favicon: Favicon,
  email: "support@trainup.ai",
  copyright: `© ${new Date().getFullYear()} Trainup. All rights reserved.`,
  phone: "+91 1800 120 9999",
  path: "/dashboard",
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    updateSettings: (state, action: PayloadAction<Partial<AppSettings>>) => ({
      ...state,
      ...action.payload,
    }),
  },
});

export const { updateSettings } = settingsSlice.actions;
export default settingsSlice.reducer;
