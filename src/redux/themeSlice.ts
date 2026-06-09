import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type ThemeState = {
  bsTheme: "light" | "dark";
  layoutMode: "fluid";
  menuColor: "dark" | "light";
  topbarColor: "light" | "dark";
  layoutPosition: "fixed";
  sidenavSize: "full" | "default" | "condensed";
  menuActive: boolean;
  modalCount: number;
};

const savedTheme =
  typeof window !== "undefined" && window.localStorage.getItem("theme") === "dark"
    ? "dark"
    : "light";

const initialState: ThemeState = {
  bsTheme: savedTheme,
  layoutMode: "fluid",
  menuColor: "dark",
  topbarColor: savedTheme === "dark" ? "dark" : "light",
  layoutPosition: "fixed",
  sidenavSize: "full",
  menuActive: false,
  modalCount: 0,
};

const themeSlice = createSlice({
  name: "theme",
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.bsTheme = state.bsTheme === "dark" ? "light" : "dark";
      state.topbarColor = state.bsTheme === "dark" ? "dark" : "light";
      if (typeof window !== "undefined") {
        window.localStorage.setItem("theme", state.bsTheme);
      }
    },
    toggleSidebar: (state) => {
      state.menuActive = !state.menuActive;
      if (state.sidenavSize === "default" || state.sidenavSize === "condensed") {
        state.sidenavSize = state.sidenavSize === "default" ? "condensed" : "default";
      }
    },
    closeSidebar: (state) => {
      state.menuActive = false;
    },
    changeSidebarSize: (state, action: PayloadAction<ThemeState["sidenavSize"]>) => {
      state.sidenavSize = action.payload;
    },
    increaseModalCount: (state) => {
      state.modalCount += 1;
    },
    decreaseModalCount: (state) => {
      state.modalCount = Math.max(0, state.modalCount - 1);
    },
  },
});

export const {
  changeSidebarSize,
  closeSidebar,
  decreaseModalCount,
  increaseModalCount,
  toggleSidebar,
  toggleTheme,
} = themeSlice.actions;

export const setSidenavSize = changeSidebarSize;
export const incrementModalCount = increaseModalCount;
export const decrementModalCount = decreaseModalCount;

export default themeSlice.reducer;
