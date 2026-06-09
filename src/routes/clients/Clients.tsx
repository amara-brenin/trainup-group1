import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import * as Yup from "yup";
import ActionDropdown from "../../component/common/ActionDropdown";
import PageShell from "../../component/common/PageShell";
import PermissionMatrix from "../../component/common/PermissionMatrix";
import { Pagination } from "../../component/common/Pagination";
import { PermissionBlock } from "../../component/common/PermissionBlock";
import { filterPermissionModulesForRole, fixedRoleDefinitions, permissionModules } from "../../constant/accessControl";
import type { ClientFormValues, ClientRecord, PageParamState, PaginatedResponse } from "../../constant/interfaces";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import { getScopedAppPath } from "../../helper/appShell";
import AxiosHelper from "../../helper/AxiosHelper";
import { useDebounce } from "../../hooks/useDebounce";
import { useAppSelector } from "../../app/hooks";

const adminDefaults = fixedRoleDefinitions.find((role) => role.id === "admin");

const defaultValues: ClientFormValues = {
  name: "",
  industry: "",
  plan: "FREE",
  status: "trial",
  csm: "",
  activeUsers: 0,
  trainings: 0,
  sessions: 0,
  subdomain: "",
  domain: "",
  supportEmail: "",
  companyPhone: "",
  companyAddress: "",
  applicationName: "Samsung LMS",
  primaryColor: "#1428a0",
  secondaryColor: "#3e60d5",
  logoUrl: "",
  darkLogoUrl: "",
  faviconUrl: "",
  webhookUrl: "",
  apiScope: "",
  allowedOrigins: "",
  iframeEnabled: true,
  iframeBaseUrl: "",
  iframeAllowedParentDomains: "",
  ssoType: "Samsung IAM",
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  smtpFromName: "",
  smtpFromEmail: "",
  smtpSecure: false,
  firstUserName: "",
  firstUserEmail: "",
  clientAdminPermission: adminDefaults?.permission ?? [],
};

const validationSchema = Yup.object({
  name: Yup.string().trim().required("Client name is required."),
  industry: Yup.string().trim().required("Industry is required."),
  plan: Yup.string().required("Plan is required."),
  status: Yup.string().required("Status is required."),
  csm: Yup.string().trim().required("Customer success manager is required."),
  subdomain: Yup.string().trim().required("Subdomain is required."),
  domain: Yup.string(),
  supportEmail: Yup.string().email("Use a valid support email.").required("Support email is required."),
  firstUserName: Yup.string().trim().required("First client admin name is required."),
  firstUserEmail: Yup.string().email("Use a valid email address.").required("First client admin email is required."),
  clientAdminPermission: Yup.array().of(Yup.string()).min(1, "Select at least one client admin permission."),
});

const clientAdminModules = filterPermissionModulesForRole(permissionModules, "admin");
const createClientSteps = ["Company", "Admin", "Branding", "Permissions"] as const;
const clientCreateStepFields: Record<number, Array<keyof ClientFormValues>> = {
  1: ["name", "industry", "plan", "status", "csm", "supportEmail", "subdomain"],
  2: ["firstUserName", "firstUserEmail"],
  3: [],
  4: ["clientAdminPermission"],
};

