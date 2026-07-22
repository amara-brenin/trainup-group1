import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { useParams } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import BrandAssetInput from "../../component/common/BrandAssetInput";
import PageShell from "../../component/common/PageShell";
import PermissionMatrix from "../../component/common/PermissionMatrix";
import { filterPermissionModulesForRole, fixedRoleDefinitions, permissionModules } from "../../constant/accessControl";
import type { ActionResponse, ClientRecord, ClientSettingsSection } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";
import { validateBrandAssetSource } from "../../helper/brandingAssets";
import { sanitizePhoneInput } from "../../helper/validation";
import { Modal } from "../../component/common/Modal";

interface ApiAvatarItem {
  avatarId: string;
  avatarName: string;
  image: string;
  provider: string;
  templateId: string;
}

const tabOptions: Array<{ id: ClientSettingsSection | "overview"; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "company", label: "Company" },
  { id: "clientAdmin", label: "Client Admin" },
  { id: "domain", label: "Domain" },
  { id: "whitelabel", label: "White-labeling" },
  { id: "avatars", label: "Avatars" },
  { id: "integrations", label: "Integrations" },
  { id: "smtp", label: "SMTP" },
  { id: "billing", label: "Billing" },
];

const clientAdminModules = filterPermissionModulesForRole(permissionModules, "admin");
const adminDefaults = fixedRoleDefinitions.find((role) => role.id === "admin")?.permission ?? [];
const planLabels: Record<string, string> = {
  FREE: "Free",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};
const overviewMetricColors = ["#3e60d5", "#16a7e9", "#47ad77", "#a020f0", "#ffbc00", "#0acf97"];
// Removed formatLimitValue

