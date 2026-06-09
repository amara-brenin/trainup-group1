import { useCallback, useEffect, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
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

const tabOptions: Array<{ id: SettingsTab; label: string }> = [
  { id: "company", label: "Company Settings" },
  { id: "whitelabel", label: "White-labeling" },
  { id: "smtp", label: "SMTP" },
  { id: "emailCenter", label: "Email Center" },
];

const Settings = () => {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<SettingsTab>("company");
  const [settings, setSettings] = useState<TenantSettingsPayload | null>(null);
  const [savingTab, setSavingTab] = useState<TenantSettingsTab | "">("");
  const [actionLoading, setActionLoading] = useState<"" | "domain" | "webhook" | "smtp">("");

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

  const runAction = async (action: "domain" | "webhook" | "smtp", request: Promise<{ data: { status: boolean; message: string; data: ActionResponse & { configuration?: TenantSettingsPayload["integrations"] } } }>) => {
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

      {activeTab === "emailCenter" ? <EmailCenterPanel /> : null}
    </PageShell>
  );
};

export default Settings;
