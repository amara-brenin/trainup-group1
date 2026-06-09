import { useCallback, useEffect, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";
import PageShell from "../../component/common/PageShell";
import type { ActionResponse, WebhookConfiguration } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";

const validationSchema = Yup.object({
  url: Yup.string().url("Use a valid webhook URL.").required("Webhook URL is required."),
  signingSecret: Yup.string().required("Signing secret is required."),
  retryAttempts: Yup.number().min(0).required("Retry attempts are required."),
  timeoutSeconds: Yup.number().min(1).required("Timeout is required."),
});

const WebhookSettings = () => {
  const [config, setConfig] = useState<WebhookConfiguration | null>(null);
  const [testing, setTesting] = useState(false);
  const [lastResult, setLastResult] = useState<ActionResponse | null>(null);

  const fetchConfiguration = useCallback(async () => {
    const response = await AxiosHelper.getData<WebhookConfiguration>("/webhooks");
    if (response.data.status) {
      setConfig(response.data.data);
    }
  }, []);

  useEffect(() => {
    void fetchConfiguration();
  }, [fetchConfiguration]);

  const runWebhookTest = async () => {
    setTesting(true);
    const response = await AxiosHelper.postData<ActionResponse & { configuration?: WebhookConfiguration }, Record<string, never>>("/webhooks/test", {});

    if (response.data.status) {
      setLastResult(response.data.data);
      if (response.data.data.configuration) {
        setConfig(response.data.data.configuration);
      } else {
        await fetchConfiguration();
      }
      toast.success(response.data.message);
    } else {
      toast.error(response.data.message);
    }

    setTesting(false);
  };

  if (!config) {
    return (
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-body p-4">Loading webhook settings...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Webhook settings"
      description="Sync completion events back into Samsung systems through the standard helper layer."
    >

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <div className="card">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">Endpoint configuration</h2>
              <p className="small text-body-secondary mb-0">Control delivery endpoint, retries, and active events.</p>
            </div>
            <div className="card-body">
              <Formik
                initialValues={config}
                enableReinitialize
                validationSchema={validationSchema}
                onSubmit={async (values, { setErrors, setSubmitting }) => {
                  const response = await AxiosHelper.putData<WebhookConfiguration, WebhookConfiguration>("/webhooks", values);

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
                {({ isSubmitting, values, setFieldValue }) => (
                  <Form>
                    <div className="mb-3">
                      <label htmlFor="url" className="form-label">
                        Webhook URL <span className="text-danger">*</span>
                      </label>
                      <Field name="url" id="url" className="form-control admin-domain-pill" />
                      <ErrorMessage name="url" component="small" className="text-danger" />
                    </div>
                    <div className="mb-3">
                      <label htmlFor="signingSecret" className="form-label">
                        Signing secret <span className="text-danger">*</span>
                      </label>
                      <Field name="signingSecret" id="signingSecret" className="form-control admin-domain-pill" />
                      <ErrorMessage name="signingSecret" component="small" className="text-danger" />
                    </div>
                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="retryAttempts" className="form-label">
                          Retry attempts <span className="text-danger">*</span>
                        </label>
                        <Field name="retryAttempts" id="retryAttempts" type="number" className="form-control" />
                        <ErrorMessage name="retryAttempts" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="timeoutSeconds" className="form-label">
                          Timeout seconds <span className="text-danger">*</span>
                        </label>
                        <Field name="timeoutSeconds" id="timeoutSeconds" type="number" className="form-control" />
                        <ErrorMessage name="timeoutSeconds" component="small" className="text-danger" />
                      </div>
                    </div>

                    <div className="pt-3">
                      <h3 className="h6 fw-semibold mb-3">Events to dispatch</h3>
                      <div className="admin-settings-list">
                        {values.events.map((event, index) => (
                          <div key={event.key} className="admin-settings-item">
                            <div className="d-flex align-items-start justify-content-between gap-3">
                              <div>
                                <div className="fw-semibold">{event.key}</div>
                                <div className="small text-body-secondary">{event.description}</div>
                              </div>
                              <div className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={event.enabled}
                                  onChange={(changeEvent) =>
                                    setFieldValue(`events.${index}.enabled`, changeEvent.target.checked)
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="d-flex justify-content-end pt-3">
                      <div className="d-flex gap-2">
                        <button type="button" className="btn btn-outline-primary" onClick={() => void runWebhookTest()} disabled={testing}>
                          {testing ? "Sending..." : "Send test event"}
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                          {isSubmitting ? "Saving..." : "Save configuration"}
                        </button>
                      </div>
                    </div>
                  </Form>
                )}
              </Formik>
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="card h-100">
            <div className="card-header bg-transparent border-0 pb-0">
              <div className="d-flex align-items-center justify-content-between">
                <div>
                  <h2 className="h5 fw-semibold mb-1">Delivery log</h2>
                  <p className="small text-body-secondary mb-0">Recent event outcomes.</p>
                </div>
                <span className="badge text-bg-success">
                  {config.logs.filter((item) => item.status === 200).length}/{config.logs.length} delivered
                </span>
              </div>
            </div>
            <div className="card-body">
              {lastResult ? (
                <div className={`alert ${lastResult.success ? "alert-success" : "alert-warning"} py-2`} role="alert">
                  {lastResult.message}
                </div>
              ) : null}
              <div className="table-responsive">
                <table className="table table-bordered align-middle mb-0">
                  <thead>
                    <tr className="text-center">
                      <th className="table-m-width">Timestamp</th>
                      <th className="table-m-width">Event</th>
                      <th className="table-s-width">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.logs.map((log) => (
                      <tr key={log.id} className="text-center">
                        <td className="admin-domain-pill">{log.timestamp}</td>
                        <td>{log.event}</td>
                        <td>
                          <span className={`badge ${log.status === 200 ? "text-bg-success" : "text-bg-danger"}`}>
                            {log.status === 200 ? "200 OK" : "503 Error"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default WebhookSettings;