const Clients = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAppSelector((state) => state.admin);
  const clientDetailPath = (clientId: string) => getScopedAppPath(`/clients/${clientId}`, admin.role);
  const [open, setOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [loader, setLoader] = useState(false);
  const [data, setData] = useState<PaginatedResponse<ClientRecord>>({
    count: 0,
    totalPages: 1,
    record: [],
    pagination: [1],
  });
  const [param, setParam] = useState<PageParamState>({ limit: 10, pageNo: 1, query: "" });
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "trial" | "inactive">("all");
  const [planFilter, setPlanFilter] = useState<"all" | ClientRecord["plan"]>("all");
  const [sortBy, setSortBy] = useState<"name" | "industry" | "users" | "trainings">("name");
  const debouncedQuery = useDebounce(param.query);

  const fetchRecords = useCallback(async () => {
    const { data: response } = await AxiosHelper.getData<PaginatedResponse<ClientRecord>>("/clients", {
      limit: param.limit,
      pageNo: param.pageNo,
      query: debouncedQuery,
      status: statusFilter,
      plan: planFilter,
      sortBy,
    });

    if (response.status) {
      setData(response.data);
    }
  }, [debouncedQuery, param.limit, param.pageNo, planFilter, sortBy, statusFilter]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    if (location.pathname === "/clients/create") {
      setCreateStep(1);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [location.pathname]);

  const handleDelete = async (client: ClientRecord) => {
    const result = await Swal.fire({
      title: `Delete ${client.name}?`,
      text: "This removes the client and all tenant-scoped users from the platform.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const response = await AxiosHelper.deleteData<boolean>(`/clients/${client.id}`);
    if (response.data.status) {
      toast.success(response.data.message);
      await fetchRecords();
    } else {
      toast.error(response.data.message);
    }
  };

  const formatPlanBadge = useMemo<Record<string, string>>(
    () => ({
      FREE: "text-bg-secondary",
      PRO: "text-bg-info",
      ENTERPRISE: "text-bg-primary",
      Enterprise: "text-bg-primary",
      Pro: "text-bg-info",
      Trial: "text-bg-secondary",
      Starter: "text-bg-secondary",
    }),
    [],
  );

  const filteredClients = data.record;

  const openCreateFlow = () => {
    navigate("/clients/create");
  };

  const closeCreateFlow = () => {
    setOpen(false);
    setCreateStep(1);
    navigate("/clients");
  };

  return (
    <PageShell
      title={open ? "Create client" : "Client organizations"}
      description={
        open
          ? "Set up company details, first admin access, branding, and default permissions in one guided flow."
          : "Create and manage company onboarding, first client admins, plans, whitelabeling, and integrations."
      }
    >
      {open ? (
        <Formik
          initialValues={defaultValues}
          validationSchema={validationSchema}
          onSubmit={async (values, { resetForm, setErrors }) => {
            setLoader(true);
            const response = await AxiosHelper.postData<ClientRecord, ClientFormValues>("/clients", values);

            if (response.data.status) {
              closeCreateFlow();
              toast.success(response.data.message);
              await fetchRecords();
              resetForm();
              navigate(clientDetailPath(response.data.data.id));
            } else {
              setErrors((response.data.data || {}) as unknown as Record<string, string>);
              toast.error(response.data.message);
            }

            setLoader(false);
          }}
        >
          {({ values, setFieldValue, validateForm, setTouched }) => {
            const goToClientStep = async (nextStep: number) => {
              if (nextStep <= createStep) {
                setCreateStep(nextStep);
                return;
              }

              const fieldsToValidate = clientCreateStepFields[createStep] ?? [];
              const errors = await validateForm();
              const hasStepError = fieldsToValidate.some((fieldName) => Boolean(errors[fieldName]));

              if (hasStepError) {
                setTouched(
                  fieldsToValidate.reduce<Record<string, boolean>>((accumulator, fieldName) => {
                    accumulator[fieldName] = true;
                    return accumulator;
                  }, {}),
                  true,
                );
                return;
              }

              setCreateStep(nextStep);
            };

            return (
            <Form className="client-create-shell">
              <div className="training-detail-hero">
                <div className="training-detail-hero-main">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeCreateFlow}>
                    <i className="ri-arrow-left-line me-1" />
                    Back
                  </button>
                  <div className="training-detail-title">
                    <h4 className="mb-1">Create Client</h4>
                    <p className="text-body-secondary mb-0">
                      Move through company setup, first admin, branding, and default access in a single structured flow.
                    </p>
                  </div>
                </div>
                <div className="training-detail-actions">
                  <span className="badge text-bg-primary">
                    Step {createStep} of {createClientSteps.length}
                  </span>
                </div>
              </div>

              <div className="training-stepper">
                {createClientSteps.map((label, index) => {
                  const stepNumber = index + 1;
                  const isActive = stepNumber === createStep;
                  const isComplete = stepNumber < createStep;

                  return (
                    <button
                      key={label}
                      type="button"
                      className="training-stepper-item"
                      onClick={() => void goToClientStep(stepNumber)}
                    >
                      <div className={`training-stepper-dot ${isComplete ? "is-complete" : ""} ${isActive ? "is-active" : ""}`}>
                        {stepNumber}
                      </div>
                      <span className={`training-stepper-label ${isActive ? "is-active" : ""}`}>{label}</span>
                    </button>
                  );
                })}
              </div>

              {createStep === 1 ? (
                <div className="card client-create-card">
                  <div className="card-body">
                    <div className="client-create-section-copy">
                      <div>
                        <h5 className="mb-1">Company Setup</h5>
                        <p className="text-body-secondary small mb-0">Basic company details, domain strategy, and commercial plan assignment.</p>
                      </div>
                    </div>

                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="name" className="form-label">Company name <span className="text-danger">*</span></label>
                        <Field name="name" id="name" className="form-control" />
                        <ErrorMessage name="name" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="industry" className="form-label">Industry <span className="text-danger">*</span></label>
                        <Field name="industry" id="industry" className="form-control" />
                        <ErrorMessage name="industry" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="plan" className="form-label">Plan <span className="text-danger">*</span></label>
                        <Field as="select" name="plan" id="plan" className="form-select">
                          <option value="FREE">Free</option>
                          <option value="PRO">Pro</option>
                          <option value="ENTERPRISE">Enterprise</option>
                        </Field>
                        <ErrorMessage name="plan" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="client-status" className="form-label">Status <span className="text-danger">*</span></label>
                        <Field as="select" name="status" id="client-status" className="form-select">
                          <option value="active">Active</option>
                          <option value="trial">Trial</option>
                          <option value="inactive">Inactive</option>
                        </Field>
                        <ErrorMessage name="status" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="csm" className="form-label">Customer success manager <span className="text-danger">*</span></label>
                        <Field name="csm" id="csm" className="form-control" />
                        <ErrorMessage name="csm" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="supportEmail" className="form-label">Support email <span className="text-danger">*</span></label>
                        <Field name="supportEmail" id="supportEmail" type="email" className="form-control" />
                        <ErrorMessage name="supportEmail" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="companyPhone" className="form-label">Company phone</label>
                        <Field name="companyPhone" id="companyPhone" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="companyAddress" className="form-label">Company address</label>
                        <Field name="companyAddress" id="companyAddress" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="subdomain" className="form-label">Subdomain <span className="text-danger">*</span></label>
                        <Field name="subdomain" id="subdomain" className="form-control" />
                        <ErrorMessage name="subdomain" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="domain" className="form-label">Custom domain</label>
                        <Field name="domain" id="domain" className="form-control" />
                        <ErrorMessage name="domain" component="small" className="text-danger" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {createStep === 2 ? (
                <div className="card client-create-card">
                  <div className="card-body">
                    <div className="client-create-section-copy">
                      <div>
                        <h5 className="mb-1">First Client Admin</h5>
                        <p className="text-body-secondary small mb-0">Create the first tenant admin who will own users, roles, and day-to-day platform operations.</p>
                      </div>
                    </div>

                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="firstUserName" className="form-label">Name <span className="text-danger">*</span></label>
                        <Field name="firstUserName" id="firstUserName" className="form-control" />
                        <ErrorMessage name="firstUserName" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="firstUserEmail" className="form-label">Email <span className="text-danger">*</span></label>
                        <Field name="firstUserEmail" id="firstUserEmail" type="email" className="form-control" />
                        <ErrorMessage name="firstUserEmail" component="small" className="text-danger" />
                      </div>
                      <div>
                        <div className="alert alert-light border mb-0">
                          The first admin will receive a secure Brenin SMTP set-password email after client creation.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {createStep === 3 ? (
                <div className="card client-create-card">
                  <div className="card-body">
                    <div className="client-create-section-copy">
                      <div>
                        <h5 className="mb-1">Branding & Delivery</h5>
                        <p className="text-body-secondary small mb-0">Define visible client identity, sign-in method, delivery options, and integration defaults.</p>
                      </div>
                    </div>

                    <div className="admin-form-grid mb-4">
                      <div>
                        <label htmlFor="applicationName" className="form-label">Application name</label>
                        <Field name="applicationName" id="applicationName" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="ssoType" className="form-label">SSO type</label>
                        <Field as="select" name="ssoType" id="ssoType" className="form-select">
                          <option value="Samsung IAM">Samsung IAM</option>
                          <option value="Azure AD">Azure AD</option>
                          <option value="None">None</option>
                        </Field>
                      </div>
                      <div>
                        <label htmlFor="primaryColor" className="form-label">Primary color</label>
                        <div className="d-flex gap-2">
                          <Field type="color" name="primaryColor" id="primaryColor" className="client-create-color-swatch" />
                          <Field name="primaryColor" className="form-control" />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="secondaryColor" className="form-label">Secondary color</label>
                        <div className="d-flex gap-2">
                          <Field type="color" name="secondaryColor" id="secondaryColor" className="client-create-color-swatch" />
                          <Field name="secondaryColor" className="form-control" />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="logoUrl" className="form-label">Light logo URL</label>
                        <Field name="logoUrl" id="logoUrl" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="darkLogoUrl" className="form-label">Dark logo URL</label>
                        <Field name="darkLogoUrl" id="darkLogoUrl" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="faviconUrl" className="form-label">Favicon URL</label>
                        <Field name="faviconUrl" id="faviconUrl" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="webhookUrl" className="form-label">Webhook URL</label>
                        <Field name="webhookUrl" id="webhookUrl" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="apiScope" className="form-label">API scope</label>
                        <Field name="apiScope" id="apiScope" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="allowedOrigins" className="form-label">Allowed origins</label>
                        <Field as="textarea" rows={3} name="allowedOrigins" id="allowedOrigins" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="iframeBaseUrl" className="form-label">iFrame base URL</label>
                        <Field name="iframeBaseUrl" id="iframeBaseUrl" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="iframeAllowedParentDomains" className="form-label">Allowed parent domains</label>
                        <Field as="textarea" rows={3} name="iframeAllowedParentDomains" id="iframeAllowedParentDomains" className="form-control" />
                      </div>
                    </div>

                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="smtpHost" className="form-label">SMTP host</label>
                        <Field name="smtpHost" id="smtpHost" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="smtpPort" className="form-label">SMTP port</label>
                        <Field name="smtpPort" id="smtpPort" type="number" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="smtpUsername" className="form-label">SMTP username</label>
                        <Field name="smtpUsername" id="smtpUsername" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="smtpPassword" className="form-label">SMTP password</label>
                        <Field name="smtpPassword" id="smtpPassword" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="smtpFromName" className="form-label">SMTP from name</label>
                        <Field name="smtpFromName" id="smtpFromName" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="smtpFromEmail" className="form-label">SMTP from email</label>
                        <Field name="smtpFromEmail" id="smtpFromEmail" className="form-control" />
                      </div>
                    </div>

                    <div className="client-create-checkbox-grid mt-4">
                      <div className="form-check">
                        <Field type="checkbox" name="iframeEnabled" id="iframeEnabled" className="form-check-input" />
                        <label htmlFor="iframeEnabled" className="form-check-label">Enable iframe delivery</label>
                      </div>
                      <div className="form-check">
                        <Field type="checkbox" name="smtpSecure" id="smtpSecure" className="form-check-input" />
                        <label htmlFor="smtpSecure" className="form-check-label">Use secure SMTP</label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {createStep === 4 ? (
                <div className="card client-create-card">
                  <div className="card-body">
                    <div className="client-create-section-copy">
                      <div>
                        <h5 className="mb-1">Client Admin Permissions</h5>
                        <p className="text-body-secondary small mb-0">
                          Choose which client-side modules the first client admin will control by default.
                        </p>
                      </div>
                      <span className="badge text-bg-primary">{values.clientAdminPermission?.length ?? 0} selected</span>
                    </div>

                    <PermissionMatrix
                      modules={clientAdminModules}
                      baselinePermissions={adminDefaults?.permission}
                      selectedPermissions={values.clientAdminPermission ?? []}
                      onChange={(permission) => setFieldValue("clientAdminPermission", permission)}
                    />
                    <ErrorMessage name="clientAdminPermission" component="small" className="text-danger d-block mt-2" />
                  </div>
                </div>
              ) : null}

              <div className="client-create-actions">
                <div className="d-flex gap-2 flex-wrap">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeCreateFlow}>
                    Cancel
                  </button>
                  {createStep > 1 ? (
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setCreateStep((current) => Math.max(1, current - 1))}>
                      <i className="ri-arrow-left-line me-1" />
                      Previous
                    </button>
                  ) : null}
                </div>

                <div className="d-flex gap-2 flex-wrap">
                  {createStep < createClientSteps.length ? (
                    <button type="button" className="btn btn-primary" onClick={() => void goToClientStep(Math.min(createClientSteps.length, createStep + 1))}>
                      Next
                      <i className="ri-arrow-right-line ms-1" />
                    </button>
                  ) : (
                    <button type="submit" className="btn btn-primary" disabled={loader}>
                      {loader ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <i className="ri-building-line me-1" />
                          Create client
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </Form>
            );
          }}
        </Formik>
      ) : (
        <>
          <div className="admin-reference-toolbar">
            <div className="admin-filter-row w-100">
              <div className="admin-filter-controls">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search clients, industries, or domains..."
                  value={param.query}
                  onChange={(event) =>
                    setParam((previous) => ({
                      ...previous,
                      pageNo: 1,
                      query: event.target.value,
                    }))
                  }
                />
                <select
                  className="form-select"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as "all" | "active" | "trial" | "inactive");
                    setParam((previous) => ({ ...previous, pageNo: 1 }));
                  }}
                >
                  <option value="all">All status</option>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="inactive">Inactive</option>
                </select>
                <select
                  className="form-select"
                  value={planFilter}
                  onChange={(event) => {
                    setPlanFilter(event.target.value as "all" | ClientRecord["plan"]);
                    setParam((previous) => ({ ...previous, pageNo: 1 }));
                  }}
                >
                  <option value="all">All plans</option>
                  <option value="FREE">Free</option>
                  <option value="PRO">Pro</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
                <select
                  className="form-select"
                  value={sortBy}
                  onChange={(event) => {
                    setSortBy(event.target.value as "name" | "industry" | "users" | "trainings");
                    setParam((previous) => ({ ...previous, pageNo: 1 }));
                  }}
                >
                  <option value="name">Sort by client</option>
                  <option value="industry">Sort by industry</option>
                  <option value="users">Sort by users</option>
                  <option value="trainings">Sort by trainings</option>
                </select>
              </div>
            </div>

            <PermissionBlock permissionKey={PermissionKeys.clientsAdd} allowedKey={AllowedKeys.clients}>
              <button className="btn btn-primary" onClick={openCreateFlow}>
                <i className="ri-building-line me-1" />
                Create Client
              </button>
            </PermissionBlock>
          </div>

          <div className="card admin-reference-table-card">
            <div className="card-body">
              <div className="admin-reference-table-wrapper" style={{ minHeight: 320 }}>
                <table className="table table-bordered align-middle admin-reference-table mb-0">
                  <thead>
                    <tr className="text-center">
                      <th className="table-m-width">Client</th>
                      <th className="table-m-width">Industry</th>
                      <th className="table-s-width">Plan</th>
                      <th className="table-s-width">Users</th>
                      <th className="table-s-width">Trainings</th>
                      <th className="table-m-width">Domain</th>
                      <th className="table-s-width">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => (
                      <tr key={client.id}>
                        <td>
                          <div className="d-flex align-items-center gap-3">
                            <div
                              className={`client-logo-mark d-inline-flex align-items-center justify-content-center rounded-3 fw-semibold${client.logoUrl || client.darkLogoUrl ? " has-image" : ""}`}
                              style={{
                                width: 42,
                                height: 42,
                                background: client.logoBg,
                                color: client.logoColor,
                              }}
                            >
                              {client.logoUrl || client.darkLogoUrl ? (
                                <img src={client.logoUrl || client.darkLogoUrl} alt={`${client.name} logo`} />
                              ) : (
                                client.logo
                              )}
                            </div>
                            <div>
                              <div className="fw-semibold">{client.name}</div>
                              <div className="small text-body-secondary">
                                First admin: {client.firstUserName || "Not assigned"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{client.industry}</td>
                        <td className="text-center">
                          <span className={`badge ${formatPlanBadge[client.plan] ?? "text-bg-light border"}`}>{client.plan}</span>
                          <div className="small text-body-secondary mt-1">
                            {Math.max(Number(client.totalCredits ?? 0) - Number(client.usedCredits ?? 0), 0)} credits left
                          </div>
                          {client.enterpriseRequests?.some((item) => item.status === "pending") ? (
                            <div className="small text-primary mt-1">
                              {client.enterpriseRequests.filter((item) => item.status === "pending").length} enterprise request pending
                            </div>
                          ) : null}
                        </td>
                        <td className="text-center">{client.activeUsers}</td>
                        <td className="text-center">{client.trainings}</td>
                        <td>
                          <div className="admin-domain-pill">{client.domain || `${client.subdomain}.trainup.ai`}</div>
                          <div className="small text-body-secondary">{client.domainStatus}</div>
                        </td>
                        <td className="text-center">
                          <ActionDropdown label={`Open actions for ${client.name}`}>
                            {({ close }) => (
                              <>
                                <button
                                  type="button"
                                  className="dropdown-item"
                                  onClick={() => {
                                    close();
                                    navigate(clientDetailPath(client.id));
                                  }}
                                >
                                  <i className="bi bi-eye" />
                                  <span>View details</span>
                                </button>
                                <PermissionBlock permissionKey={PermissionKeys.clientsDelete} allowedKey={AllowedKeys.clients}>
                                  <button
                                    type="button"
                                    className="dropdown-item text-danger"
                                    onClick={() => {
                                      close();
                                      void handleDelete(client);
                                    }}
                                  >
                                    <i className="bi bi-trash" />
                                    <span>Delete</span>
                                  </button>
                                </PermissionBlock>
                              </>
                            )}
                          </ActionDropdown>
                        </td>
                      </tr>
                    ))}

                    {filteredClients.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="admin-empty-state">No clients matched the selected filters.</div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <Pagination showStatistics data={data} param={param} setParam={setParam} />
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
};

export default Clients;
