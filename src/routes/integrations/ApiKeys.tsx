import { useCallback, useEffect, useMemo, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import * as Yup from "yup";
import { Modal } from "../../component/common/Modal";
import ActionDropdown from "../../component/common/ActionDropdown";
import PageShell from "../../component/common/PageShell";
import { Pagination } from "../../component/common/Pagination";
import { PermissionBlock } from "../../component/common/PermissionBlock";
import type {
  ApiConfiguration,
  ApiKeyFormValues,
  ApiKeyRecord,
  PageParamState,
  PaginatedResponse,
} from "../../constant/interfaces";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import AxiosHelper from "../../helper/AxiosHelper";
import { maskKey } from "../../helper/string";
import { useDebounce } from "../../hooks/useDebounce";

const defaultValues: ApiKeyFormValues = {
  name: "",
  permission: "Read Only",
};

const keySchema = Yup.object({
  name: Yup.string().required("Key name is required."),
  permission: Yup.string().required("Permission is required."),
});

const configSchema = Yup.object({
  baseUrl: Yup.string().url("Use a valid API base URL.").required("Base URL is required."),
  rateLimitPerMinute: Yup.number().min(1).required("Rate limit is required."),
  tokenExpiryHours: Yup.number().min(1).required("Token expiry is required."),
  corsAllowedOrigins: Yup.string().required("Add at least one origin."),
});

const ApiKeys = () => {
  const [open, setOpen] = useState(false);
  const [loader, setLoader] = useState(false);
  const [data, setData] = useState<PaginatedResponse<ApiKeyRecord>>({
    count: 0,
    totalPages: 1,
    record: [],
    pagination: [1],
  });
  const [config, setConfig] = useState<ApiConfiguration | null>(null);
  const [param, setParam] = useState<PageParamState>({ limit: 10, pageNo: 1, query: "" });
  const [permissionFilter, setPermissionFilter] = useState<"all" | "Read Only" | "Read / Write">("all");
  const [sortBy, setSortBy] = useState<"name" | "permission" | "created" | "calls">("created");
  const debouncedQuery = useDebounce(param.query);

  const fetchKeys = useCallback(async () => {
    const response = await AxiosHelper.getData<PaginatedResponse<ApiKeyRecord>>("/api-keys", {
      limit: param.limit,
      pageNo: param.pageNo,
      query: debouncedQuery,
      permission: permissionFilter,
      sortBy,
    });
    if (response.data.status) {
      setData(response.data.data);
    }
  }, [debouncedQuery, param.limit, param.pageNo, permissionFilter, sortBy]);

  const fetchConfig = useCallback(async () => {
    const response = await AxiosHelper.getData<ApiConfiguration>("/api-config");
    if (response.data.status) {
      setConfig(response.data.data);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
    void fetchConfig();
  }, [fetchConfig, fetchKeys]);

  const configInitialValues = useMemo(
    () => ({
      baseUrl: config?.baseUrl ?? "",
      rateLimitPerMinute: config?.rateLimitPerMinute ?? 1000,
      tokenExpiryHours: config?.tokenExpiryHours ?? 24,
      corsAllowedOrigins: config?.corsAllowedOrigins.join("\n") ?? "",
    }),
    [config],
  );

  const handleRevoke = async (record: ApiKeyRecord) => {
    const result = await Swal.fire({
      title: `Revoke ${record.name}?`,
      text: "This key will stop working for all Trainup integrations using it.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Revoke",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const response = await AxiosHelper.deleteData<boolean>(`/api-keys/${record.id}`);
    if (response.data.status) {
      toast.success(response.data.message);
      void fetchKeys();
    } else {
      toast.error(response.data.message);
    }
  };

  const filteredKeys = data.record;

  return (
    <PageShell
      title="API keys"
      description="Keep integration credentials helper-driven and scoped to the Trainup routes."
    >

      <div className="admin-reference-toolbar">
        <div className="admin-filter-row w-100">
          <div className="admin-filter-controls">
            <input
              type="text"
              className="form-control"
              placeholder="Search keys or permission level..."
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
              value={permissionFilter}
              onChange={(event) => {
                setPermissionFilter(event.target.value as "all" | "Read Only" | "Read / Write");
                setParam((previous) => ({ ...previous, pageNo: 1 }));
              }}
            >
              <option value="all">All permission</option>
              <option value="Read Only">Read Only</option>
              <option value="Read / Write">Read / Write</option>
            </select>
            <select
              className="form-select"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as "name" | "permission" | "created" | "calls");
                setParam((previous) => ({ ...previous, pageNo: 1 }));
              }}
            >
              <option value="created">Sort by newest</option>
              <option value="name">Sort by name</option>
              <option value="permission">Sort by permission</option>
              <option value="calls">Sort by API calls</option>
            </select>
          </div>
        </div>
        <PermissionBlock permissionKey={PermissionKeys.apiGenerate} allowedKey={AllowedKeys.api}>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <i className="ri-key-2-line me-1" />
            Generate Key
          </button>
        </PermissionBlock>
      </div>

      <div className="card admin-reference-table-card">
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr className="text-center">
                  <th className="table-m-width">Name</th>
                  <th className="table-m-width">Key</th>
                  <th className="table-s-width">Permission</th>
                  <th className="table-s-width">Created</th>
                  <th className="table-s-width">Calls today</th>
                  <th className="table-s-width">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredKeys.map((record) => (
                  <tr key={record.id}>
                    <td>{record.name}</td>
                    <td className="admin-domain-pill">{maskKey(record.key, 18)}</td>
                    <td className="text-center">
                      <span className={`badge ${record.permission === "Read / Write" ? "text-bg-success" : "text-bg-warning"}`}>
                        {record.permission}
                      </span>
                    </td>
                    <td className="text-center">{record.createdAt}</td>
                    <td className="text-center">{record.callsToday.toLocaleString()}</td>
                    <td className="text-center">
                      <PermissionBlock permissionKey={PermissionKeys.apiRevoke} allowedKey={AllowedKeys.api}>
                        <ActionDropdown label={`Open actions for ${record.name}`}>
                          {({ close }) => (
                            <button
                              type="button"
                              className="dropdown-item text-danger"
                              onClick={() => {
                                close();
                                void handleRevoke(record);
                              }}
                            >
                              <i className="bi bi-x-octagon" />
                              <span>Revoke</span>
                            </button>
                          )}
                        </ActionDropdown>
                      </PermissionBlock>
                    </td>
                  </tr>
                ))}
                {filteredKeys.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-empty-state">No API keys matched the selected filters.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <Pagination showStatistics data={data} param={param} setParam={setParam} />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <div className="card h-100">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">API configuration</h2>
              <p className="small text-body-secondary mb-0">Centralized helper settings for LMS API access.</p>
            </div>
            <div className="card-body">
              <Formik
                initialValues={configInitialValues}
                enableReinitialize
                validationSchema={configSchema}
                onSubmit={async (values, { setErrors, setSubmitting }) => {
                  const response = await AxiosHelper.putData<ApiConfiguration, typeof values>("/api-config", values);

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
                        API base URL <span className="text-danger">*</span>
                      </label>
                      <Field name="baseUrl" id="baseUrl" className="form-control" />
                      <ErrorMessage name="baseUrl" component="small" className="text-danger" />
                    </div>
                    <div className="admin-form-grid">
                      <div>
                        <label htmlFor="rateLimitPerMinute" className="form-label">
                          Rate limit <span className="text-danger">*</span>
                        </label>
                        <Field name="rateLimitPerMinute" id="rateLimitPerMinute" type="number" className="form-control" />
                        <ErrorMessage name="rateLimitPerMinute" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="tokenExpiryHours" className="form-label">
                          Token expiry <span className="text-danger">*</span>
                        </label>
                        <Field name="tokenExpiryHours" id="tokenExpiryHours" type="number" className="form-control" />
                        <ErrorMessage name="tokenExpiryHours" component="small" className="text-danger" />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label htmlFor="corsAllowedOrigins" className="form-label">
                        CORS allowed origins <span className="text-danger">*</span>
                      </label>
                      <Field as="textarea" rows={4} name="corsAllowedOrigins" id="corsAllowedOrigins" className="form-control admin-domain-pill" />
                      <ErrorMessage name="corsAllowedOrigins" component="small" className="text-danger" />
                    </div>
                    <div className="d-flex justify-content-end pt-3">
                      <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? "Saving..." : "Save configuration"}
                      </button>
                    </div>
                  </Form>
                )}
              </Formik>
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-6">
          <div className="card h-100">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">Endpoint reference</h2>
              <p className="small text-body-secondary mb-0">Current routes exposed through the helper layer.</p>
            </div>
            <div className="card-body">
              <div className="admin-settings-list">
                {config?.endpoints.map((endpoint) => (
                  <div key={endpoint.path} className="admin-settings-item">
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span className={`badge ${endpoint.badgeClass}`}>{endpoint.method}</span>
                      <code>{endpoint.path}</code>
                    </div>
                    <div className="small text-body-secondary">{endpoint.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal show={open} onClose={() => setOpen(false)} title="Generate API Key" centered>
        <Formik
          initialValues={defaultValues}
          validationSchema={keySchema}
          onSubmit={async (values, { resetForm, setErrors }) => {
            setLoader(true);
            const response = await AxiosHelper.postData<ApiKeyRecord, ApiKeyFormValues>("/api-keys", values);

            if (response.data.status) {
              toast.success(response.data.message);
              setOpen(false);
              await fetchKeys();
              resetForm();
            } else {
              setErrors((response.data.data || {}) as unknown as Record<string, string>);
              toast.error(response.data.message);
            }

            setLoader(false);
          }}
        >
          {() => (
            <Form>
              <div className="mb-3">
                <label htmlFor="name" className="form-label">
                  Key name <span className="text-danger">*</span>
                </label>
                <Field name="name" id="name" className="form-control" />
                <ErrorMessage name="name" component="small" className="text-danger" />
              </div>
              <div className="mb-3">
                <label htmlFor="permission" className="form-label">
                  Permission <span className="text-danger">*</span>
                </label>
                <Field as="select" name="permission" id="permission" className="form-select">
                  <option value="Read Only">Read Only</option>
                  <option value="Read / Write">Read / Write</option>
                </Field>
                <ErrorMessage name="permission" component="small" className="text-danger" />
              </div>
              <div className="d-flex justify-content-end gap-2 pt-3">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={loader}>
                  {loader ? "Generating..." : "Generate"}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </Modal>
    </PageShell>
  );
};

export default ApiKeys;
