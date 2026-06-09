import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";
import PageShell from "../../component/common/PageShell";
import { Modal } from "../../component/common/Modal";
import AxiosHelper from "../../helper/AxiosHelper";

type EmailCenterSettings = {
  setPasswordSubject: string;
  setPasswordTemplate: string;
  resetPasswordSubject: string;
  resetPasswordTemplate: string;
  signatureHtml: string;
  signatureImageUrl: string;
};

type TemplateKey = "setPassword" | "resetPassword";

const defaults: EmailCenterSettings = {
  setPasswordSubject: "Set your password",
  setPasswordTemplate:
    '<p>Hello {name},</p><p>Your account has been created. Set your password to activate access.</p><p><a href="{actionUrl}">Set your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>',
  resetPasswordSubject: "Reset your password",
  resetPasswordTemplate:
    '<p>Hello {name},</p><p>We received a request to reset your password.</p><p><a href="{actionUrl}">Reset your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>',
  signatureHtml: "",
  signatureImageUrl: "",
};

const validationSchema = Yup.object({
  subject: Yup.string().required("Subject is required."),
  template: Yup.string().required("Template is required."),
});

const templateMeta: Record<TemplateKey, { title: string; description: string; subjectKey: keyof EmailCenterSettings; templateKey: keyof EmailCenterSettings }> = {
  setPassword: {
    title: "Set Password",
    description: "Sent when a new company user, trainer, reviewer, or trainee is invited.",
    subjectKey: "setPasswordSubject",
    templateKey: "setPasswordTemplate",
  },
  resetPassword: {
    title: "Reset Password",
    description: "Sent when a user requests password recovery or an admin triggers a reset.",
    subjectKey: "resetPasswordSubject",
    templateKey: "resetPasswordTemplate",
  },
};

