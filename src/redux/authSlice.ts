import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AdminUser } from "../constant/interfaces";

type AuthState = AdminUser & {
  authResolved: boolean;
};

const initialState: AuthState = {
  _id: "",
  clientId: "",
  clientName: "",
  currentPlan: "FREE",
  name: "",
  fullname: "",
  email: "",
  phone: "",
  title: "",
  department: "",
  role: "admin",
  roleName: "Administrator",
  permission: [],
  allowed: [],
  image: "",
  usedCredits: 0,
  totalCredits: 0,
  isUnreadNotifications: false,
  authResolved: false,
};

const authSlice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    updateAdmin: (state, action: PayloadAction<AdminUser>) => {
      state._id = action.payload._id;
      state.clientId = action.payload.clientId;
      state.clientName = action.payload.clientName;
      state.currentPlan = action.payload.currentPlan;
      state.name = action.payload.name;
      state.fullname = action.payload.fullname;
      state.email = action.payload.email;
      state.phone = action.payload.phone;
      state.title = action.payload.title;
      state.department = action.payload.department;
      state.role = action.payload.role;
      state.roleName = action.payload.roleName;
      state.permission = action.payload.permission;
      state.allowed = action.payload.allowed;
      state.image = action.payload.image;
      state.usedCredits = action.payload.usedCredits;
      state.totalCredits = action.payload.totalCredits;
      state.isUnreadNotifications = action.payload.isUnreadNotifications;
      state.authResolved = true;
    },
    loggedOutAdmin: () => ({
      ...initialState,
      authResolved: true,
    }),
    setAuthResolved: (state, action: PayloadAction<boolean>) => {
      state.authResolved = action.payload;
    },
    setUnreadNotifications: (state, action: PayloadAction<boolean>) => {
      state.isUnreadNotifications = action.payload;
    },
  },
});

export const { loggedOutAdmin, setAuthResolved, setUnreadNotifications, updateAdmin } = authSlice.actions;
export default authSlice.reducer;
