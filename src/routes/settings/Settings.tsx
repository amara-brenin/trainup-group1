import { useCallback, useEffect, useState } from "react";
import { ErrorMessage, Field, Form, Formik, useFormikContext } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { useAppDispatch } from "../../app/hooks";
import BrandAssetInput from "../../component/common/BrandAssetInput";
import PageShell from "../../component/common/PageShell";
import type { ActionResponse, AppSettings, TenantSettingsPayload } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";
import { validateBrandAssetSource } from "../../helper/brandingAssets";
import { updateSettings as updateAppSettings } from "../../redux/settingsSlice";
import { EmailCenterPanel } from "./EmailCenter";

type TenantSettingsTab = keyof TenantSettingsPayload;
type SettingsTab = TenantSettingsTab | "emailCenter";

type WebhookDeliveryLog = {
  id: string;
  timestamp: string;
  event: string;
  ssoId?: string;
  status: number;
  latencyMs: number | null;
};

// Signing-secret field with a one-click generator. Lives inside <Formik> so it
// can read/write the form value via context. The secret lets the receiver
// verify the HMAC signature on each webhook (x-trainup-signature header).
const WebhookSigningSecretField = () => {
  const { values, setFieldValue } = useFormikContext<{ webhookSigningSecret?: string }>();
  const generate = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    void setFieldValue("webhookSigningSecret", `whsec_${hex}`);
  };
  return (
    <div className="admin-form-grid-full">
      <label htmlFor="settings-webhookSigningSecret" className="form-label">Signing secret</label>
      <div className="input-group">
        <Field name="webhookSigningSecret" id="settings-webhookSigningSecret" className="form-control" placeholder="whsec_..." />
        <button type="button" className="btn btn-outline-secondary" onClick={generate}>Generate</button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={!values.webhookSigningSecret}
          onClick={() => values.webhookSigningSecret && void navigator.clipboard.writeText(values.webhookSigningSecret)}
        >
          Copy
        </button>
      </div>
      <div className="form-text">
        Share this secret with your LMS/developer. Each result webhook is signed (HMAC-SHA256) in the
        <code className="mx-1">x-trainup-signature</code>header so they can verify it really came from TrainUp.
      </div>
    </div>
  );
};

const tabOptions: Array<{ id: SettingsTab; label: string }> = [
  { id: "company", label: "Company Settings" },
  { id: "whitelabel", label: "White-labeling" },
  { id: "integrations", label: "Integrations" },
  { id: "smtp", label: "SMTP" },
  { id: "emailCenter", label: "Email Center" },
];