export const EmailCenterPanel = () => {
  const [settings, setSettings] = useState<EmailCenterSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState<TemplateKey | null>(null);

  const fetchSettings = useCallback(async () => {
    const response = await AxiosHelper.getData<EmailCenterSettings>("/email-center");
    if (response.data.status) {
      setSettings(response.data.data);
    } else {
      toast.error(response.data.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const templates = useMemo(
    () =>
      (Object.keys(templateMeta) as TemplateKey[]).map((key) => ({
        key,
        ...templateMeta[key],
        subject: String(settings[templateMeta[key].subjectKey] || ""),
        body: String(settings[templateMeta[key].templateKey] || ""),
      })),
    [settings],
  );

  const selectedTemplate = activeTemplate ? templateMeta[activeTemplate] : null;

  const saveSettings = async (nextSettings: EmailCenterSettings) => {
    const response = await AxiosHelper.putData<EmailCenterSettings, EmailCenterSettings>("/email-center", nextSettings);
    if (response.data.status) {
      setSettings(response.data.data);
      toast.success(response.data.message);
      return true;
    }

    toast.error(response.data.message);
    return false;
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">Loading email templates...</div>
      </div>
    );
  }

  return (
    <>
      <div className="alert alert-light border">
        Variables: {"{name}"}, {"{email}"}, {"{actionUrl}"}, {"{clientName}"}, {"{expiryMinutes}"}
      </div>

      <div className="row g-3">
        {templates.map((template) => (
          <div className="col-md-6" key={template.key}>
            <div className="card h-100">
              <div className="card-body">
                <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
                  <div>
                    <h2 className="h5 mb-1">{template.title}</h2>
                    <p className="small text-body-secondary mb-0">{template.description}</p>
                  </div>
                  <span className="badge text-bg-light border text-dark">Template</span>
                </div>
                <div className="small text-body-secondary mb-1">Subject</div>
                <div className="fw-semibold mb-3">{template.subject}</div>
                <div className="small text-body-secondary mb-1">Preview</div>
                <div className="border rounded p-3 bg-light-subtle" style={{ minHeight: 120 }} dangerouslySetInnerHTML={{ __html: template.body }} />
                <div className="d-flex justify-content-end pt-3">
                  <button type="button" className="btn btn-outline-primary" onClick={() => setActiveTemplate(template.key)}>
                    View / Edit
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card mt-3">
        <div className="card-header bg-transparent border-0 pb-0">
          <h2 className="h5 mb-1">Email Signature</h2>
          <p className="small text-body-secondary mb-0">Applied below onboarding and password recovery emails.</p>
        </div>
        <div className="card-body">
          <Formik
            initialValues={{
              signatureHtml: settings.signatureHtml,
              signatureImageUrl: settings.signatureImageUrl,
            }}
            enableReinitialize
            onSubmit={async (values, { setSubmitting }) => {
              await saveSettings({ ...settings, ...values });
              setSubmitting(false);
            }}
          >
            {({ isSubmitting, setFieldValue, values }) => (
              <Form>
                <div className="admin-form-grid">
                  <div className="admin-form-grid-full">
                    <label htmlFor="signatureHtml" className="form-label">Signature HTML</label>
                    <Field as="textarea" rows={4} id="signatureHtml" name="signatureHtml" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="signatureImageUrl" className="form-label">Signature image URL</label>
                    <Field id="signatureImageUrl" name="signatureImageUrl" className="form-control" />
                  </div>
                  <div>
                    <label htmlFor="signatureUpload" className="form-label">Upload signature image</label>
                    <input
                      id="signatureUpload"
                      type="file"
                      accept="image/*"
                      className="form-control"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => void setFieldValue("signatureImageUrl", String(reader.result || ""));
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                </div>
                {values.signatureImageUrl ? (
                  <div className="border rounded p-3 mt-3 bg-light-subtle">
                    <img src={values.signatureImageUrl} alt="Email signature preview" style={{ maxWidth: 260, height: "auto" }} />
                  </div>
                ) : null}
                <div className="d-flex justify-content-end pt-3">
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save signature"}
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        </div>
      </div>

      <Modal
        show={Boolean(activeTemplate && selectedTemplate)}
        onClose={() => setActiveTemplate(null)}
        title={selectedTemplate?.title || "Template"}
        size="xl"
        centered
      >
        {activeTemplate && selectedTemplate ? (
          <Formik
            initialValues={{
              subject: String(settings[selectedTemplate.subjectKey] || ""),
              template: String(settings[selectedTemplate.templateKey] || ""),
            }}
            enableReinitialize
            validationSchema={validationSchema}
            onSubmit={async (values, { setSubmitting, setErrors }) => {
              const nextSettings = {
                ...settings,
                [selectedTemplate.subjectKey]: values.subject,
                [selectedTemplate.templateKey]: values.template,
              };
              const response = await AxiosHelper.putData<EmailCenterSettings, EmailCenterSettings>("/email-center", nextSettings);
              if (response.data.status) {
                setSettings(response.data.data);
                toast.success(response.data.message);
                setActiveTemplate(null);
              } else {
                setErrors((response.data.data || {}) as unknown as Record<string, string>);
                toast.error(response.data.message);
              }
              setSubmitting(false);
            }}
          >
            {({ isSubmitting, values }) => (
              <Form>
                <div className="mb-3">
                  <label htmlFor="template-subject" className="form-label">Subject</label>
                  <Field id="template-subject" name="subject" className="form-control" />
                  <ErrorMessage name="subject" component="small" className="text-danger" />
                </div>
                <div className="mb-3">
                  <label htmlFor="template-body" className="form-label">Email body</label>
                  <Field as="textarea" rows={9} id="template-body" name="template" className="form-control" />
                  <ErrorMessage name="template" component="small" className="text-danger" />
                </div>
                <div className="small text-body-secondary mb-2">Live preview</div>
                <div className="border rounded p-3 bg-light-subtle mb-3" dangerouslySetInnerHTML={{ __html: values.template }} />
                <div className="d-flex justify-content-end gap-2">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setActiveTemplate(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save template"}
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        ) : null}
      </Modal>
    </>
  );
};

const EmailCenter = () => {
  return (
    <PageShell
      title="Email Center"
      description="Customize the emails your company sends for onboarding and password recovery."
    >
      <EmailCenterPanel />
    </PageShell>
  );
};

export default EmailCenter;
