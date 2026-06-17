import { useCallback, useEffect, useMemo, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";
import PageShell from "../../component/common/PageShell";
import type { IframeConfiguration as IframeConfigurationType } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";

const validationSchema = Yup.object({
  baseUrl: Yup.string().url("Use a valid embed URL.").required("Base URL is required."),
  defaultWidth: Yup.string().required("Default width is required."),
  height: Yup.number().min(320).required("Height is required."),
  allowedParentDomains: Yup.string().required("Add at least one parent domain."),
  ssoParameterName: Yup.string().required("SSO parameter name is required."),
});

const IframeConfiguration = () => {
  const [config, setConfig] = useState<IframeConfigurationType | null>(null);

  const fetchConfiguration = useCallback(async () => {
    const response = await AxiosHelper.getData<IframeConfigurationType>("/iframe");
    if (response.data.status) {
      setConfig(response.data.data);
    }
  }, []);

  useEffect(() => {
    void fetchConfiguration();
  }, [fetchConfiguration]);

  const initialValues = useMemo(
    () => ({
      baseUrl: config?.baseUrl ?? "",
      defaultWidth: config?.defaultWidth ?? "100%",
      height: config?.height ?? 680,
      allowedParentDomains: config?.allowedParentDomains.join("\n") ?? "",
      ssoParameterName: config?.ssoParameterName ?? "sso",
      allowFullscreen: config?.allowFullscreen ?? true,
      autoResize: config?.autoResize ?? true,
      blockRightClick: config?.blockRightClick ?? false,
    }),
    [config],
  );

  if (!config) {
    return (
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-body p-4">Loading iframe configuration...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="iFrame configuration"
      description="Prepare Trainup portal embeds with approved domains, sizing, and SSO mapping."
    >

      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <div className="card h-100">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">Embed configuration</h2>
              <p className="small text-body-secondary mb-0">Fields map directly to the shared iframe settings helper.</p>
            </div>
            <div className="card-body">
              <Formik
                initialValues={initialValues}
                enableReinitialize
                validationSchema={validationSchema}
                onSubmit={async (values, { setErrors, setSubmitting }) => {
                  const response = await AxiosHelper.putData<IframeConfigurationType, typeof values>("/iframe", values);

                  if (response.data.status) {
                    setConfig(response.data.data);
                    toast.success(response.data.message);
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
                      <label htmlFor="baseUrl" className="form-label">
                        Base embed URL <span className="text-danger">*</span>
                      </label>
                      <Field name="baseUrl" id="baseUrl" className="form-control admin-domain-pill" />
                      <ErrorMessage name="baseUrl" component="small" className="text-danger" />
                    </div>
                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="defaultWidth" className="form-label">
                          Default width <span className="text-danger">*</span>
                        </label>
                        <Field name="defaultWidth" id="defaultWidth" className="form-control" />
                        <ErrorMessage name="defaultWidth" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="height" className="form-label">
                          Height <span className="text-danger">*</span>
                        </label>
                        <Field name="height" id="height" type="number" className="form-control" />
                        <ErrorMessage name="height" component="small" className="text-danger" />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label htmlFor="allowedParentDomains" className="form-label">
                        Allowed parent domains <span className="text-danger">*</span>
                      </label>
                      <Field as="textarea" rows={4} name="allowedParentDomains" id="allowedParentDomains" className="form-control admin-domain-pill" />
                      <ErrorMessage name="allowedParentDomains" component="small" className="text-danger" />
                    </div>
                    <div className="mt-3">
                      <label htmlFor="ssoParameterName" className="form-label">
                        SSO parameter name <span className="text-danger">*</span>
                      </label>
                      <Field name="ssoParameterName" id="ssoParameterName" className="form-control" />
                      <ErrorMessage name="ssoParameterName" component="small" className="text-danger" />
                    </div>
                    <div className="pt-3 d-grid gap-2">
                      <div className="form-check">
                        <Field type="checkbox" name="allowFullscreen" id="allowFullscreen" className="form-check-input" />
                        <label htmlFor="allowFullscreen" className="form-check-label">Allow fullscreen</label>
                      </div>
                      <div className="form-check">
                        <Field type="checkbox" name="autoResize" id="autoResize" className="form-check-input" />
                        <label htmlFor="autoResize" className="form-check-label">Auto resize iframe</label>
                      </div>
                      <div className="form-check">
                        <Field type="checkbox" name="blockRightClick" id="blockRightClick" className="form-check-input" />
                        <label htmlFor="blockRightClick" className="form-check-label">Block right click in embedded player</label>
                      </div>
                    </div>
                    <div className="d-flex justify-content-end pt-3">
                      <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? "Saving..." : "Save settings"}
                      </button>
                    </div>
                  </Form>
                )}
              </Formik>
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-6">
          <div className="card mb-3">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">Generated embed preview</h2>
              <p className="small text-body-secondary mb-0">Current defaults shown as a Trainup portal snippet.</p>
            </div>
            <div className="card-body">
              <div className="admin-settings-item bg-dark text-white">
                <code className="text-info">
                  {`<iframe src="${config.baseUrl}{TRAINING_ID}?${config.ssoParameterName}={SSO_ID}" width="${config.defaultWidth}" height="${config.height}" frameborder="0" allowfullscreen></iframe>`}
                </code>
              </div>
              <div className="admin-settings-item mt-3">
                <div className="small text-body-secondary mb-2">Preview</div>
                <div className="border rounded-4 overflow-hidden">
                  <div className="bg-body-tertiary px-3 py-2 small text-body-secondary">
                    samsung-internal.com/lms
                  </div>
                  <div className="p-4 bg-light">
                    <div className="border border-dashed rounded-4 p-4 text-center bg-white">
                      <div className="small text-primary fw-semibold mb-2">Embedded LMS Training</div>
                      <div className="fw-semibold">Galaxy S25 Sales Mastery</div>
                      <div className="small text-body-secondary mt-1">Slide 1 of 6 · ~14 min · SSO active</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">Integration steps</h2>
              <p className="small text-body-secondary mb-0">Rollout checklist for client teams.</p>
            </div>
            <div className="card-body admin-settings-list">
              {[
                "Whitelist the parent domains listed in the form.",
                "Generate the embed URL with the training id and employee SSO id.",
                "Paste the iframe snippet into the client LMS or HR portal page.",
                "Use the webhook page to verify completion callbacks after launch.",
              ].map((step, index) => (
                <div key={step} className="admin-settings-item d-flex gap-3">
                  <span className="badge text-bg-light border">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default IframeConfiguration;