const Settings = () => {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<SettingsTab>("company");
  const [settings, setSettings] = useState<TenantSettingsPayload | null>(null);
  const [savingTab, setSavingTab] = useState<TenantSettingsTab | "">("");
  const [actionLoading, setActionLoading] = useState<"" | "domain" | "webhook" | "smtp" | "xapi">("");
  const [selectedMethod, setSelectedMethod] = useState<string>("all");
  const [webhookLogs, setWebhookLogs] = useState<WebhookDeliveryLog[]>([]);

  const fetchWebhookLogs = useCallback(async () => {
    const res = await AxiosHelper.getData<{ logs?: WebhookDeliveryLog[] }>("/webhooks");
    if (res.data.status) {
      setWebhookLogs(Array.isArray(res.data.data?.logs) ? res.data.data.logs : []);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "integrations") void fetchWebhookLogs();
  }, [activeTab, fetchWebhookLogs]);

  const fetchSettings = useCallback(async () => {
    const response = await AxiosHelper.getData<TenantSettingsPayload>("/tenant-settings");
    if (response.data.status) {
      setSettings(response.data.data);
    } else {
      toast.error(response.data.message);
    }
  }, []);

  const refreshShellSettings = useCallback(async () => {
    const response = await AxiosHelper.getData<AppSettings>("/settings");
    if (response.data.status) {
      dispatch(updateAppSettings(response.data.data));
    }
  }, [dispatch]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const saveSection = async (section: TenantSettingsTab, values: Record<string, unknown>, setErrors: (errors: Record<string, string>) => void) => {
    setSavingTab(section);
    const response = await AxiosHelper.putData<TenantSettingsPayload, Record<string, unknown>>(`/tenant-settings/${section}`, values);

    if (response.data.status) {
      setSettings(response.data.data);
      await refreshShellSettings();
      toast.success(response.data.message);
    } else {
      setErrors((response.data.data || {}) as unknown as Record<string, string>);
      toast.error(response.data.message);
    }

    setSavingTab("");
  };

  const runAction = async (action: "domain" | "webhook" | "smtp" | "xapi", request: Promise<{ data: { status: boolean; message: string; data: ActionResponse & { configuration?: TenantSettingsPayload["integrations"] } } }>) => {
    setActionLoading(action);
    const response = await request;

    if (response.data.status) {
      toast.success(response.data.message);
      await fetchSettings();
    } else {
      toast.error(response.data.message);
    }

    setActionLoading("");
  };

  if (!settings) {
    return (
      <div className="card app-loading-card">
        <div className="card-body p-4">
          <span className="ds-skeleton app-loading-line is-wide" />
          <span className="ds-skeleton app-loading-line is-mid" />
          <div className="app-loading-grid">
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Settings"
      description="Manage company details, white-labeling, integrations, and SMTP for this client workspace."
    >

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

      {activeTab === "company" ? (
        <div className="card">
          <div className="card-body">
            <Formik
              initialValues={settings.company}
              enableReinitialize
              validationSchema={Yup.object({
                name: Yup.string().required("Company name is required."),
                industry: Yup.string().required("Industry is required."),
                supportEmail: Yup.string().email("Use a valid support email.").required("Support email is required."),
              })}
              onSubmit={async (values, { setErrors }) => saveSection("company", values, setErrors)}
            >
              <Form>
                <div className="admin-form-grid">
                  <div>
                    <label htmlFor="settings-company-name" className="form-label">Company name</label>
                    <Field id="settings-company-name" name="name" className="form-control" />
                    <ErrorMessage name="name" component="small" className="text-danger" />
                  </div>
                  <div>
                    <label htmlFor="settings-company-industry" className="form-label">Industry</label>
                    <Field id="settings-company-industry" name="industry" className="form-control" />
                    <ErrorMessage name="industry" component="small" className="text-danger" />
                  </div>
                  <div>
                    <label htmlFor="settings-company-supportEmail" className="form-label">Support email</label>
                    <Field id="settings-company-supportEmail" name="supportEmail" className="form-control" />
                    <ErrorMessage name="supportEmail" component="small" className="text-danger" />
                  </div>
                  <div>
                    <label htmlFor="settings-company-companyPhone" className="form-label">Company phone</label>
                    <Field id="settings-company-companyPhone" name="companyPhone" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-company-companyAddress" className="form-label">Company address</label>
                    <Field id="settings-company-companyAddress" name="companyAddress" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-company-status" className="form-label">Status</label>
                    <Field as="select" id="settings-company-status" name="status" className="form-select">
                      <option value="active">Active</option>
                      <option value="trial">Trial</option>
                      <option value="inactive">Inactive</option>
                    </Field>
                  </div>
                  <div>
                    <label htmlFor="settings-company-csm" className="form-label">CSM</label>
                    <Field id="settings-company-csm" name="csm" className="form-control" />
                  </div>
                </div>
                <div className="d-flex justify-content-end pt-3">
                  <button type="submit" className="btn btn-primary" disabled={savingTab === "company"}>
                    {savingTab === "company" ? "Saving..." : "Save company settings"}
                  </button>
                </div>
              </Form>
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "whitelabel" ? (
        <div className="card">
          <div className="card-body">
            <Formik
              initialValues={settings.whitelabel}
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
                      <label htmlFor="settings-whitelabel-applicationName" className="form-label">Application name</label>
                      <Field id="settings-whitelabel-applicationName" name="applicationName" className="form-control" />
                    </div>
                    <div className="whitelabel-color-grid">
                      <div className="whitelabel-color-field">
                        <label htmlFor="settings-whitelabel-primaryColor" className="form-label">Primary color</label>
                        <div className="input-group">
                          <Field type="color" id="settings-whitelabel-primaryColor" name="primaryColor" className="form-control form-control-color" />
                          <Field name="primaryColor" className="form-control" />
                        </div>
                      </div>
                      <div className="whitelabel-color-field">
                        <label htmlFor="settings-whitelabel-secondaryColor" className="form-label">Secondary color</label>
                        <div className="input-group">
                          <Field type="color" id="settings-whitelabel-secondaryColor" name="secondaryColor" className="form-control form-control-color" />
                          <Field name="secondaryColor" className="form-control" />
                        </div>
                      </div>
                    </div>
                    <div className="whitelabel-asset-list">
                      <BrandAssetInput
                        id="settings-whitelabel-logoUrl"
                        label="Light logo"
                        value={values.logoUrl}
                        error={typeof errors.logoUrl === "string" ? errors.logoUrl : ""}
                        onChange={(value) => setFieldValue("logoUrl", value)}
                        onErrorClear={() => setFieldError("logoUrl", "")}
                      />
                      <BrandAssetInput
                        id="settings-whitelabel-darkLogoUrl"
                        label="Dark logo"
                        value={values.darkLogoUrl}
                        error={typeof errors.darkLogoUrl === "string" ? errors.darkLogoUrl : ""}
                        onChange={(value) => setFieldValue("darkLogoUrl", value)}
                        onErrorClear={() => setFieldError("darkLogoUrl", "")}
                      />
                      <BrandAssetInput
                        id="settings-whitelabel-faviconUrl"
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
                    <button type="submit" className="btn btn-primary" disabled={savingTab === "whitelabel"}>
                      {savingTab === "whitelabel" ? "Saving..." : "Save white-labeling"}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "smtp" ? (
        <div className="card">
          <div className="card-body">
            <Formik initialValues={settings.smtp} enableReinitialize onSubmit={async (values, { setErrors }) => saveSection("smtp", values as unknown as Record<string, unknown>, setErrors)}>
              <Form>
                <div className="form-check mb-3">
                  <Field type="checkbox" name="emailDeliveryEnabled" id="settings-smtp-enabled" className="form-check-input" />
                  <label htmlFor="settings-smtp-enabled" className="form-check-label">Enable email delivery for trainee invites and training share emails</label>
                </div>
                <div className="admin-form-grid">
                  <div>
                    <label htmlFor="settings-smtp-host" className="form-label">SMTP host</label>
                    <Field id="settings-smtp-host" name="host" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-smtp-port" className="form-label">SMTP port</label>
                    <Field id="settings-smtp-port" name="port" type="number" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-smtp-username" className="form-label">Username</label>
                    <Field id="settings-smtp-username" name="username" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-smtp-password" className="form-label">Password</label>
                    <Field id="settings-smtp-password" name="password" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-smtp-fromName" className="form-label">From name</label>
                    <Field id="settings-smtp-fromName" name="fromName" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="settings-smtp-fromEmail" className="form-label">From email</label>
                    <Field id="settings-smtp-fromEmail" name="fromEmail" className="form-control" />
                    <ErrorMessage name="fromEmail" component="small" className="text-danger" />
                  </div>
                  <div>
                    <label htmlFor="settings-smtp-testRecipient" className="form-label">Test recipient</label>
                    <Field id="settings-smtp-testRecipient" name="testRecipient" className="form-control" />
                  </div>
                </div>
                <div className="card border-0 bg-light-subtle mt-4">
                  <div className="card-body">
                    <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                      <div>
                        <h3 className="h6 mb-1">Email Template</h3>
                        <p className="small text-body-secondary mb-0">
                          This template is used when a trainer assigns training to a trainee.
                        </p>
                      </div>
                      <span className="badge text-bg-light border text-dark">
                        Tokens: {"{candidateName}"}, {"{trainingTitle}"}, {"{trainingAudience}"}, {"{trainingLink}"}, {"{clientName}"}
                      </span>
                    </div>
                    <div className="admin-form-grid">
                      <div className="admin-form-grid-full">
                        <label htmlFor="settings-smtp-trainingAssignmentSubject" className="form-label">Email subject</label>
                        <Field
                          id="settings-smtp-trainingAssignmentSubject"
                          name="trainingAssignmentSubject"
                          className="form-control"
                        />
                      </div>
                      <div className="admin-form-grid-full">
                        <label htmlFor="settings-smtp-trainingAssignmentTemplate" className="form-label">Email body (HTML supported)</label>
                        <Field
                          as="textarea"
                          id="settings-smtp-trainingAssignmentTemplate"
                          name="trainingAssignmentTemplate"
                          rows={8}
                          className="form-control"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="form-check mt-3">
                  <Field type="checkbox" name="secure" id="settings-smtp-secure" className="form-check-input" />
                  <label htmlFor="settings-smtp-secure" className="form-check-label">Use secure SMTP</label>
                </div>
                <div className="small text-body-secondary mt-3">
                  {settings.smtp.lastTestMessage || "No SMTP test has been run yet."}
                </div>
                <div className="d-flex justify-content-between gap-2 pt-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => void runAction("smtp", AxiosHelper.postData<ActionResponse, { recipient: string }>("/smtp/test", { recipient: settings.smtp.testRecipient }))}
                    disabled={actionLoading === "smtp" || !settings.smtp.emailDeliveryEnabled}
                  >
                    {actionLoading === "smtp" ? "Sending..." : "Send SMTP test"}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingTab === "smtp"}>
                    {savingTab === "smtp" ? "Saving..." : "Save SMTP"}
                  </button>
                </div>
              </Form>
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "integrations" ? (
        <div className="card">
          <div className="card-body">
            <Formik
              initialValues={{
                ssoType: settings.integrations.ssoType || "None",
                ssoStatus: settings.integrations.ssoStatus || "not_configured",
                ssoProviderType: settings.integrations.ssoProviderType || "none",
                ssoClientId: settings.integrations.ssoClientId || "",
                ssoClientSecret: settings.integrations.ssoClientSecret || "",
                ssoTenantId: settings.integrations.ssoTenantId || "",
                ssoIssuerUrl: settings.integrations.ssoIssuerUrl || "",
                ssoEntryPoint: settings.integrations.ssoEntryPoint || "",
                ssoAudience: settings.integrations.ssoAudience || "",
                ssoRedirectUri: settings.integrations.ssoRedirectUri || "",
                ssoButtonLabel: settings.integrations.ssoButtonLabel || "",
                ssoAllowedDomains: (settings.integrations.ssoAllowedDomains || []).join("\n"),
                ssoAutoProvisionUsers: settings.integrations.ssoAutoProvisionUsers ?? true,
                webhookUrl: settings.integrations.webhookUrl || "",
                webhookSigningSecret: settings.integrations.webhookSigningSecret || "",
                apiScope: settings.integrations.apiScope || "",
                allowedOrigins: (settings.integrations.allowedOrigins || []).join("\n"),
                iframeEnabled: settings.integrations.iframeEnabled,
                iframeBaseUrl: settings.integrations.iframeBaseUrl || "",
                iframeAllowedParentDomains: (settings.integrations.iframeAllowedParentDomains || []).join("\n"),
                ltiClientId: settings.integrations.ltiClientId || "",
                ltiDeploymentId: settings.integrations.ltiDeploymentId || "",
                ltiPlatformKeysetUrl: settings.integrations.ltiPlatformKeysetUrl || "",
                ltiAccessTokenUrl: settings.integrations.ltiAccessTokenUrl || "",
                ltiOidcAuthUrl: settings.integrations.ltiOidcAuthUrl || "",
                scormEnabled: settings.integrations.scormEnabled !== false,
                xapiEnabled: settings.integrations.xapiEnabled ?? false,
                xapiLrsEndpoint: settings.integrations.xapiLrsEndpoint || "",
                xapiClientId: settings.integrations.xapiClientId || "",
                xapiClientSecret: settings.integrations.xapiClientSecret || "",
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
                        <Field type="checkbox" name="iframeEnabled" id="settings-iframeEnabled" className="form-check-input" />
                        <label htmlFor="settings-iframeEnabled" className="form-check-label fw-medium">
                          Enable iframe delivery
                        </label>
                      </div>
                      <div className="admin-form-grid">
                        <div>
                          <label htmlFor="settings-iframeBaseUrl" className="form-label">iFrame base URL</label>
                          <Field name="iframeBaseUrl" id="settings-iframeBaseUrl" className="form-control" placeholder="https://..." />
                          <ErrorMessage name="iframeBaseUrl" component="small" className="text-danger" />
                        </div>
                        <div>
                          <label htmlFor="settings-iframeAllowedParentDomains" className="form-label">Allowed parent domains (one per line)</label>
                          <Field as="textarea" rows={3} name="iframeAllowedParentDomains" id="settings-iframeAllowedParentDomains" className="form-control" placeholder="example.com&#10;another.com" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="settings-allowedOrigins" className="form-label">Allowed origins (CORS, one per line)</label>
                          <Field as="textarea" rows={2} name="allowedOrigins" id="settings-allowedOrigins" className="form-control" placeholder="https://example.com" />
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
                          <label htmlFor="settings-ltiClientId" className="form-label">LTI Client ID</label>
                          <Field name="ltiClientId" id="settings-ltiClientId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ltiDeploymentId" className="form-label">LTI Deployment ID</label>
                          <Field name="ltiDeploymentId" id="settings-ltiDeploymentId" className="form-control" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="settings-ltiPlatformKeysetUrl" className="form-label">Platform Keyset URL</label>
                          <Field name="ltiPlatformKeysetUrl" id="settings-ltiPlatformKeysetUrl" className="form-control" placeholder="https://..." />
                        </div>
                        <div>
                          <label htmlFor="settings-ltiOidcAuthUrl" className="form-label">OIDC Auth URL</label>
                          <Field name="ltiOidcAuthUrl" id="settings-ltiOidcAuthUrl" className="form-control" placeholder="https://..." />
                        </div>
                        <div>
                          <label htmlFor="settings-ltiAccessTokenUrl" className="form-label">Access Token URL</label>
                          <Field name="ltiAccessTokenUrl" id="settings-ltiAccessTokenUrl" className="form-control" placeholder="https://..." />
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
                        <Field type="checkbox" name="scormEnabled" id="settings-scormEnabled" className="form-check-input" />
                        <label htmlFor="settings-scormEnabled" className="form-check-label fw-medium">
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
                        <Field type="checkbox" name="xapiEnabled" id="settings-xapiEnabled" className="form-check-input" />
                        <label htmlFor="settings-xapiEnabled" className="form-check-label fw-medium">
                          Enable xAPI statement delivery
                        </label>
                      </div>
                      <div className="admin-form-grid">
                        <div className="admin-form-grid-full">
                          <label htmlFor="settings-xapiLrsEndpoint" className="form-label">LRS Endpoint URL</label>
                          <Field name="xapiLrsEndpoint" id="settings-xapiLrsEndpoint" className="form-control" placeholder="https://..." />
                        </div>
                        <div>
                          <label htmlFor="settings-xapiClientId" className="form-label">LRS Auth Client ID / Username</label>
                          <Field name="xapiClientId" id="settings-xapiClientId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-xapiClientSecret" className="form-label">LRS Auth Client Secret / Password</label>
                          <Field name="xapiClientSecret" id="settings-xapiClientSecret" className="form-control" type="password" />
                        </div>
                      </div>
                      <div className="mt-3">
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm"
                          onClick={async () => {
                            await runAction("xapi", AxiosHelper.postData<ActionResponse, Record<string, never>>("/xapi/test", {}));
                            void fetchWebhookLogs();
                          }}
                          disabled={actionLoading === "xapi" || !settings.integrations.xapiLrsEndpoint}
                        >
                          {actionLoading === "xapi" ? "Sending..." : "Send xAPI test"}
                        </button>
                        <div className="form-text">Save the LRS settings first, then send a test statement to verify the connection.</div>
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
                          <label htmlFor="settings-webhookUrl" className="form-label">Webhook URL</label>
                          <Field name="webhookUrl" id="settings-webhookUrl" className="form-control" placeholder="https://..." />
                          <ErrorMessage name="webhookUrl" component="small" className="text-danger" />
                        </div>
                        <div>
                          <label htmlFor="settings-apiScope" className="form-label">API Scope</label>
                          <Field name="apiScope" id="settings-apiScope" className="form-control" />
                        </div>
                        <WebhookSigningSecretField />
                      </div>

                      <h4 className="h6 text-primary fw-semibold border-bottom pb-1 mb-3">SSO Identity Configuration</h4>
                      <div className="admin-form-grid">
                        <div>
                          <label htmlFor="settings-ssoType" className="form-label">SSO type</label>
                          <Field as="select" name="ssoType" id="settings-ssoType" className="form-select">
                            <option value="Trainup IAM">Trainup IAM</option>
                            <option value="Azure AD">Azure AD</option>
                            <option value="Google Workspace">Google Workspace</option>
                            <option value="Okta">Okta</option>
                            <option value="None">None</option>
                          </Field>
                        </div>
                        <div>
                          <label htmlFor="settings-ssoProviderType" className="form-label">SSO provider type</label>
                          <Field as="select" name="ssoProviderType" id="settings-ssoProviderType" className="form-select">
                            <option value="none">None</option>
                            <option value="oidc">OIDC / OAuth</option>
                            <option value="saml">SAML</option>
                          </Field>
                        </div>
                        <div>
                          <label htmlFor="settings-ssoClientId" className="form-label">SSO client ID</label>
                          <Field name="ssoClientId" id="settings-ssoClientId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoClientSecret" className="form-label">SSO client secret</label>
                          <Field name="ssoClientSecret" id="settings-ssoClientSecret" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoTenantId" className="form-label">SSO tenant / directory ID</label>
                          <Field name="ssoTenantId" id="settings-ssoTenantId" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoIssuerUrl" className="form-label">Issuer URL</label>
                          <Field name="ssoIssuerUrl" id="settings-ssoIssuerUrl" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoEntryPoint" className="form-label">Entry point / login URL</label>
                          <Field name="ssoEntryPoint" id="settings-ssoEntryPoint" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoAudience" className="form-label">Audience / entity ID</label>
                          <Field name="ssoAudience" id="settings-ssoAudience" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoRedirectUri" className="form-label">Redirect URI</label>
                          <Field name="ssoRedirectUri" id="settings-ssoRedirectUri" className="form-control" />
                        </div>
                        <div>
                          <label htmlFor="settings-ssoButtonLabel" className="form-label">SSO button label</label>
                          <Field name="ssoButtonLabel" id="settings-ssoButtonLabel" className="form-control" />
                        </div>
                        <div className="admin-form-grid-full">
                          <label htmlFor="settings-ssoAllowedDomains" className="form-label">Allowed SSO email domains (one per line)</label>
                          <Field as="textarea" rows={2} name="ssoAllowedDomains" id="settings-ssoAllowedDomains" className="form-control" />
                        </div>
                      </div>
                      <div className="form-check mt-3">
                        <Field type="checkbox" name="ssoAutoProvisionUsers" id="settings-ssoAutoProvisionUsers" className="form-check-input" />
                        <label htmlFor="settings-ssoAutoProvisionUsers" className="form-check-label fw-medium">
                          Auto-create learner accounts after successful SSO
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="small text-body-secondary mt-3">{settings.integrations.lastWebhookTestMessage || "No webhook test has been run yet."}</div>

                {/* Recent webhook deliveries — completion results pushed to the customer. */}
                <div className="mt-3">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <h4 className="h6 text-primary fw-semibold mb-0">Recent webhook deliveries</h4>
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void fetchWebhookLogs()}>
                      <i className="ri-refresh-line me-1"></i>Refresh
                    </button>
                  </div>
                  {webhookLogs.length ? (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle small mb-0">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Event</th>
                            <th>Recipient</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {webhookLogs.map((log) => {
                            const okStatus = log.status >= 200 && log.status < 300;
                            return (
                              <tr key={log.id}>
                                <td className="text-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                                <td><code>{log.event}</code></td>
                                <td>{log.ssoId || "—"}</td>
                                <td>
                                  <span className={`badge ${okStatus ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger"}`}>
                                    {okStatus ? "Delivered" : "Failed"} ({log.status})
                                  </span>
                                  {log.latencyMs != null ? <span className="text-body-secondary ms-2">{log.latencyMs} ms</span> : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="small text-body-secondary">No deliveries yet. Complete a training (or send a test) to see results here.</div>
                  )}
                </div>

                <div className="d-flex justify-content-between gap-2 pt-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={async () => {
                      await runAction("webhook", AxiosHelper.postData<ActionResponse, Record<string, never>>("/webhooks/test", {}));
                      void fetchWebhookLogs();
                    }}
                    disabled={actionLoading === "webhook" || !settings.integrations.webhookUrl}
                  >
                    {actionLoading === "webhook" ? "Sending..." : "Send webhook test"}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingTab === "integrations"}>
                    {savingTab === "integrations" ? "Saving..." : "Save integrations"}
                  </button>
                </div>
              </Form>
            </Formik>
          </div>
        </div>
      ) : null}

      {activeTab === "emailCenter" ? <EmailCenterPanel /> : null}
    </PageShell>
  );
};

export default Settings;
