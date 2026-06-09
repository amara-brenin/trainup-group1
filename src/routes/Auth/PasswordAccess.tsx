import { useEffect, useMemo, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import Image from "../../component/common/Image";
import { useAppSelector } from "../../app/hooks";
import AxiosHelper from "../../helper/AxiosHelper";

type TokenPayload = {
  email: string;
  name: string;
  purpose: "set_password" | "reset_password";
  expiresAt: string;
};

type PasswordMode = "set" | "reset" | "forgot";

const passwordSchema = Yup.object({
  password: Yup.string().min(6, "Password must be at least 6 characters.").required("Password is required."),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("password")], "Passwords must match.")
    .required("Confirm password is required."),
});

const forgotSchema = Yup.object({
  email: Yup.string().email("Use a valid email address.").required("Email is required."),
});

const PasswordAccess = ({ mode }: { mode: PasswordMode }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const settings = useAppSelector((state) => state.settings);
  const token = searchParams.get("token") || "";
  const [tokenPayload, setTokenPayload] = useState<TokenPayload | null>(null);
  const [loadingToken, setLoadingToken] = useState(mode !== "forgot");
  const [tokenError, setTokenError] = useState("");

  const isReset = mode === "reset";
  const title = mode === "forgot" ? "Reset password" : isReset ? "Create a new password" : "Set your password";
  const description = mode === "forgot"
    ? "Enter your workspace email and we will send a secure reset link."
    : "Choose a secure password to continue to your workspace.";

  const expectedPurpose = useMemo(() => (isReset ? "reset_password" : "set_password"), [isReset]);

  useEffect(() => {
    if (mode === "forgot") {
      return;
    }

    const validate = async () => {
      if (!token) {
        setTokenError("This password link is missing a token.");
        setLoadingToken(false);
        return;
      }

      const response = await AxiosHelper.getData<TokenPayload>("/auth/password-token", {
        token,
        purpose: expectedPurpose,
      });

      if (response.data.status) {
        setTokenPayload(response.data.data);
      } else {
        setTokenError(response.data.message);
      }

      setLoadingToken(false);
    };

    void validate();
  }, [expectedPurpose, mode, token]);

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
            <h2>{title}</h2>
            <p className="mb-0">{description}</p>
          </div>

          {mode === "forgot" ? (
            <Formik
              initialValues={{ email: "" }}
              validationSchema={forgotSchema}
              onSubmit={async (values, { setErrors, setSubmitting, resetForm }) => {
                const response = await AxiosHelper.postData<{ expiresAt: string }, { email: string }>("/auth/forgot-password", {
                  email: values.email.trim().toLowerCase(),
                });

                if (response.data.status) {
                  toast.success(response.data.message);
                  resetForm();
                } else {
                  setErrors((response.data.data || {}) as unknown as Record<string, string>);
                  toast.error(response.data.message);
                }

                setSubmitting(false);
              }}
            >
              {({ isSubmitting }) => (
                <Form>
                  <div className="mb-3">
                    <label htmlFor="email" className="form-label">Email address</label>
                    <Field id="email" name="email" type="email" className="form-control" placeholder="name@company.com" />
                    <ErrorMessage name="email" component="small" className="text-danger" />
                  </div>
                  <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
                    {isSubmitting ? "Sending..." : "Send reset link"}
                  </button>
                </Form>
              )}
            </Formik>
          ) : loadingToken ? (
            <div className="text-center text-body-secondary py-3">Validating secure link...</div>
          ) : tokenError ? (
            <div className="alert alert-danger mb-0">{tokenError}</div>
          ) : (
            <Formik
              initialValues={{ password: "", confirmPassword: "" }}
              validationSchema={passwordSchema}
              onSubmit={async (values, { setErrors, setSubmitting }) => {
                const endpoint = isReset ? "/auth/reset-password" : "/auth/set-password";
                const response = await AxiosHelper.postData<boolean, typeof values & { token: string }>(endpoint, {
                  ...values,
                  token,
                });

                if (response.data.status) {
                  toast.success(response.data.message);
                  navigate("/login", { replace: true });
                } else {
                  setErrors((response.data.data || {}) as unknown as Record<string, string>);
                  toast.error(response.data.message);
                }

                setSubmitting(false);
              }}
            >
              {({ isSubmitting }) => (
                <Form>
                  {tokenPayload ? (
                    <div className="alert alert-light border">
                      Setting password for <strong>{tokenPayload.email}</strong>
                    </div>
                  ) : null}
                  <div className="mb-3">
                    <label htmlFor="password" className="form-label">New password</label>
                    <Field id="password" name="password" type="password" className="form-control" />
                    <ErrorMessage name="password" component="small" className="text-danger" />
                  </div>
                  <div className="mb-3">
                    <label htmlFor="confirmPassword" className="form-label">Confirm password</label>
                    <Field id="confirmPassword" name="confirmPassword" type="password" className="form-control" />
                    <ErrorMessage name="confirmPassword" component="small" className="text-danger" />
                  </div>
                  <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : isReset ? "Reset password" : "Set password"}
                  </button>
                </Form>
              )}
            </Formik>
          )}

          <div className="text-center mt-4">
            <Link to="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    </main>
  );
};

export default PasswordAccess;
