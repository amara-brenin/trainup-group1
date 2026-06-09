import { Navigate, useNavigate } from "react-router-dom";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { useAppSelector } from "../../app/hooks";
import type { PublicRole, PublicRoleSession } from "../../helper/publicRoleAuth";
import { getPublicRoleSession, setPublicRoleSession } from "../../helper/publicRoleAuth";
import Image from "./Image";

type RoleLoginFormValues = {
  identifier: string;
  password: string;
};

type PublicRoleLoginCardProps = {
  role: PublicRole;
  title: string;
  description: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  identifierType?: string;
  demoText: string;
  initialValues: RoleLoginFormValues;
  redirectTo: string;
  authenticate: (
    identifier: string,
    password: string,
  ) => {
    session?: PublicRoleSession;
    message: string;
    errors?: Record<string, string>;
  };
};

const validationSchema = Yup.object({
  identifier: Yup.string().required("This field is required."),
  password: Yup.string().required("Password is required."),
});

const PublicRoleLoginCard = ({
  role,
  title,
  description,
  identifierLabel,
  identifierPlaceholder,
  identifierType = "text",
  demoText,
  initialValues,
  redirectTo,
  authenticate,
}: PublicRoleLoginCardProps) => {
  const navigate = useNavigate();
  const settings = useAppSelector((state) => state.settings);
  const session = getPublicRoleSession(role);

  if (session) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <main className="auth-shell-centered">
      <div className="auth-card auth-card-focused">
        <div className="auth-card-body">
          <div className="auth-card-brand">
          <Image src={settings.logo} alt={settings.application_name} className="auth-brand-logo" />
          </div>
          <div className="text-center mb-4">
            <h2>{title}</h2>
            <p className="mb-3">{description}</p>
            <div className="auth-demo-note text-start">{demoText}</div>
          </div>

          <Formik
            initialValues={initialValues}
            validationSchema={validationSchema}
            onSubmit={(values, { setErrors, setSubmitting }) => {
              const result = authenticate(values.identifier, values.password);

              if (result.session) {
                setPublicRoleSession(role, result.session);
                toast.success(result.message);
                navigate(redirectTo, { replace: true });
              } else {
                setErrors(result.errors ?? {});
                toast.error(result.message);
              }

              setSubmitting(false);
            }}
          >
            {({ isSubmitting }) => (
                <Form>
                  <div className="mb-3">
                    <label htmlFor="identifier" className="form-label">
                      {identifierLabel}
                    </label>
                    <Field
                      className="form-control"
                      type={identifierType}
                      id="identifier"
                      name="identifier"
                      placeholder={identifierPlaceholder}
                    />
                    <ErrorMessage name="identifier" component="small" className="text-danger" />
                  </div>

                  <div className="mb-3">
                    <label htmlFor="password" className="form-label">
                      Password
                    </label>
                    <Field
                      type="password"
                      id="password"
                      name="password"
                      className="form-control"
                      placeholder="Enter password"
                    />
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

export default PublicRoleLoginCard;
