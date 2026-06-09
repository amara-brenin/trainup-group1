import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import * as Yup from "yup";
import { Modal } from "../../component/common/Modal";
import PageShell from "../../component/common/PageShell";
import { Pagination } from "../../component/common/Pagination";
import { PermissionBlock } from "../../component/common/PermissionBlock";
import type { BillingSummary, PageParamState, PaginatedResponse, UserRecord } from "../../constant/interfaces";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import AxiosHelper from "../../helper/AxiosHelper";
import { useDebounce } from "../../hooks/useDebounce";

type TraineeFormValues = {
  id?: string;
  name: string;
  email: string;
  status: "active" | "inactive";
};

type TraineeImportPayload = {
  rows: Array<{
    name: string;
    email: string;
    status: "active" | "inactive";
  }>;
};

const defaultValues: TraineeFormValues = {
  name: "",
  email: "",
  status: "active",
};

const downloadTemplate = () => {
  const csv = [
    "name,email,status",
    "Aarav Patel,aarav.patel@example.com,active",
    "Bharat Goyal,bharat.goyal@example.com,inactive",
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "trainee-import-template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const parseCsvRows = (content: string) => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const splitLine = (line: string) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
  const firstRow = splitLine(lines[0]);
  const headerLike = firstRow.some((cell) => ["name", "email", "status"].includes(cell.toLowerCase()));
  const header = headerLike ? firstRow.map((cell) => cell.toLowerCase()) : ["name", "email", "status"];
  const dataLines = headerLike ? lines.slice(1) : lines;

  return dataLines
    .map(splitLine)
    .filter((cells) => cells.some(Boolean))
    .map((cells): TraineeImportPayload["rows"][number] => {
      const values = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
      return {
        name: String(values.name || "").trim(),
        email: String(values.email || "").trim(),
        status: String(values.status || "active").trim().toLowerCase() === "inactive" ? "inactive" : "active",
      };
    });
  };

const Trainees = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState<null | "add" | "edit" | "import">(null);
  const [loader, setLoader] = useState(false);
  const [checkingUserLimit, setCheckingUserLimit] = useState(false);
  const [initialValues, setInitialValues] = useState<TraineeFormValues>(defaultValues);
  const [data, setData] = useState<PaginatedResponse<UserRecord>>({
    count: 0,
    totalPages: 1,
    record: [],
    pagination: [1],
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [param, setParam] = useState<PageParamState>({ limit: 10, pageNo: 1, query: "" });
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [sortBy, setSortBy] = useState<"name" | "status" | "activity">("name");
  const [csvRows, setCsvRows] = useState<TraineeImportPayload["rows"]>([]);
  const debouncedQuery = useDebounce(param.query);

  const validationSchema = useMemo(
    () =>
      Yup.object({
        name: Yup.string().trim().required("Name is required."),
        email: Yup.string().email("Use a valid email address.").required("Email is required."),
        status: Yup.string().required("Status is required."),
      }),
    [open],
  );

  const fetchRecords = useCallback(async () => {
    const response = await AxiosHelper.getData<PaginatedResponse<UserRecord>>("/trainees", {
      limit: param.limit,
      pageNo: param.pageNo,
      query: debouncedQuery,
      status: statusFilter,
      sortBy,
    });

    if (response.data.status) {
      setData(response.data.data);
    }
  }, [debouncedQuery, param.limit, param.pageNo, sortBy, statusFilter]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => data.record.some((row) => row.id === id)));
  }, [data.record]);

  const filteredRecords = data.record;

  const allSelected = filteredRecords.length > 0 && filteredRecords.every((record) => selectedIds.includes(record.id));

  const handleClose = () => {
    setOpen(null);
    setInitialValues(defaultValues);
    setCsvRows([]);
  };

  const ensureUserCapacity = async (additionalUsers = 1) => {
    setCheckingUserLimit(true);
    try {
      const response = await AxiosHelper.getData<BillingSummary>("/billing/summary");
      const summary = response.data.data;
      const userLimit = summary?.planLimits?.users;
      const currentUserCount = summary?.activeUsers ?? summary?.planUsage?.users ?? data.count;

      if (!response.data.status) {
        toast.error(response.data.message || "Unable to verify user limit.");
        return false;
      }

      if (userLimit !== null && userLimit !== undefined && currentUserCount + additionalUsers > userLimit) {
        toast.error(`Current ${summary.currentPlan} plan allows only ${userLimit} active user${userLimit === 1 ? "" : "s"}. This action would take the company to ${currentUserCount + additionalUsers}. Upgrade your plan before adding more trainees.`);
        return false;
      }

      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify user limit.");
      return false;
    } finally {
      setCheckingUserLimit(false);
    }
  };

  const openAddTraineeModal = async () => {
    if (!(await ensureUserCapacity(1))) {
      return;
    }

    setInitialValues(defaultValues);
    setOpen("add");
  };

  const handleEdit = (user: UserRecord) => {
    setInitialValues({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
    });
    setOpen("edit");
  };

  const handleDelete = async (user: UserRecord) => {
    const result = await Swal.fire({
      title: `Remove ${user.name}?`,
      text: "This removes the trainee profile from the learner directory.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Remove",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const response = await AxiosHelper.deleteData<boolean>(`/trainees/${user.id}`);
    if (response.data.status) {
      toast.success(response.data.message);
      await fetchRecords();
      setSelectedIds((current) => current.filter((id) => id !== user.id));
    } else {
      toast.error(response.data.message);
    }
  };

  const handleRemoveSelected = async () => {
    if (!selectedIds.length) {
      return;
    }

    const result = await Swal.fire({
      title: `Remove ${selectedIds.length} trainees?`,
      text: "This removes the selected learner profiles from the directory.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Remove selected",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    for (const id of selectedIds) {
      await AxiosHelper.deleteData<boolean>(`/trainees/${id}`);
    }

    toast.success("Selected trainees removed.");
    setSelectedIds([]);
    await fetchRecords();
  };

  return (
    <PageShell>
      <div className="admin-reference-toolbar">
        <div className="admin-filter-row w-100">
          <div className="admin-filter-controls">
            <input
              type="text"
              className="form-control"
              placeholder="Search trainees by name or email"
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
                setStatusFilter(event.target.value as "all" | "active" | "inactive");
                setParam((previous) => ({ ...previous, pageNo: 1 }));
              }}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              className="form-select"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as "name" | "status" | "activity");
                setParam((previous) => ({ ...previous, pageNo: 1 }));
              }}
            >
              <option value="name">Sort by name</option>
              <option value="status">Sort by status</option>
              <option value="activity">Sort by last active</option>
            </select>
          </div>
        </div>

        <div className="admin-page-actions admin-page-actions-inline">
          {selectedIds.length ? (
            <PermissionBlock permissionKey={PermissionKeys.traineesDelete} allowedKey={AllowedKeys.trainees}>
              <button type="button" className="btn btn-outline-danger" onClick={() => void handleRemoveSelected()}>
                <i className="ri-delete-bin-line me-1" />
                Remove Selected ({selectedIds.length})
              </button>
            </PermissionBlock>
          ) : null}
          <PermissionBlock permissionKey={PermissionKeys.traineesAdd} allowedKey={AllowedKeys.trainees}>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen("import")}>
              <i className="ri-file-upload-line me-1" />
              Upload CSV
            </button>
          </PermissionBlock>
          <PermissionBlock permissionKey={PermissionKeys.traineesAdd} allowedKey={AllowedKeys.trainees}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={checkingUserLimit}
              onClick={() => void openAddTraineeModal()}
            >
              <i className="ri-user-add-line me-1" />
              {checkingUserLimit ? "Checking..." : "Add Trainee"}
            </button>
          </PermissionBlock>
        </div>
      </div>

      <div className="card admin-reference-table-card">
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr className="text-center">
                  <th style={{ width: 54 }}>
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelectedIds(event.target.checked ? filteredRecords.map((record) => record.id) : [])
                      }
                    />
                  </th>
                  <th className="table-m-width">Trainee</th>
                  <th className="table-s-width">Status</th>
                  <th className="table-s-width">Trainings</th>
                  <th className="table-m-width">Last Active</th>
                  <th className="table-m-width">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length ? (
                  filteredRecords.map((record) => {
                    const isSelected = selectedIds.includes(record.id);
                    return (
                      <tr key={record.id}>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={isSelected}
                            onChange={(event) =>
                              setSelectedIds((current) =>
                                event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <div className="fw-semibold">{record.name}</div>
                          <div className="small text-body-secondary">{record.email}</div>
                        </td>
                        <td className="text-center">
                          <span className={`badge ${record.status === "active" ? "text-bg-success" : "text-bg-secondary"}`}>
                            {record.status === "active" ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="text-center">{record.trainings}</td>
                        <td>{record.lastActive}</td>
                        <td>
                          <div className="admin-inline-actions">
                            <PermissionBlock permissionKey={PermissionKeys.traineesReport} allowedKey={AllowedKeys.trainees}>
                              <button
                                type="button"
                                className="admin-inline-action-btn permission"
                                onClick={() => navigate(`/trainees/${record.id}/report`)}
                                aria-label={`Report for ${record.name}`}
                              >
                                <i className="ri-file-chart-line" />
                              </button>
                            </PermissionBlock>
                            {/* <PermissionBlock permissionKey={PermissionKeys.traineesEdit} allowedKey={AllowedKeys.trainees}>
                              <button type="button" className="admin-inline-action-btn permission" onClick={() => void handlePasswordEmail(record)} aria-label={`Send password email to ${record.name}`}>
                                <i className="ri-mail-send-line" />
                              </button>
                            </PermissionBlock> */}
                            <PermissionBlock permissionKey={PermissionKeys.traineesEdit} allowedKey={AllowedKeys.trainees}>
                              <button type="button" className="admin-inline-action-btn edit" onClick={() => handleEdit(record)} aria-label={`Edit ${record.name}`}>
                                <i className="ri-pencil-line" />
                              </button>
                            </PermissionBlock>
                            <PermissionBlock permissionKey={PermissionKeys.traineesDelete} allowedKey={AllowedKeys.trainees}>
                              <button type="button" className="admin-inline-action-btn delete" onClick={() => void handleDelete(record)} aria-label={`Delete ${record.name}`}>
                                <i className="ri-delete-bin-line" />
                              </button>
                            </PermissionBlock>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-empty-state">No trainees matched the current filters.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination data={data} param={param} setParam={setParam} showStatistics />
        </div>
      </div>

      <Modal
        show={open === "add" || open === "edit"}
        onClose={handleClose}
        title={open === "edit" ? "Update Trainee" : "Add Trainee"}
        size="lg"
        centered
      >
        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          enableReinitialize
          onSubmit={async (values, { resetForm, setErrors }) => {
            setLoader(true);
            const response =
              open === "edit"
                ? await AxiosHelper.putData<UserRecord, TraineeFormValues>(`/trainees/${values.id}`, values)
                : await AxiosHelper.postData<UserRecord, TraineeFormValues>("/trainees", values);

            if (response.data.status) {
              toast.success(response.data.message);
              resetForm();
              handleClose();
              await fetchRecords();
            } else {
              setErrors((response.data.data || {}) as unknown as Record<string, string>);
              toast.error(response.data.message);
            }

            setLoader(false);
          }}
        >
          {({ isSubmitting }) => (
            <Form>
              <div className="row g-3">
                <div className="col-md-6">
                  <label htmlFor="trainee-name" className="form-label">Name <span className="text-danger">*</span></label>
                  <Field id="trainee-name" name="name" className="form-control" />
                  <ErrorMessage name="name" component="small" className="text-danger" />
                </div>
                <div className="col-md-6">
                  <label htmlFor="trainee-email" className="form-label">Email <span className="text-danger">*</span></label>
                  <Field id="trainee-email" name="email" type="email" className="form-control" />
                  <ErrorMessage name="email" component="small" className="text-danger" />
                </div>
                <div className="col-md-6">
                  <label htmlFor="trainee-status" className="form-label">Status</label>
                  <Field as="select" id="trainee-status" name="status" className="form-select">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Field>
                </div>
                <div className="col-md-6">
                  <div className="alert alert-light border mb-0">
                    A secure set-password email will be sent to this trainee.
                  </div>
                </div>
                <div className="col-12 d-flex justify-content-end">
                  <button type="submit" className="btn btn-primary" disabled={loader || isSubmitting}>
                    {loader ? "Saving..." : "Save trainee"}
                  </button>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      </Modal>

      <Modal show={open === "import"} onClose={handleClose} title="Upload Trainee CSV" size="lg" centered>
        <div className="row g-3">
          <div className="col-12">
            <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
              <label htmlFor="trainee-csv" className="form-label mb-0">CSV file</label>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={downloadTemplate}>
                <i className="ri-download-2-line me-1" />
                Download Template
              </button>
            </div>
            <input
              id="trainee-csv"
              type="file"
              accept=".csv,text/csv"
              className="form-control"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";

                if (!file) {
                  return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                  const nextRows = parseCsvRows(String(reader.result || ""));
                  setCsvRows(nextRows);
                  if (!nextRows.length) {
                    toast.error("No valid CSV rows found.");
                  }
                };
                reader.onerror = () => toast.error("Unable to read CSV file.");
                reader.readAsText(file);
              }}
            />
            <div className="small text-body-secondary mt-1">Supported columns: name, email, status.</div>
          </div>
          <div className="col-12">
            <div className="small text-body-secondary mb-2">
              {csvRows.length ? `${csvRows.length} trainees ready to import.` : "Upload a CSV to preview import rows."}
            </div>
            {csvRows.length ? (
              <div className="table-responsive border rounded-3">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 8).map((row, index) => (
                      <tr key={`${row.email}-${index}`}>
                        <td>{row.name}</td>
                        <td>{row.email}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
          <div className="col-12 d-flex justify-content-end gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!csvRows.length || loader}
              onClick={async () => {
                if (!(await ensureUserCapacity(csvRows.filter((row) => row.status !== "inactive").length))) {
                  return;
                }

                setLoader(true);
                const response = await AxiosHelper.postData<PaginatedResponse<UserRecord>, TraineeImportPayload>("/trainees/import", { rows: csvRows });
                if (response.data.status) {
                  toast.success(response.data.message);
                  handleClose();
                  await fetchRecords();
                } else {
                  toast.error(response.data.message);
                }
                setLoader(false);
              }}
            >
              {loader ? "Importing..." : "Import trainees"}
            </button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
};

export default Trainees;
