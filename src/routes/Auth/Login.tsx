import { useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import Image from "../../component/common/Image";
import type { AuthLoginResponse } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";
import { getAdminHomePath } from "../../helper/adminHome";
import { getLastAppRoute, setAuthToken } from "../../helper/authSession";
import { getScopedAppPath } from "../../helper/appShell";
import { getRequiredAppLabelForRole, getRequiredAppUrlForRole, isRoleAllowedInCurrentApp } from "../../helper/appVariant";
import { mockRequest } from "../../helper/mockApi";
import { clientApiBaseUrl, isServerApiEnabled } from "../../helper/runtimeApi";
import {
  buildPublicRoleSessionFromAdmin,
  clearAllPublicRoleSessions,
  getActivePublicRoleSession,
  getPublicRoleRedirectPath,
  setPublicRoleSession,
} from "../../helper/publicRoleAuth";
import { updateAdmin } from "../../redux/authSlice";

type SharedLoginFormValues = {
  identifier: string;
  password: string;
};

const initialValues: SharedLoginFormValues = {
  identifier: "",
  password: "",
};

const canUseLocalMockFallback = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const hostname = window.location.hostname;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  const targetsLocalApi = /localhost|127\.0\.0\.1/i.test(clientApiBaseUrl);

  return isLocalHost && isServerApiEnabled && targetsLocalApi;
};

const validationSchema = Yup.object({
  identifier: Yup.string().required("Email address is required."),
  password: Yup.string().required("Password is required."),
});

const requestMockLogin = async (email: string, password: string) =>
  (await mockRequest("POST", "/auth/login", {
    email,
    password,
  })) as {
    data: {
      status: boolean;
      message: string;
      data: AuthLoginResponse;
    };
  };

const Login = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);
  const admin = useAppSelector((state) => state.admin);
  const [show, setShow] = useState(false);
  const activeRoleSession = getActivePublicRoleSession();

  const completeLogin = (authPayload: AuthLoginResponse, message: string) => {
    if (!isRoleAllowedInCurrentApp(authPayload.user.role)) {
      toast.error(
        `${authPayload.user.roleName} accounts must sign in from the ${getRequiredAppLabelForRole(authPayload.user.role)}: ${getRequiredAppUrlForRole(authPayload.user.role)}`,
      );
      return;
    }

    clearAllPublicRoleSessions();
    setAuthToken(authPayload.token);
    dispatch(updateAdmin(authPayload.user));

    if (authPayload.user.role === "trainer" || authPayload.user.role === "reviewer") {
      const publicRole = authPayload.user.role === "trainer" ? "trainer" : "reviewer";

      setPublicRoleSession(publicRole, buildPublicRoleSessionFromAdmin(publicRole, authPayload.user));
      toast.success(message);
      navigate(getPublicRoleRedirectPath(publicRole), { replace: true });
      return;
    }

    toast.success(message);
    navigate(getScopedAppPath(getLastAppRoute() || getAdminHomePath(authPayload.user.allowed, authPayload.user.role), authPayload.user.role), { replace: true });
  };

  if (admin._id) {
    return <Navigate to={getScopedAppPath(getLastAppRoute() || getAdminHomePath(admin.allowed, admin.role), admin.role)} replace />;
  }

  if (activeRoleSession) {
    return <Navigate to={activeRoleSession.redirectTo} replace />;
  }

  return (
    <main className="auth-shell-centered">
      <div className="auth-card auth-card-focused">
        <div className="auth-card-body">
          <div className="auth-card-brand">
            <Link to="/login" aria-label={`${settings.application_name} login`}>
              <Image src={settings.logo} alt={settings.application_name} className="auth-brand-logo" />
            </Link>
          </div>
          <div className="text-center mb-4">
            <h2>Sign in</h2>
            <p className="mb-0">Use your workspace email and password to continue.</p>
          </div>
          <Formik
            initialValues={initialValues}
            validationSchema={validationSchema}
            onSubmit={async (values, { setErrors, setSubmitting }) => {
              const identifier = values.identifier.trim();
              const normalizedIdentifier = identifier.toLowerCase();
              const password = values.password.trim();

              try {
                const response = await AxiosHelper.postData<AuthLoginResponse, { email: string; password: string }>(
                  "/auth/login",
                  {
                    email: normalizedIdentifier,
                    password,
                  },
                );

                if (response.data?.status) {
                  completeLogin(response.data.data, response.data.message);
                } else {
                  if (canUseLocalMockFallback()) {
                    try {
                      const fallbackResponse = await requestMockLogin(normalizedIdentifier, password);

                      if (fallbackResponse.data?.status) {
                        completeLogin(fallbackResponse.data.data, fallbackResponse.data.message);
                        return;
                      }
                    } catch {
                      // Continue with the server validation message below.
                    }
                  }

                  const errorData = (response.data?.data as unknown as Record<string, string> | undefined) ?? {};
                  const message = response.data?.message || "Unable to sign in right now.";

                  setErrors({
                    identifier: errorData.email ?? "Use a valid admin, trainer, or reviewer email.",
                    password: errorData.password ?? "Invalid password.",
                  });
                  toast.error(message);
                }
              } catch {
                if (canUseLocalMockFallback()) {
                  try {
                    const fallbackResponse = await requestMockLogin(normalizedIdentifier, password);

                    if (fallbackResponse.data?.status) {
                      completeLogin(fallbackResponse.data.data, fallbackResponse.data.message);
                      return;
                    }
                  } catch {
                    // Fall through to the user-facing unavailable state below.
                  }
                }

                setErrors({
                  identifier: "Unable to reach the login service.",
                  password: "Please try again in a moment.",
                });
                toast.error("Login service is temporarily unavailable.");
              }

              setSubmitting(false);
            }}
          >
            {({ isSubmitting }) => (
              <Form>
                <div className="mb-3">
                  <label htmlFor="identifier" className="form-label">
                    Email address
                  </label>
                  <Field
                    className="form-control"
                    type="text"
                    id="identifier"
                    name="identifier"
                    placeholder="name@company.com"
                  />
                  <ErrorMessage name="identifier" component="small" className="text-danger" />
                </div>

                <div className="mb-3">
                  <div className="d-flex justify-content-between gap-2">
                    <label htmlFor="password" className="form-label">
                      Password
                    </label>
                    <Link to="/forgot-password" className="small">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="input-group input-group-merge">
                    <Field
                      type={show ? "text" : "password"}
                      id="password"
                      name="password"
                      className="form-control"
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      className={`input-group-text border-start-0 bg-transparent ${show ? "show-password" : ""}`}
                      onClick={() => setShow((current) => !current)}
                    >
                      <span className="password-eye" />
                    </button>
                  </div>
                  <ErrorMessage name="password" component="small" className="text-danger" />
                </div>

                <div className="d-grid">
                  <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
                    ) : null}
                    Sign in
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        </div>
      </div>
    </main>
  );
};

export default Login;