const ClientDetail = () => {
  const { clientId = "" } = useParams();
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabOptions)[number]["id"]>("overview");
  const [savingSection, setSavingSection] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<"" | "domain" | "webhook" | "smtp" | "clientAdminEmail">("");
  const [selectedMethod, setSelectedMethod] = useState<string>("all");

  // Avatar assignment states
  const [allAvatars, setAllAvatars] = useState<ApiAvatarItem[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedAvatars, setSelectedAvatars] = useState<string[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  const fetchClient = useCallback(async () => {
    const { data } = await AxiosHelper.getData<ClientRecord>(`/clients/${clientId}`);
    if (data.status) {
      setClient(data.data);
    } else {
      toast.error(data.message);
    }
  }, [clientId]);

  const fetchAllAvatars = useCallback(async () => {
    setAvatarsLoading(true);
    try {
      const response = await AxiosHelper.getData<ApiAvatarItem[]>("/avatars");
      if (response.data.status) {
        setAllAvatars(response.data.data);
      }
    } catch (err) {
      console.error("Failed to fetch avatars", err);
    } finally {
      setAvatarsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClient();
    void fetchAllAvatars();
  }, [fetchClient, fetchAllAvatars]);

  const overviewMetrics = useMemo(() => {
    if (!client) {
      return [];
    }

    return [
      {
        label: "Plan",
        value: client.planExpired ? `${planLabels[client.plan] ?? client.plan} (Expired)` : planLabels[client.plan] ?? client.plan,
        icon: "bi bi-stars",
      },
      { label: "Active users", value: client.activeUsers, icon: "bi bi-people" },
      { label: "Trainings", value: client.trainings, icon: "bi bi-journal-richtext" },
      { label: "Sessions", value: client.sessions, icon: "bi bi-play-circle" },
      {
        label: "Credits left",
        value: client.planExpired ? 0 : Math.max(Number(client.totalCredits ?? 0) - Number(client.usedCredits ?? 0), 0),
        icon: "bi bi-coin",
      },
      { label: "SSO", value: client.ssoStatus, icon: "bi bi-shield-check" },
    ];
  }, [client]);

  const saveSection = async (
    section: ClientSettingsSection,
    values: Record<string, unknown>,
    setErrors: (errors: Record<string, string>) => void,
  ) => {
    setSavingSection(section);
    const response = await AxiosHelper.putData<ClientRecord, { section: ClientSettingsSection; values: Record<string, unknown> }>(`/clients/${clientId}/settings`, {
      section,
      values,
    });

    if (response.data.status) {
      setClient(response.data.data);
      toast.success(response.data.message);
    } else {
      setErrors((response.data.data || {}) as unknown as Record<string, string>);
      toast.error(response.data.message);
    }

    setSavingSection("");
  };

  const runAction = async (
    action: "domain" | "webhook" | "smtp" | "clientAdminEmail",
    request: Promise<{ data: { status: boolean; message: string; data: { client?: ClientRecord; result?: ActionResponse } } }>,
  ) => {
    setActionLoading(action);
    const response = await request;

    if (response.data.status) {
      if (response.data.data?.client) {
        setClient(response.data.data.client);
      } else {
        await fetchClient();
      }
      toast.success(response.data.message);
    } else {
      toast.error(response.data.message);
    }

    setActionLoading("");
  };

  const handleOpenAssignModal = () => {
    setSelectedAvatars(client?.assignedAvatars || []);
    setAssignModalOpen(true);
  };

  const toggleAvatarSelection = (avatarId: string) => {
    setSelectedAvatars((prev) =>
      prev.includes(avatarId) ? prev.filter((id) => id !== avatarId) : [...prev, avatarId]
    );
  };

  const handleAssignSubmit = async () => {
    if (!client) return;
    setAssignLoading(true);
    try {
      const response = await AxiosHelper.putData<ClientRecord, { section: string; values: any }>(`/clients/${clientId}/settings`, {
        section: "avatars",
        values: { assignedAvatars: selectedAvatars },
      });
      if (response.data.status) {
        setClient(response.data.data);
        toast.success("Avatars assigned successfully");
        setAssignModalOpen(false);
      } else {
        toast.error(response.data.message);
      }
    } catch (err) {
      toast.error("Failed to assign avatars");
    } finally {
      setAssignLoading(false);
    }
  };

  if (!client) {
    return (
      <div className="card app-loading-card">
        <div className="card-body p-4">
          <span className="ds-skeleton app-loading-line is-wide" />
          <span className="ds-skeleton app-loading-line is-mid" />
          <div className="app-loading-grid">
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
          </div>
          <div className="app-loading-table-lines">
            <span className="ds-skeleton app-loading-line" />
            <span className="ds-skeleton app-loading-line" />
            <span className="ds-skeleton app-loading-line" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title={client.name}
      description={`${client.industry} - Joined ${client.joined} - CSM: ${client.csm}`}
    >
      <div className="row g-3 mb-3">
        {overviewMetrics.map((item, index) => (
          <div key={item.label} className="col-6 col-xl">
            <div className="card admin-metric-card h-100" style={{ "--metric-color": overviewMetricColors[index % overviewMetricColors.length] } as CSSProperties}>
              <div className="card-body">
                <div className="admin-metric-card-icon" aria-hidden="true">
                  <i className={item.icon} />
                </div>
                <div>
                  <div className="small text-body-secondary mb-2">{item.label}</div>
                  <div className="fw-semibold">{item.value}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap gap-2">
          {tabOptions.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-sm ${activeTab === tab.id ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" ? (
        <div className="row g-3">
          <div className="col-12 col-xl-6">
            <div className="card h-100">
              <div className="card-header bg-transparent border-0 pb-0">
                <h2 className="h5 fw-semibold mb-1">Onboarding summary</h2>
                <p className="small text-body-secondary mb-0">Core client setup and first admin access.</p>
              </div>
              <div className="card-body admin-settings-list">
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">First client admin</div>
                  <div className="fw-semibold">{client.firstUserName}</div>
                  <div className="small text-body-secondary">{client.firstUserEmail}</div>
                </div>
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">Application</div>
                  <div className="fw-semibold">{client.applicationName || client.name}</div>
                </div>
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">Support email</div>
                  <div className="fw-semibold">{client.supportEmail}</div>
                </div>
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">SMTP</div>
                  <div className="fw-semibold">{client.emailDeliveryEnabled ? client.smtpHost || "Configured" : "Disabled"}</div>
                </div>
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">Enterprise requests</div>
                  <div className="fw-semibold">
                    {client.enterpriseRequests?.filter((item) => item.status === "pending").length || 0} pending
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-xl-6">
            <div className="card h-100">
              <div className="card-header bg-transparent border-0 pb-0">
                <h2 className="h5 fw-semibold mb-1">Delivery configuration</h2>
                <p className="small text-body-secondary mb-0">Domain, whitelabel, and integration overview.</p>
              </div>
              <div className="card-body admin-settings-list">
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">Custom domain</div>
                  <div className="fw-semibold">{client.domain || "Not configured"}</div>
                  <div className="small text-body-secondary">Status: {client.domainStatus}</div>
                </div>
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">Subdomain</div>
                  <div className="fw-semibold admin-domain-pill">{client.subdomain}.trainup.ai</div>
                </div>
                <div className="admin-settings-item">
                  <div className="small text-body-secondary">Webhook URL</div>
                  <div className="fw-semibold admin-domain-pill">{client.webhookUrl || "Not configured"}</div>
                </div>
                {client.enterpriseRequests?.length ? (
                  <div className="admin-settings-item">
                    <div className="small text-body-secondary">Latest enterprise request</div>
                    <div className="fw-semibold">{client.enterpriseRequests[0].requestedByName}</div>
                    <div className="small text-body-secondary">{client.enterpriseRequests[0].message}</div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "company" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <h2 className="h5 fw-semibold mb-1">Company settings</h2>
            <p className="small text-body-secondary mb-0">Store company identity and support information.</p>
          </div>
          <div className="card-body">
            <Formik
              initialValues={{
                name: client.name,
                industry: client.industry,
                supportEmail: client.supportEmail,
                companyPhone: client.companyPhone || "",
                companyAddress: client.companyAddress || "",
                status: client.status,
                csm: client.csm,
              }}
              enableReinitialize
              validationSchema={Yup.object({
                name: Yup.string().required("Company name is required."),
                industry: Yup.string().required("Industry is required."),
                supportEmail: Yup.string().email("Use a valid support email.").required("Support email is required."),
                companyPhone: Yup.string().trim().matches(/^\d{7,15}$/, { message: "Enter a valid phone number (digits only).", excludeEmptyString: true }),
              })}
              onSubmit={async (values, { setErrors }) => saveSection("company", values, setErrors)}
            >
              {({ values, setFieldValue }) => (
                <Form>
                  <div className="admin-form-grid">
                    <div>
                      <label htmlFor="company-name" className="form-label">Company name</label>
                      <Field name="name" id="company-name" className="form-control" />
                      <ErrorMessage name="name" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="company-industry" className="form-label">Industry</label>
                      <Field name="industry" id="company-industry" className="form-control" />
                      <ErrorMessage name="industry" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="company-supportEmail" className="form-label">Support email</label>
                      <Field name="supportEmail" id="company-supportEmail" className="form-control" />
                      <ErrorMessage name="supportEmail" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="company-phone" className="form-label">Company phone</label>
                      <Field
                        name="companyPhone"
                        id="company-phone"
                        className="form-control"
                        inputMode="numeric"
                        value={values.companyPhone}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          void setFieldValue("companyPhone", sanitizePhoneInput(e.target.value))
                        }
                      />
                      <ErrorMessage name="companyPhone" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="company-address" className="form-label">Company address</label>
                      <Field name="companyAddress" id="company-address" className="form-control" />
                    </div>
                    <div>
                      <label htmlFor="company-status" className="form-label">Status</label>
                      <Field as="select" name="status" id="company-status" className="form-select">
                        <option value="active">Active</option>
                        <option value="trial">Trial</option>
                        <option value="inactive">Inactive</option>
                      </Field>
                    </div>
                    <div>
                      <label htmlFor="company-csm" className="form-label">CSM</label>
                      <Field name="csm" id="company-csm" className="form-control" />
                    </div>
                  </div>
                  <div className="d-flex justify-content-end pt-3">
                    <button type="submit" className="btn btn-primary" disabled={savingSection === "company"}>
                      {savingSection === "company" ? "Saving..." : "Save company settings"}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "clientAdmin" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <h2 className="h5 fw-semibold mb-1">Client admin access</h2>
            <p className="small text-body-secondary mb-0">Manage the first client admin identity and default admin permissions.</p>
          </div>
          <div className="card-body">
            <Formik
              initialValues={{
                firstUserName: client.firstUserName || "",
                firstUserEmail: client.firstUserEmail || "",
                clientAdminPermission: client.clientAdminPermission || adminDefaults,
              }}
              enableReinitialize
              validationSchema={Yup.object({
                firstUserName: Yup.string().required("Name is required."),
                firstUserEmail: Yup.string().email("Use a valid email address.").required("Email is required."),
                clientAdminPermission: Yup.array().of(Yup.string()).min(1, "Select at least one permission."),
              })}
              onSubmit={async (values, { setErrors }) => saveSection("clientAdmin", values, setErrors)}
            >
              {({ values, setFieldValue }) => (
                <Form>
                  <div className="admin-form-grid mb-4">
                    <div>
                      <label htmlFor="client-admin-name" className="form-label">Client admin name</label>
                      <Field name="firstUserName" id="client-admin-name" className="form-control" />
                      <ErrorMessage name="firstUserName" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="client-admin-email" className="form-label">Client admin email</label>
                      <Field name="firstUserEmail" id="client-admin-email" className="form-control" />
                      <ErrorMessage name="firstUserEmail" component="small" className="text-danger" />
                    </div>
                    <div>
                      <div className="alert alert-light border mb-0">
                        Password changes are handled by secure email links from the user list.
                      </div>
                    </div>
                  </div>

                  <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                    <div>
                      <h5 className="mb-1">Client admin permissions</h5>
                      <p className="text-body-secondary small mb-0">
                        These permissions become the tenant default for client admins.
                      </p>
                    </div>
                    <span className="badge text-bg-primary">{values.clientAdminPermission.length} selected</span>
                  </div>

                  <PermissionMatrix
                    modules={clientAdminModules}
                    baselinePermissions={adminDefaults}
                    selectedPermissions={values.clientAdminPermission}
                    onChange={(permission) => setFieldValue("clientAdminPermission", permission)}
                  />
                  <ErrorMessage name="clientAdminPermission" component="small" className="text-danger d-block mt-2" />

                  <div className="d-flex justify-content-end gap-2 pt-3">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={actionLoading === "clientAdminEmail"}
                      onClick={() =>
                        void runAction(
                          "clientAdminEmail",
                          AxiosHelper.postData<{ result?: ActionResponse }, Record<string, never>>(
                            `/clients/${clientId}/client-admin/password-email`,
                            {},
                          ),
                        )
                      }
                    >
                      <i className="ri-mail-send-line me-1" />
                      {actionLoading === "clientAdminEmail" ? "Sending..." : "Resend password email"}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={savingSection === "clientAdmin"}>
                      {savingSection === "clientAdmin" ? "Saving..." : "Save client admin access"}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "domain" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <h2 className="h5 fw-semibold mb-1">Domain settings</h2>
            <p className="small text-body-secondary mb-0">Configure delivery domains and iframe availability.</p>
          </div>
          <div className="card-body">
            <Formik
              initialValues={{
                domain: client.domain,
                subdomain: client.subdomain,
                iframeEnabled: client.iframeEnabled,
              }}
              enableReinitialize
              validationSchema={Yup.object({
                subdomain: Yup.string().required("Subdomain is required."),
              })}
              onSubmit={async (values, { setErrors }) => saveSection("domain", values, setErrors)}
            >
              <Form>
                <div className="admin-form-grid">
                  <div>
                    <label htmlFor="domain" className="form-label">Custom domain</label>
                    <Field name="domain" id="domain" className="form-control" />
                    <ErrorMessage name="domain" component="small" className="text-danger" />
                  </div>
                  <div>
                    <label htmlFor="subdomain" className="form-label">Subdomain</label>
                    <Field name="subdomain" id="subdomain" className="form-control" />
                    <ErrorMessage name="subdomain" component="small" className="text-danger" />
                  </div>
                </div>
                <div className="form-check mt-3">
                  <Field type="checkbox" name="iframeEnabled" id="iframeEnabled" className="form-check-input" />
                  <label htmlFor="iframeEnabled" className="form-check-label">
                    Enable iframe delivery for this client
                  </label>
                </div>
                <div className="border rounded p-3 mt-3">
                  <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
                    <div>
                      <h3 className="h6 fw-semibold mb-1">Verification status</h3>
                      <p className="small text-body-secondary mb-2">Add the TXT record below in client DNS, then run verification.</p>
                    </div>
                    <span className={`badge ${client.domainStatus === "verified" ? "text-bg-success" : "text-bg-warning"}`}>{client.domainStatus}</span>
                  </div>
                  <div className="small text-body-secondary mb-1">TXT host</div>
                  <div className="form-control bg-light mb-2">{client.domainVerificationHost}.{client.domain || "client-domain.com"}</div>
                  <div className="small text-body-secondary mb-1">TXT value</div>
                  <div className="form-control bg-light mb-2">trainup-verify={client.domainVerificationToken || "save the domain first"}</div>
                  <div className="small text-body-secondary mb-3">{client.domainLastCheckedResult || "No verification check has been run yet."}</div>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => void runAction("domain", AxiosHelper.postData<{ client: ClientRecord; result: ActionResponse }, Record<string, never>>(`/clients/${clientId}/domain-verify`, {}))}
                    disabled={actionLoading === "domain" || !client.domain}
                  >
                    {actionLoading === "domain" ? "Checking..." : "Verify domain now"}
                  </button>
                </div>
                <div className="d-flex justify-content-end pt-3">
                  <button type="submit" className="btn btn-primary" disabled={savingSection === "domain"}>
                    {savingSection === "domain" ? "Saving..." : "Save domain settings"}
                  </button>
                </div>
              </Form>
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "whitelabel" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <h2 className="h5 fw-semibold mb-1">White-labeling</h2>
            <p className="small text-body-secondary mb-0">Define client-facing app identity and brand assets.</p>
          </div>
          <div className="card-body">
            <Formik
              initialValues={{
                applicationName: client.applicationName || client.name,
                primaryColor: client.primaryColor || "#1428a0",
                secondaryColor: client.secondaryColor || "#3e60d5",
                logoUrl: client.logoUrl || "",
                darkLogoUrl: client.darkLogoUrl || "",
                faviconUrl: client.faviconUrl || "",
              }}
              enableReinitialize
              onSubmit={async (values, { setErrors }) => {
                const assetErrors = {
                  logoUrl: await validateBrandAssetSource(values.logoUrl, "Logo"),
                  darkLogoUrl: await validateBrandAssetSource(values.darkLogoUrl, "Dark logo"),
                  faviconUrl: await validateBrandAssetSource(values.faviconUrl, "Favicon"),
                };

                if (assetErrors.logoUrl || assetErrors.darkLogoUrl || assetErrors.faviconUrl) {
                  setErrors(assetErrors);
                  toast.error("Please fix the white-label asset errors before saving.");
                  return;
                }

                await saveSection("whitelabel", values, setErrors);
              }}
            >
              {({ values, errors, setFieldError, setFieldValue }) => (
                <Form>
                  <div className="whitelabel-form-stack">
                    <div className="whitelabel-field-full">
                      <label htmlFor="applicationName" className="form-label">Application name</label>
                      <Field name="applicationName" id="applicationName" className="form-control" />
                    </div>
                    <div className="whitelabel-color-grid">
                      <div className="whitelabel-color-field">
                        <label htmlFor="primaryColor" className="form-label">Primary color</label>
                        <div className="input-group">
                          <Field type="color" name="primaryColor" id="primaryColor" className="form-control form-control-color" />
                          <Field name="primaryColor" className="form-control" />
                        </div>
                      </div>
                      <div className="whitelabel-color-field">
                        <label htmlFor="secondaryColor" className="form-label">Secondary color</label>
                        <div className="input-group">
                          <Field type="color" name="secondaryColor" id="secondaryColor" className="form-control form-control-color" />
                          <Field name="secondaryColor" className="form-control" />
                        </div>
                      </div>
                    </div>
                    <div className="whitelabel-asset-list">
                      <BrandAssetInput
                        id="logoUrl"
                        label="Light logo"
                        value={values.logoUrl}
                        error={typeof errors.logoUrl === "string" ? errors.logoUrl : ""}
                        onChange={(value) => setFieldValue("logoUrl", value)}
                        onErrorClear={() => setFieldError("logoUrl", "")}
                      />
                      <BrandAssetInput
                        id="darkLogoUrl"
                        label="Dark logo"
                        value={values.darkLogoUrl}
                        error={typeof errors.darkLogoUrl === "string" ? errors.darkLogoUrl : ""}
                        onChange={(value) => setFieldValue("darkLogoUrl", value)}
                        onErrorClear={() => setFieldError("darkLogoUrl", "")}
                      />
                      <BrandAssetInput
                        id="faviconUrl"
                        label="Favicon"
                        value={values.faviconUrl}
                        error={typeof errors.faviconUrl === "string" ? errors.faviconUrl : ""}
                        accept="image/*,.ico"
                        previewSize={40}
                        onChange={(value) => setFieldValue("faviconUrl", value)}
                        onErrorClear={() => setFieldError("faviconUrl", "")}
                      />
                    </div>
                  </div>
                  <div className="d-flex justify-content-end pt-3">
                    <button type="submit" className="btn btn-primary" disabled={savingSection === "whitelabel"}>
                      {savingSection === "whitelabel" ? "Saving..." : "Save white-label settings"}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "integrations" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <h2 className="h5 fw-semibold mb-1">Integrations</h2>
            <p className="small text-body-secondary mb-0">SSO, webhook, API scope, and iframe domain controls.</p>
          </div>
          <div className="card-body">
            <Formik
              initialValues={{
                ssoType: client.ssoType,
                ssoProviderType: client.ssoProviderType || "none",
                ssoClientId: client.ssoClientId || "",
                ssoClientSecret: client.ssoClientSecret || "",
                ssoTenantId: client.ssoTenantId || "",
                ssoIssuerUrl: client.ssoIssuerUrl || "",
                ssoEntryPoint: client.ssoEntryPoint || "",
                ssoAudience: client.ssoAudience || "",
                ssoRedirectUri: client.ssoRedirectUri || "",
                ssoButtonLabel: client.ssoButtonLabel || "",
                ssoAllowedDomains: (client.ssoAllowedDomains || []).join("\n"),
                ssoAutoProvisionUsers: client.ssoAutoProvisionUsers ?? true,
                webhookUrl: client.webhookUrl,
                webhookSigningSecret: client.webhookSigningSecret || "",
                apiScope: client.apiScope,
                allowedOrigins: (client.allowedOrigins || []).join("\n"),
                iframeEnabled: client.iframeEnabled,
                iframeBaseUrl: client.iframeBaseUrl || "",
                iframeAllowedParentDomains: (client.iframeAllowedParentDomains || []).join("\n"),
                ltiClientId: client.ltiClientId || "",
                ltiDeploymentId: client.ltiDeploymentId || "",
                ltiPlatformKeysetUrl: client.ltiPlatformKeysetUrl || "",
                ltiAccessTokenUrl: client.ltiAccessTokenUrl || "",
                ltiOidcAuthUrl: client.ltiOidcAuthUrl || "",
                scormEnabled: client.scormEnabled !== false,
                xapiEnabled: client.xapiEnabled ?? false,
                xapiLrsEndpoint: client.xapiLrsEndpoint || "",
                xapiClientId: client.xapiClientId || "",
                xapiClientSecret: client.xapiClientSecret || "",
              }}
              enableReinitialize
              onSubmit={async (values, { setErrors }) => saveSection("integrations", values, setErrors)}
            >
              <Form>
                {/* Method selector dropdown */}
                <div className="mb-4">
                  <label htmlFor="selectedMethod" className="form-label fw-semibold text-primary">
                    <i className="ri-list-settings-line me-1"></i>Please select integration method:
                  </label>
                  <select
                    id="selectedMethod"
                    className="form-select border-primary"
                    style={{ maxWidth: "400px" }}
                    value={selectedMethod}
                    onChange={(e) => setSelectedMethod(e.target.value)}
                  >
                    <option value="all">Show All Methods</option>
                    <option value="method_a">Method A: Embed / iFrame Settings</option>
                    <option value="method_b">Method B: LTI 1.3 Tool Configuration</option>
                    <option value="method_c">Method C: SCORM Delivery Settings</option>
                    <option value="method_d">Method D: xAPI (Tin Can) / LRS Delivery</option>
                    <option value="method_e">Method E: REST API, Webhooks & SSO</option>
                  </select>
                </div>

                {/* Method A: Embed / iFrame Settings */}
                {(selectedMethod === "all" || selectedMethod === "method_a") && (
                  <div className="card mb-4 border-light-subtle">
                    <div className="card-header bg-light-subtle py-2">
                      <h3 className="h6 mb-0 fw-semibold text-primary">
                        <i className="ri-window-line me-2"></i>Method A: Embed / iFrame Settings
                      </h3>
                    </div>
                    <div className="card-body p-3">
                      <p className="small text-body-secondary mb-3">
                        Configure who can securely frame your TrainUp tenant and which domains are allowed origins.
                      </p>
                      <div className="form-check form-switch mb-3">
                        <Field type="checkbox" name="iframeEnabled" id="detail-iframeEnabled" className="form-check-input" />
                        <label htmlFor="detail-iframeEnabled" className="form-check-label fw-medium">
                          Enable iframe delivery
                        </label>
                      </div>
                      <div className="admin-form-grid">
                        <div>
                          <label htmlFor="detail-iframeBaseUrl" className="form-label">iFrame base URL</label>
                          <Field name="iframeBaseUrl" id="detail-iframeBaseUrl" className="form-control" placeholder="https://..." />
                          <ErrorMessage name="iframeBaseUrl" component="small" className="text-danger" />
                        </div>
                        <div>
                          <label htmlFor="detail-iframeAllowedParentDomains" className="form-label">Allowed parent domains (one per line)</label>
                          <Field as="textarea" rows={3} name="iframeAllowedParentDomains" id="detail-iframeAllowedParentDomains" className="form-control" placeholder="example.com&#10;another.com" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="detail-allowedOrigins" className="form-label">Allowed origins (CORS, one per line)</label>
                          <Field as="textarea" rows={2} name="allowedOrigins" id="detail-allowedOrigins" className="form-control" placeholder="https://example.com" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Method B: LTI 1.3 Tool Registration */}
                {(selectedMethod === "all" || selectedMethod === "method_b") && (
                  <div className="card mb-4 border-light-subtle">
                    <div className="card-header bg-light-subtle py-2">
                      <h3 className="h6 mb-0 fw-semibold text-primary">
                        <i className="ri-shield-user-line me-2"></i>Method B: LTI 1.3 Tool Configuration
                      </h3>
                    </div>
                    <div className="card-body p-3">
                      <p className="small text-body-secondary mb-3">
                        Register TrainUp as an LTI 1.3 Tool inside Canvas, Moodle, Blackboard, etc.
                      </p>
                      <div className="admin-form-grid">
                        <div>
                          <label htmlFor="detail-ltiClientId" className="form-label">LTI Client ID</label>
                          <Field name="ltiClientId" id="detail-ltiClientId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ltiDeploymentId" className="form-label">LTI Deployment ID</label>
                          <Field name="ltiDeploymentId" id="detail-ltiDeploymentId" className="form-control" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="detail-ltiPlatformKeysetUrl" className="form-label">Platform Keyset URL</label>
                          <Field name="ltiPlatformKeysetUrl" id="detail-ltiPlatformKeysetUrl" className="form-control" placeholder="https://..." />
                        </div>
                        <div>
                          <label htmlFor="detail-ltiOidcAuthUrl" className="form-label">OIDC Auth URL</label>
                          <Field name="ltiOidcAuthUrl" id="detail-ltiOidcAuthUrl" className="form-control" placeholder="https://..." />
                        </div>
                        <div>
                          <label htmlFor="detail-ltiAccessTokenUrl" className="form-label">Access Token URL</label>
                          <Field name="ltiAccessTokenUrl" id="detail-ltiAccessTokenUrl" className="form-control" placeholder="https://..." />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Method C: SCORM Settings */}
                {(selectedMethod === "all" || selectedMethod === "method_c") && (
                  <div className="card mb-4 border-light-subtle">
                    <div className="card-header bg-light-subtle py-2">
                      <h3 className="h6 mb-0 fw-semibold text-primary">
                        <i className="ri-archive-line me-2"></i>Method C: SCORM Delivery Settings
                      </h3>
                    </div>
                    <div className="card-body p-3">
                      <p className="small text-body-secondary mb-3">
                        Allow downloading light SCORM wrappers that run TrainUp inside the LMS while streaming analytics back.
                      </p>
                      <div className="form-check form-switch">
                        <Field type="checkbox" name="scormEnabled" id="detail-scormEnabled" className="form-check-input" />
                        <label htmlFor="detail-scormEnabled" className="form-check-label fw-medium">
                          Enable SCORM wrapper generation and packaging
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Method D: xAPI / LRS Analytics */}
                {(selectedMethod === "all" || selectedMethod === "method_d") && (
                  <div className="card mb-4 border-light-subtle">
                    <div className="card-header bg-light-subtle py-2">
                      <h3 className="h6 mb-0 fw-semibold text-primary">
                        <i className="ri-bubble-chart-line me-2"></i>Method D: xAPI (Tin Can) / LRS Delivery
                      </h3>
                    </div>
                    <div className="card-body p-3">
                      <p className="small text-body-secondary mb-3">
                        Push detailed proctoring, AI Ask interactions, and completion statements to an external Learning Record Store (LRS).
                      </p>
                      <div className="form-check form-switch mb-3">
                        <Field type="checkbox" name="xapiEnabled" id="detail-xapiEnabled" className="form-check-input" />
                        <label htmlFor="detail-xapiEnabled" className="form-check-label fw-medium">
                          Enable xAPI statement delivery
                        </label>
                      </div>
                      <div className="admin-form-grid">
                        <div className="admin-form-grid-full">
                          <label htmlFor="detail-xapiLrsEndpoint" className="form-label">LRS Endpoint URL</label>
                          <Field name="xapiLrsEndpoint" id="detail-xapiLrsEndpoint" className="form-control" placeholder="https://..." />
                        </div>
                        <div>
                          <label htmlFor="detail-xapiClientId" className="form-label">LRS Auth Client ID / Username</label>
                          <Field name="xapiClientId" id="detail-xapiClientId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-xapiClientSecret" className="form-label">LRS Auth Client Secret / Password</label>
                          <Field name="xapiClientSecret" id="detail-xapiClientSecret" className="form-control" type="password" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Method E: REST API, Webhooks & Identity */}
                {(selectedMethod === "all" || selectedMethod === "method_e") && (
                  <div className="card mb-4 border-light-subtle">
                    <div className="card-header bg-light-subtle py-2">
                      <h3 className="h6 mb-0 fw-semibold text-primary">
                        <i className="ri-plug-line me-2"></i>Method E: REST API, Webhooks & SSO
                      </h3>
                    </div>
                    <div className="card-body p-3">
                      <p className="small text-body-secondary mb-3">
                        Bespoke integration for custom/personal LMS portals using standard developer keys, webhooks, and federated SSO.
                      </p>
                      <h4 className="h6 text-primary fw-semibold border-bottom pb-1 mb-3">API & Webhooks</h4>
                      <div className="admin-form-grid mb-4">
                        <div>
                          <label htmlFor="detail-webhookUrl" className="form-label">Webhook URL</label>
                          <Field name="webhookUrl" id="detail-webhookUrl" className="form-control" placeholder="https://..." />
                          <ErrorMessage name="webhookUrl" component="small" className="text-danger" />
                        </div>
                        <div>
                          <label htmlFor="detail-apiScope" className="form-label">API Scope</label>
                          <Field name="apiScope" id="detail-apiScope" className="form-control" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="detail-webhookSigningSecret" className="form-label">Signing secret</label>
                          <Field name="webhookSigningSecret" id="detail-webhookSigningSecret" className="form-control" placeholder="whsec_..." />
                          <small className="text-body-secondary">Used to HMAC-sign result webhooks (x-trainup-signature) so the receiver can verify them.</small>
                        </div>
                      </div>

                      <h4 className="h6 text-primary fw-semibold border-bottom pb-1 mb-3">SSO Identity Configuration</h4>
                      <div className="admin-form-grid">
                        <div>
                          <label htmlFor="detail-ssoType" className="form-label">SSO type</label>
                          <Field as="select" name="ssoType" id="detail-ssoType" className="form-select">
                            <option value="Trainup IAM">Trainup IAM</option>
                            <option value="Azure AD">Azure AD</option>
                            <option value="Google Workspace">Google Workspace</option>
                            <option value="Okta">Okta</option>
                            <option value="None">None</option>
                          </Field>
                        </div>
                        <div>
                          <label htmlFor="detail-ssoProviderType" className="form-label">SSO provider type</label>
                          <Field as="select" name="ssoProviderType" id="detail-ssoProviderType" className="form-select">
                            <option value="none">None</option>
                            <option value="oidc">OIDC / OAuth</option>
                            <option value="saml">SAML</option>
                          </Field>
                        </div>
                        <div>
                          <label htmlFor="detail-ssoClientId" className="form-label">SSO client ID</label>
                          <Field name="ssoClientId" id="detail-ssoClientId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoClientSecret" className="form-label">SSO client secret</label>
                          <Field name="ssoClientSecret" id="detail-ssoClientSecret" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoTenantId" className="form-label">SSO tenant / directory ID</label>
                          <Field name="ssoTenantId" id="detail-ssoTenantId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoIssuerUrl" className="form-label">Issuer URL</label>
                          <Field name="ssoIssuerUrl" id="detail-ssoIssuerUrl" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoEntryPoint" className="form-label">Entry point / login URL</label>
                          <Field name="ssoEntryPoint" id="detail-ssoEntryPoint" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoAudience" className="form-label">Audience / entity ID</label>
                          <Field name="ssoAudience" id="detail-ssoAudience" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoRedirectUri" className="form-label">Redirect URI</label>
                          <Field name="ssoRedirectUri" id="detail-ssoRedirectUri" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="detail-ssoButtonLabel" className="form-label">SSO button label</label>
                          <Field name="ssoButtonLabel" id="detail-ssoButtonLabel" className="form-control" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="detail-ssoAllowedDomains" className="form-label">Allowed SSO email domains (one per line)</label>
                          <Field as="textarea" rows={2} name="ssoAllowedDomains" id="detail-ssoAllowedDomains" className="form-control" />
                        </div>
                      </div>
                      <div className="form-check mt-3">
                        <Field type="checkbox" name="ssoAutoProvisionUsers" id="detail-ssoAutoProvisionUsers" className="form-check-input" />
                        <label htmlFor="detail-ssoAutoProvisionUsers" className="form-check-label fw-medium">
                          Auto-create learner accounts after successful SSO
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                <div className="small text-body-secondary mt-3">{client.lastWebhookTestMessage || "No webhook test has been run yet."}</div>
                <div className="d-flex justify-content-between gap-2 pt-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => void runAction("webhook", AxiosHelper.postData<{ client: ClientRecord; result: ActionResponse }, Record<string, never>>(`/clients/${clientId}/webhook-test`, {}))}
                    disabled={actionLoading === "webhook" || !client.webhookUrl}
                  >
                    {actionLoading === "webhook" ? "Sending..." : "Send webhook test"}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingSection === "integrations"}>
                    {savingSection === "integrations" ? "Saving..." : "Save integrations"}
                  </button>
                </div>
              </Form>
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "smtp" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0">
            <h2 className="h5 fw-semibold mb-1">SMTP</h2>
            <p className="small text-body-secondary mb-0">Email sender and SMTP relay settings for this client.</p>
          </div>
          <div className="card-body">
            <Formik
              initialValues={{
                emailDeliveryEnabled: client.emailDeliveryEnabled || false,
                smtpHost: client.smtpHost || "",
                smtpPort: client.smtpPort || 587,
                smtpUsername: client.smtpUsername || "",
                smtpPassword: client.smtpPassword || "",
                smtpFromName: client.smtpFromName || "",
                smtpFromEmail: client.smtpFromEmail || "",
                smtpSecure: client.smtpSecure || false,
                smtpTestRecipient: client.smtpTestRecipient || "",
              }}
              enableReinitialize
              onSubmit={async (values, { setErrors }) => saveSection("smtp", values, setErrors)}
            >
              <Form>
                <div className="form-check mb-3">
                  <Field type="checkbox" name="emailDeliveryEnabled" id="smtpEnabled" className="form-check-input" />
                  <label htmlFor="smtpEnabled" className="form-check-label">Enable invite and training-share emails for this client</label>
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
                    <label htmlFor="smtpFromName" className="form-label">From name</label>
                    <Field name="smtpFromName" id="smtpFromName" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="smtpFromEmail" className="form-label">From email</label>
                    <Field name="smtpFromEmail" id="smtpFromEmail" className="form-control" />
                    <ErrorMessage name="smtpFromEmail" component="small" className="text-danger" />
                  </div>
                  <div>
                    <label htmlFor="smtpTestRecipient" className="form-label">Test recipient</label>
                    <Field name="smtpTestRecipient" id="smtpTestRecipient" className="form-control" />
                  </div>
                </div>
                <div className="form-check mt-3">
                  <Field type="checkbox" name="smtpSecure" id="smtpSecure" className="form-check-input" />
                  <label htmlFor="smtpSecure" className="form-check-label">
                    Use secure SMTP
                  </label>
                </div>
                <div className="small text-body-secondary mt-3">{client.lastSmtpTestMessage || "No SMTP test has been run yet."}</div>
                <div className="d-flex justify-content-between gap-2 pt-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => void runAction("smtp", AxiosHelper.postData<{ client: ClientRecord; result: ActionResponse }, { recipient: string }>(`/clients/${clientId}/smtp-test`, { recipient: client.smtpTestRecipient || client.firstUserEmail || "" }))}
                    disabled={actionLoading === "smtp" || !client.emailDeliveryEnabled}
                  >
                    {actionLoading === "smtp" ? "Sending..." : "Send SMTP test"}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingSection === "smtp"}>
                    {savingSection === "smtp" ? "Saving..." : "Save SMTP settings"}
                  </button>
                </div>
              </Form>
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "billing" ? (
        <div className="row g-3">
          <div className="col-12 col-xl-8">
            <div className="card h-100">
              <div className="card-header bg-transparent border-0 pb-0">
                <h2 className="h5 fw-semibold mb-1">Plan and credits</h2>
                <p className="small text-body-secondary mb-0">
                  Assign the monthly package, review current credit usage, and top up the company when needed.
                </p>
              </div>
              <div className="card-body">
                {client.billing ? (
                  <div className="mb-4">
                    <h3 className="h6 fw-semibold mb-2">
                      Subscription overview <span className="small text-body-secondary fw-normal">(client&apos;s live billing view)</span>
                    </h3>
                    <div className="row g-2 mb-3">
                      <div className="col-6 col-md-3">
                        <div className="border rounded p-2 h-100">
                          <div className="small text-body-secondary">Current plan</div>
                          <div className="fw-semibold">
                            {planLabels[client.billing.currentPlan] ?? client.billing.currentPlan}
                            {client.billing.planExpired ? (
                              <span className="badge text-bg-danger ms-2">Expired</span>
                            ) : (
                              <span className="badge text-bg-success ms-2">Active</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <div className="border rounded p-2 h-100">
                          <div className="small text-body-secondary">Purchase / start date</div>
                          <div className="fw-semibold">{client.billing.startedOn ? new Date(client.billing.startedOn).toLocaleDateString() : "—"}</div>
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <div className="border rounded p-2 h-100">
                          <div className="small text-body-secondary">Expiry date</div>
                          <div className={`fw-semibold ${client.billing.planExpired ? "text-danger" : ""}`}>
                            {client.billing.expiresOn ? new Date(client.billing.expiresOn).toLocaleDateString() : "—"}
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <div className="border rounded p-2 h-100">
                          <div className="small text-body-secondary">Available / total credits</div>
                          <div className={`fw-semibold ${client.billing.planExpired ? "text-danger" : ""}`}>
                            {Number(client.billing.availableCredits ?? 0).toLocaleString()} / {Number(client.billing.totalCredits ?? 0).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="small fw-semibold text-body-secondary mb-1">Purchase history</div>
                    {client.billing.recentTransactions?.length ? (
                      <div className="table-responsive">
                        <table className="table table-sm align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Plan</th>
                              <th className="text-end">Credits</th>
                              <th className="text-end">Amount</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {client.billing.recentTransactions.map((t, i) => (
                              <tr key={t.id ?? t.invoiceId ?? i}>
                                <td>{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}</td>
                                <td className="text-capitalize">{(t.type ?? "").replace(/_/g, " ") || "—"}</td>
                                <td>{t.planCode ?? "—"}</td>
                                <td className="text-end">{t.credits != null ? Number(t.credits).toLocaleString() : "—"}</td>
                                <td className="text-end">{t.amount != null ? `${client.billing?.billingCurrency ?? "INR"} ${Number(t.amount).toLocaleString()}` : "—"}</td>
                                <td><span className="badge text-bg-light border text-capitalize">{t.status ?? "—"}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="small text-body-secondary mb-0">No purchase history yet.</p>
                    )}
                    <hr className="my-4" />
                  </div>
                ) : null}
                <Formik
                  initialValues={{
                    plan: client.plan,
                    extraCredits: 0,
                    paymentProvider: client.paymentProvider || "razorpay",
                    paymentMode: "test",
                    billingCurrency: client.billingCurrency || "INR",
                    razorpayKeyId: client.razorpayKeyId || "",
                    razorpayKeySecret: client.razorpayKeySecret || "",
                    enterpriseMonthlyPrice: client.enterpriseMonthlyPrice || 0,
                    enterpriseMonthlyCredits: client.enterpriseMonthlyCredits || 40000,
                    enterpriseSupportNotes: client.enterpriseSupportNotes || "",
                    creditCostOverrides: {
                      training: client.creditCostOverrides?.training ?? "",
                      session: client.creditCostOverrides?.session ?? "",
                      user: client.creditCostOverrides?.user ?? "",
                    },
                  }}
                  enableReinitialize
                  validationSchema={Yup.object({
                    plan: Yup.string().required("Plan is required."),
                    extraCredits: Yup.number().min(0, "Credits cannot be negative."),
                  })}
                  onSubmit={async (values, { resetForm, setErrors }) => {
                    await saveSection("billing", values as Record<string, unknown>, setErrors);
                    resetForm({
                      values: {
                        plan: values.plan,
                        extraCredits: 0,
                        paymentProvider: values.paymentProvider,
                        paymentMode: values.paymentMode,
                        billingCurrency: values.billingCurrency,
                        razorpayKeyId: values.razorpayKeyId,
                        razorpayKeySecret: values.razorpayKeySecret,
                        enterpriseMonthlyPrice: values.enterpriseMonthlyPrice,
                        enterpriseMonthlyCredits: values.enterpriseMonthlyCredits,
                        enterpriseSupportNotes: values.enterpriseSupportNotes,
                        creditCostOverrides: values.creditCostOverrides,
                      },
                    });
                  }}
                >
                  <Form className="admin-billing-stack">
                    <div className="admin-billing-summary-grid">
                      <div className="admin-billing-summary-card">
                        <span>Current plan</span>
                        <strong>
                          {planLabels[client.plan] ?? client.plan}
                          {client.planExpired ? <span className="badge text-bg-danger ms-2">Expired</span> : null}
                        </strong>
                        <small>
                          {client.planExpired
                            ? "Subscription expired — renew to restore credits"
                            : client.expiresOn
                              ? `Renews ${new Date(client.expiresOn).toLocaleDateString()}`
                              : "Monthly billing"}
                        </small>
                      </div>
                      <div className="admin-billing-summary-card">
                        <span>Available credits</span>
                        <strong className={client.planExpired ? "text-danger" : undefined}>
                          {client.planExpired ? 0 : Math.max(Number(client.totalCredits ?? 0) - Number(client.usedCredits ?? 0), 0)}
                        </strong>
                        <small>Ready for training usage</small>
                      </div>
                      <div className="admin-billing-summary-card">
                        <span>Used credits</span>
                        <strong>{Number(client.usedCredits ?? 0)}</strong>
                        <small>Consumed this cycle</small>
                      </div>
                      <div className="admin-billing-summary-card">
                        <span>Total credit pool</span>
                        <strong>{Number(client.totalCredits ?? 0)}</strong>
                        <small>Monthly + purchased</small>
                      </div>
                    </div>

                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="billing-plan" className="form-label">Package plan</label>
                        <Field as="select" name="plan" id="billing-plan" className="form-select">
                          <option value="FREE">Free</option>
                          <option value="PRO">Pro</option>
                          <option value="ENTERPRISE">Enterprise</option>
                        </Field>
                        <ErrorMessage name="plan" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="billing-extra-credits" className="form-label">Extra credits</label>
                        <Field
                          name="extraCredits"
                          id="billing-extra-credits"
                          type="number"
                          min="0"
                          step="100"
                          className="form-control"
                        />
                        <ErrorMessage name="extraCredits" component="small" className="text-danger" />
                        <div className="form-text">Use this for manual top-ups outside the default monthly package.</div>
                      </div>
                      <div>
                        <label htmlFor="billing-paymentProvider" className="form-label">Payment provider</label>
                        <Field as="select" name="paymentProvider" id="billing-paymentProvider" className="form-select">
                          <option value="razorpay">Razorpay</option>
                        </Field>
                      </div>
                      <div>
                        <label htmlFor="billing-paymentMode" className="form-label">Payment mode</label>
                        <Field name="paymentMode" id="billing-paymentMode" className="form-control" disabled />
                        <div className="form-text">Live collection stays disabled. Sandbox mode only.</div>
                      </div>
                      <div>
                        <label htmlFor="billing-billingCurrency" className="form-label">Currency</label>
                        <Field name="billingCurrency" id="billing-billingCurrency" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="billing-razorpayKeyId" className="form-label">Razorpay test key ID</label>
                        <Field name="razorpayKeyId" id="billing-razorpayKeyId" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="billing-razorpayKeySecret" className="form-label">Razorpay test key secret</label>
                        <Field name="razorpayKeySecret" id="billing-razorpayKeySecret" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="billing-enterpriseMonthlyPrice" className="form-label">Enterprise monthly price</label>
                        <Field name="enterpriseMonthlyPrice" id="billing-enterpriseMonthlyPrice" type="number" min="0" className="form-control" />
                        <div className="form-text">Use this when the enterprise plan is assigned after support discussion.</div>
                      </div>
                      <div>
                        <label htmlFor="billing-enterpriseMonthlyCredits" className="form-label">Enterprise monthly credits</label>
                        <Field name="enterpriseMonthlyCredits" id="billing-enterpriseMonthlyCredits" type="number" min="0" className="form-control" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label htmlFor="billing-enterpriseSupportNotes" className="form-label">Enterprise support notes</label>
                        <Field as="textarea" rows={4} name="enterpriseSupportNotes" id="billing-enterpriseSupportNotes" className="form-control" />
                      </div>
                    </div>

                    <div className="d-flex justify-content-end pt-2">
                      <button type="submit" className="btn btn-primary" disabled={savingSection === "billing"}>
                        {savingSection === "billing" ? "Saving..." : "Save billing setup"}
                      </button>
                    </div>
                  </Form>
                </Formik>
              </div>
            </div>
          </div>

          <div className="col-12 col-xl-4">
            <div className="card h-100">
              <div className="card-header bg-transparent border-0 pb-0">
                <h2 className="h5 fw-semibold mb-1">Credit rules</h2>
                <p className="small text-body-secondary mb-0">Current package limits and per-action deductions.</p>
              </div>
              <div className="card-body admin-settings-list">
                <div className="admin-settings-item d-flex align-items-center justify-content-between">
                  <span className="small text-body-secondary">Monthly credits</span>
                  <span className="fw-semibold">{Number(client.monthlyCredits ?? 0)}</span>
                </div>
                <div className="admin-settings-item d-flex align-items-center justify-content-between">
                  <span className="small text-body-secondary">Enterprise monthly price</span>
                  <span className="fw-semibold">{Number(client.enterpriseMonthlyPrice ?? 0) ? `Rs. ${Number(client.enterpriseMonthlyPrice ?? 0).toLocaleString()}` : "Custom"}</span>
                </div>
                <div className="admin-settings-item d-flex align-items-center justify-content-between">
                  <span className="small text-body-secondary">Per training create</span>
                  <span className="fw-semibold">{Number(client.trainingCreditCost ?? 500)} credits</span>
                </div>
                <div className="admin-settings-item d-flex align-items-center justify-content-between">
                  <span className="small text-body-secondary">Per added user</span>
                  <span className="fw-semibold">{Number(client.userCreditCost ?? 200)} credits</span>
                </div>
                <div className="admin-settings-item d-flex align-items-center justify-content-between">
                  <span className="small text-body-secondary">Per completed session</span>
                  <span className="fw-semibold">{Number(client.sessionCreditCost ?? 100)} credits</span>
                </div>
                {client.enterpriseRequests?.length ? (
                  <div className="admin-settings-item">
                    <div className="small text-body-secondary mb-2">Enterprise upgrade requests</div>
                    <div className="d-grid gap-2">
                      {client.enterpriseRequests.slice(0, 3).map((request) => (
                        <div key={request.id} className="border rounded-3 p-2">
                          <div className="d-flex justify-content-between gap-2">
                            <span className="fw-semibold">{request.requestedByName}</span>
                            <span className={`badge ${request.status === "pending" ? "text-bg-primary" : "text-bg-success"}`}>{request.status}</span>
                          </div>
                          <div className="small text-body-secondary">{request.requestedByEmail}</div>
                          <div className="small mt-2">{request.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "avatars" ? (
        <div className="card">
          <div className="card-header bg-transparent border-0 pb-0 d-flex justify-content-between align-items-center">
            <div>
              <h2 className="h5 fw-semibold mb-1">Assigned Avatars</h2>
              <p className="small text-body-secondary mb-0">Avatars available for this client.</p>
            </div>
            <button className="btn btn-primary" onClick={handleOpenAssignModal}>Update Avatars</button>
          </div>
          <div className="card-body mt-3">
            {avatarsLoading ? (
              <div className="d-flex justify-content-center py-4">
                <div className="spinner-border text-primary" role="status"></div>
              </div>
            ) : client.assignedAvatars && client.assignedAvatars.length > 0 ? (
              <div className="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-3">
                {allAvatars.filter(a => client.assignedAvatars?.includes(a.avatarId)).map((avatar) => (
                  <div className="col" key={avatar.avatarId}>
                    <div className="card h-100 shadow-sm border" style={{ borderRadius: "12px", overflow: "hidden" }}>
                      <div className="card-body text-center p-3 d-flex flex-column align-items-center bg-white">
                        <div
                          style={{
                            width: "100%",
                            height: "120px",
                            marginBottom: "1rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: avatar.image ? "transparent" : "#f8f9fa",
                            borderRadius: "8px"
                          }}
                        >
                          {avatar.image ? (
                            <img src={avatar.image} alt={avatar.avatarName} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                          ) : (
                            <div className="text-muted opacity-50">
                              <i className="ri-user-line" style={{ fontSize: "2rem" }}></i>
                            </div>
                          )}
                        </div>
                        <h6 className="mb-1 fw-bold text-truncate w-100" title={avatar.avatarName}>{avatar.avatarName}</h6>
                        <div className="text-muted small" style={{ fontSize: "0.75rem" }}>{avatar.avatarId}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted py-5">
                <p>No avatars assigned to this client yet.</p>
                <p className="small">Please click the 'Update Avatars' button to assign avatars to this client.</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Modal
        show={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Assign Avatars"
        size="xl"
      >
        <div className="">
          {/* Avatar List */}
          <div
            style={{
              maxHeight: "450px",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "15px",
                flexWrap: "wrap",
                justifyContent: 'center'
              }}
            >
              {allAvatars.map((avatar) => {
                const isSelected = selectedAvatars.includes(avatar.avatarId);

                return (
                  <div
                    key={avatar.avatarId}
                    onClick={() => toggleAvatarSelection(avatar.avatarId)}
                    className={`avatar-card ${isSelected ? "avatar-card-selected" : ""
                      }`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      id={`avatar-${avatar.avatarId}`}
                      checked={isSelected}
                      onChange={() => toggleAvatarSelection(avatar.avatarId)}
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Avatar Image */}
                    {avatar.image ? (
                      <img
                        src={avatar.image}
                        alt={avatar.avatarName}
                        className="avatar-card-image"
                      />
                    ) : (
                      <div className="avatar-card-placeholder">
                        {avatar.avatarName?.charAt(0)?.toUpperCase()}
                      </div>
                    )}

                    {/* Avatar Details */}
                    <div className="avatar-card-content">
                      <div className="avatar-card-name">
                        {avatar.avatarName}
                      </div>

                      <div className="avatar-card-id">
                        {avatar.avatarId}
                      </div>

                      {avatar.provider && (
                        <span className="avatar-card-provider">
                          {avatar.provider}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {allAvatars.length === 0 && (
              <div className="text-center text-muted py-3 small">
                No avatars found
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button
              className="btn btn-light"
              onClick={() => setAssignModalOpen(false)}
            >
              Cancel
            </button>

            <button
              className="btn btn-primary"
              onClick={() => {
                void handleAssignSubmit();
              }}
              disabled={assignLoading}
            >
              {assignLoading ? "Updating..." : "Update Assignment"}
            </button>
          </div>
        </div>
      </Modal>

    </PageShell>
  );
};

export default ClientDetail;
