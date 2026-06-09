import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./redux/authSlice";
import settingsReducer from "./redux/settingsSlice";
import trainingWorkspaceReducer, { persistTrainingWorkspaceState } from "./redux/trainingWorkspaceSlice";
import themeReducer from "./redux/themeSlice";

export const store = configureStore({
  reducer: {
    admin: authReducer,
    settings: settingsReducer,
    theme: themeReducer,
    trainingWorkspace: trainingWorkspaceReducer,
  },
});

store.subscribe(() => {
  persistTrainingWorkspaceState(store.getState().trainingWorkspace);
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
