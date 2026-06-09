import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { employeeAssignedTraining, ssoUsers } from "../../constant/demoExperiences";
import {
  clearAllPublicRoleSessions,
  clearPublicRoleSession,
  getPublicRoleSession,
  setPublicRoleSession,
  type PublicRoleSession,
} from "../../helper/publicRoleAuth";

type EmployeeSsoStep = "portal" | "checking" | "granted" | "already_logged_in";

type EmployeeSsoValues = {
  employeeId: string;
  password: string;
};

const AUTO_SESSION_EMPLOYEE_ID = "SAM-1042";

const validationSchema = Yup.object({
  employeeId: Yup.string().trim().required("Please enter your Samsung Employee ID."),
  password: Yup.string().trim().required("Please enter your Samsung account password."),
});

const initialValues: EmployeeSsoValues = {
  employeeId: "",
  password: "",
};

const EmployeeSso = () => {
  const navigate = useNavigate();
  const timerRef = useRef<number | null>(null);
  const [employeeSession, setEmployeeSession] = useState<PublicRoleSession | null>(() => getPublicRoleSession("employee"));
  const [step, setStep] = useState<EmployeeSsoStep>(() => (getPublicRoleSession("employee") ? "already_logged_in" : "portal"));

  const resolvedSession = employeeSession ?? getPublicRoleSession("employee");
  const resolvedEmployeeId = resolvedSession?.identifier ?? "";
  const resolvedEmployee = resolvedEmployeeId
    ? ssoUsers[resolvedEmployeeId as keyof typeof ssoUsers] ?? null
    : null;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const trainingSummary = useMemo(
    () => [
      { label: "Training", value: employeeAssignedTraining.title },
      { label: "Audience", value: employeeAssignedTraining.audience },
      { label: "Duration", value: employeeAssignedTraining.durationLabel },
      { label: "Slides", value: `${employeeAssignedTraining.slideCount}` },
    ],
    [],
  );

  const completeEmployeeAccess = (employeeId: string, nextStep: Exclude<EmployeeSsoStep, "portal" | "checking">) => {
    const employee = ssoUsers[employeeId as keyof typeof ssoUsers];

    if (!employee) {
      toast.error("Employee directory record not found.");
      setStep("portal");
      return;
    }

    const nextSession: PublicRoleSession = {
      role: "employee",
      identifier: employeeId,
      name: employee.name,
      roleLabel: "Employee",
      dept: employee.dept,
    };

    clearAllPublicRoleSessions();
    setPublicRoleSession("employee", nextSession);
    setEmployeeSession(nextSession);
    setStep(nextStep);
  };

  const runVerification = (employeeId: string, nextStep: Exclude<EmployeeSsoStep, "portal" | "checking">, successMessage: string) => {
    if (!ssoUsers[employeeId as keyof typeof ssoUsers]) {
      toast.error("Employee directory record not found.");
      setStep("portal");
      return;
    }

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    setStep("checking");
    timerRef.current = window.setTimeout(() => {
      completeEmployeeAccess(employeeId, nextStep);
      toast.success(successMessage);
    }, nextStep === "already_logged_in" ? 1200 : 1700);
  };

  const resetToPortal = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    clearPublicRoleSession("employee");
    setEmployeeSession(null);
    setStep("portal");
  };

  const startTraining = () => {
    window.location.href = employeeAssignedTraining.launchUrl;
  };

  const employeeMeta = resolvedEmployee ?? ssoUsers[AUTO_SESSION_EMPLOYEE_ID];

  if (step === "checking") {
    return (
      <div className="employee-sso-status-shell">
        <div className="employee-sso-status-card">
          <div className="employee-sso-status-icon">
            <i className="bi bi-arrow-repeat" aria-hidden="true" />
          </div>
          <h2>Verifying with Samsung SSO...</h2>
          <p>Checking credentials with the internal directory and assigned training link.</p>
          <div className="employee-sso-progress">
            <span className="employee-sso-progress-bar" />
          </div>
        </div>
      </div>
    );
  }

  if ((step === "granted" || step === "already_logged_in") && employeeMeta) {
    const isExistingSession = step === "already_logged_in";

    return (
      <div className="employee-sso-status-shell">
        <div className="employee-sso-status-card employee-sso-access-card">
          <div className={`employee-sso-status-banner ${isExistingSession ? "is-success" : "is-primary"}`}>
            <div className="employee-sso-banner-icon">{isExistingSession ? "✓" : "SSO"}</div>
            <div>
              <h2>{isExistingSession ? "Session Already Active" : "SSO Verified"}</h2>
              <p>
                {isExistingSession
                  ? "You are already signed in to Samsung SSO on this device."
                  : "Credentials verified. Your assigned training is ready to start."}
              </p>
            </div>
          </div>

          <div className="employee-sso-access-body">
            <div className="employee-sso-summary-grid">
              <div className="employee-sso-summary-panel">
                <h3>Learner Details</h3>
                <div className="employee-sso-info-list">
                  <div>
                    <span>Employee ID</span>
                    <strong>{resolvedSession?.identifier ?? AUTO_SESSION_EMPLOYEE_ID}</strong>
                  </div>
                  <div>
                    <span>Name</span>
                    <strong>{employeeMeta.name}</strong>
                  </div>
                  <div>
                    <span>Department</span>
                    <strong>{employeeMeta.dept}</strong>
                  </div>
                </div>
              </div>

              <div className="employee-sso-summary-panel">
                <h3>Training Details</h3>
                <div className="employee-sso-info-list">
                  {trainingSummary.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="employee-sso-checklist">
              {employeeAssignedTraining.checklist.map((item) => (
                <div key={item} className="employee-sso-checklist-item">
                  <i className="bi bi-check-circle-fill" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-primary w-100" onClick={startTraining}>
              {isExistingSession ? "Continue to Training" : "Start Training Now"}
            </button>

            {isExistingSession ? (
              <div className="text-center mt-3 small text-body-secondary">
                Not you?{" "}
                <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={resetToPortal}>
                  Sign in with a different account
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="employee-sso-shell">
      <div className="employee-sso-topbar">
        <div className="employee-sso-brand">
          <div className="employee-sso-brand-logo">S</div>
          <div className="employee-sso-brand-copy">
            <strong>Samsung One Portal</strong>
            <span>Internal Employee SSO</span>
          </div>
        </div>
        <div className="employee-sso-domain">
          <span className="employee-sso-domain-dot" />
          <span>sso.samsung-internal.com</span>
        </div>
      </div>

      <div className="employee-sso-browserbar">
        {employeeAssignedTraining.accessUrl}
      </div>

      <div className="employee-sso-body">
        <div className="employee-sso-card">
          <div className="employee-sso-card-header">
            <span className="badge bg-primary-subtle text-primary-emphasis">Access via Training Link</span>
            <h1>Samsung Internal Employee SSO</h1>
            <p>Verify the employee record first, then launch the assigned Samsung LMS training immediately.</p>
          </div>

          <div className="employee-sso-training-strip">
            <div>
              <div className="small text-body-secondary">Assigned training</div>
              <strong>{employeeAssignedTraining.title}</strong>
            </div>
            <div className="text-end">
              <div className="small text-body-secondary">Access token</div>
              <strong>{employeeAssignedTraining.id}</strong>
            </div>
          </div>

          <Formik
            initialValues={initialValues}
            validationSchema={validationSchema}
            onSubmit={(values, { setErrors, setSubmitting }) => {
              const employeeId = values.employeeId.trim().toUpperCase();
              const password = values.password.trim();
              const employee = ssoUsers[employeeId as keyof typeof ssoUsers];

              if (!employee) {
                setErrors({ employeeId: "Employee ID was not found in Samsung IAM." });
                setSubmitting(false);
                return;
              }

              if (employee.password !== password) {
                setErrors({ password: "Password did not match the Samsung account record." });
                setSubmitting(false);
                return;
              }

              runVerification(employeeId, "granted", `SSO verified for ${employeeId}.`);
              setSubmitting(false);
            }}
          >
            {({ isSubmitting }) => (
              <Form>
                <div className="mb-3">
                  <label htmlFor="employeeId" className="form-label">
                    Samsung Employee ID
                  </label>
                  <Field id="employeeId" name="employeeId" className="form-control" placeholder="SAM-1042" />
                  <div className="form-text">Demo hint: use `SAM-1042`.</div>
                  <ErrorMessage name="employeeId" component="small" className="text-danger" />
                </div>

                <div className="mb-3">
                  <label htmlFor="password" className="form-label">
                    Samsung Account Password
                  </label>
                  <Field id="password" name="password" type="password" className="form-control" placeholder="Sam@1042" />
                  <div className="form-text">Demo hint: use the employee suffix format, for example Sam@1042.</div>
                  <ErrorMessage name="password" component="small" className="text-danger" />
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                  ) : (
                    <i className="bi bi-shield-lock me-2" aria-hidden="true" />
                  )}
                  Sign In with Samsung SSO
                </button>
              </Form>
            )}
          </Formik>

          <div className="employee-sso-divider" />

          <div className="text-center small text-body-secondary">
            Already signed in on this device?{" "}
            <button
              type="button"
              className="btn btn-link btn-sm p-0 align-baseline"
              onClick={() => runVerification(AUTO_SESSION_EMPLOYEE_ID, "already_logged_in", "Existing Samsung SSO session found.")}
            >
              Use existing session
            </button>
          </div>

          <div className="employee-sso-footer">
            <div>
              <i className="bi bi-shield-check me-1" aria-hidden="true" />
              Secured by Samsung IAM
            </div>
            <button type="button" className="btn btn-light btn-sm" onClick={() => navigate("/login", { replace: true })}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeSso;
