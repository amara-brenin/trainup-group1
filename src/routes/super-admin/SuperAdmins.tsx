import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import * as Yup from "yup";
import { useAppSelector } from "../../app/hooks";
import { Modal } from "../../component/common/Modal";
import PageShell from "../../component/common/PageShell";
import { Pagination } from "../../component/common/Pagination";
import type {
  PageParamState,
  PaginatedResponse,
  SuperAdminFormValues,
  SuperAdminRecord,
} from "../../constant/interfaces";
import { getScopedAppPath } from "../../helper/appShell";
import AxiosHelper from "../../helper/AxiosHelper";
import { sanitizePhoneInput } from "../../helper/validation";
import { useDebounce } from "../../hooks/useDebounce";

const defaultValues: SuperAdminFormValues = {
  name: "",
  email: "",
  phone: "",
  password: "",
  status: "active",
  image: "",
};

const createValidationSchema = Yup.object({
  name: Yup.string().trim().required("Name is required."),
  email: Yup.string().email("Use a valid email address.").required("Email is required."),
  phone: Yup.string().trim().required("Mobile is required.").matches(/^\d{7,15}$/, "Enter a valid mobile number (digits only)."),
  status: Yup.string().oneOf(["active", "inactive"]).required("Status is required."),
  image: Yup.string().optional(),
});

const updateValidationSchema = createValidationSchema;

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleDateString("en-GB");
};

const SuperAdmins = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAppSelector((state) => state.admin);
  const [open, setOpen] = useState(false);
  const [loader, setLoader] = useState(false);
  const [editing, setEditing] = useState<SuperAdminRecord | null>(null);
  const [imageName, setImageName] = useState("No file chosen");
  const [data, setData] = useState<PaginatedResponse<SuperAdminRecord>>({
    count: 0,
    totalPages: 1,
    record: [],
    pagination: [1],
  });
  const [param, setParam] = useState<PageParamState>({ limit: 5, pageNo: 1, query: "" });
  const debouncedQuery = useDebounce(param.query);

  const pageTitle = "Staff management";
  const pageDescription = "Manage platform staff members, their access levels, and account status.";

  useEffect(() => {
    if (location.pathname !== "/staff/create") {
      return;
    }

    setEditing(null);
    setImageName("No file chosen");
    setOpen(true);
    navigate("/staff", { replace: true });
  }, [location.pathname, navigate]);

  const fetchRecords = useCallback(async () => {
    const { data: response } = await AxiosHelper.getData<PaginatedResponse<SuperAdminRecord>>("/super-admins", {
      limit: param.limit,
      pageNo: param.pageNo,
      query: debouncedQuery,
    });

    if (response.status) {
      setData(response.data);
    }
  }, [debouncedQuery, param.limit, param.pageNo]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const initialValues = useMemo<SuperAdminFormValues>(
    () =>
      editing
        ? {
          id: editing.id,
          name: editing.name,
          email: editing.email,
          phone: editing.phone,
          password: "",
          status: editing.status,
          image: editing.image || "",
        }
        : defaultValues,
    [editing],
  );

  if (admin.role !== "super_admin") {
    return <Navigate to={getScopedAppPath("/dashboard", admin.role)} replace />;
  }

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
    setImageName("No file chosen");
  };

  const handleDelete = async (record: SuperAdminRecord) => {
    const result = await Swal.fire({
      title: `Delete ${record.name}?`,
      text: "This super admin account will be removed from the platform.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const response = await AxiosHelper.deleteData<boolean>(`/super-admins/${record.id}`);
    if (response.data.status) {
      toast.success(response.data.message);
      await fetchRecords();
      return;
    }

    toast.error(response.data.message);
  };

  const handlePasswordEmail = async (record: SuperAdminRecord) => {
    const response = await AxiosHelper.postData<{ expiresAt: string }, Record<string, never>>(`/super-admins/${record.id}/password-email`, {});
    if (response.data.status) {
      toast.success(response.data.message);
      return;
    }

    toast.error(response.data.message);
  };

  return (
    <PageShell
      title={pageTitle}
      description={pageDescription}
    >

      <div className="admin-reference-toolbar">
        <div className="admin-filter-row w-100">
          <div className="admin-filter-controls">
            <input
              type="text"
              className="form-control"
              placeholder="Search super admins"
              value={param.query}
              onChange={(event) =>
                setParam((previous) => ({
                  ...previous,
                  pageNo: 1,
                  query: event.target.value,
                }))
              }
            />
          </div>
        </div>

        <div className="admin-page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setImageName("No file chosen");
              setOpen(true);
            }}
          >
            <i className="ri-user-star-line me-1" />
            Add Staff
          </button>
          {/* <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
                <i className="ri-arrow-left-line me-1" />
                Back
              </button> */}
        </div>
      </div>

      <div className="card admin-reference-table-card">
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr className="text-center">
                  <th>Name</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ width: 124 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.record.length ? (
                  data.record.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <img
                            src={record.image || "/branding/avatar.png"}
                            alt={record.name}
                            width={36}
                            height={36}
                            className="rounded-circle object-fit-cover border"
                          />
                          <span className="fw-medium">{record.name}</span>
                        </div>
                      </td>
                      <td>{record.email}</td>
                      <td>{record.phone || "-"}</td>
                      <td>{formatDate(record.createdAt)}</td>
                      <td className="text-center">
                        <span className={`badge ${record.status === "active" ? "text-bg-success" : "text-bg-secondary"}`}>
                          {record.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="admin-inline-actions">
                          <button
                            type="button"
                            className="admin-inline-action-btn permission"
                            onClick={() => void handlePasswordEmail(record)}
                            aria-label={`Send password email to ${record.name}`}
                          >
                            <i className="ri-mail-send-line" />
                          </button>
                          <button
                            type="button"
                            className="admin-inline-action-btn edit"
                            onClick={() => {
                              setEditing(record);
                              setImageName("No file chosen");
                              setOpen(true);
                            }}
                            aria-label={`Edit ${record.name}`}
                          >
                            <i className="ri-pencil-line" />
                          </button>
                          <button
                            type="button"
                            className="admin-inline-action-btn delete"
                            onClick={() => void handleDelete(record)}
                            disabled={record.id === admin._id}
                            aria-label={`Delete ${record.name}`}
                          >
                            <i className="ri-delete-bin-line" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-empty-state">No super admin records found.</div>
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
        show={open}
        title={editing ? "Update Super Admin" : "Create Super Admin"}
        onClose={handleClose}
        size="lg"
        centered
      >
        <Formik
          initialValues={initialValues}
          validationSchema={editing ? updateValidationSchema : createValidationSchema}
          enableReinitialize
          onSubmit={async (values, { setErrors, resetForm }) => {
            setLoader(true);
            const endpoint = editing ? `/super-admins/${editing.id}` : "/super-admins";
            const request = editing
              ? AxiosHelper.putData<SuperAdminRecord, SuperAdminFormValues>(endpoint, values)
              : AxiosHelper.postData<SuperAdminRecord, SuperAdminFormValues>(endpoint, values);
            const response = await request;
            setLoader(false);

            if (!response.data.status) {
              setErrors((response.data.data as unknown as Record<string, string>) || {});
              toast.error(response.data.message);
              return;
            }

            toast.success(response.data.message);
            resetForm();
            handleClose();
            await fetchRecords();
          }}
        >
          {({ isSubmitting, setFieldValue, values }) => (
            <Form>
              <div className="row g-3">
                <div className="col-md-6">
                  <label htmlFor="super-admin-name" className="form-label">
                    Name <span className="text-danger">*</span>
                  </label>
                  <Field id="super-admin-name" name="name" className="form-control" placeholder="Enter full name." />
                  <div className="text-danger small mt-1">
                    <ErrorMessage name="name" />
                  </div>
                </div>
                <div className="col-md-6">
                  <label htmlFor="super-admin-phone" className="form-label">
                    Mobile <span className="text-danger">*</span>
                  </label>
                  <Field
                    id="super-admin-phone"
                    name="phone"
                    className="form-control"
                    placeholder="Enter mobile number"
                    inputMode="numeric"
                    value={values.phone}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      void setFieldValue("phone", sanitizePhoneInput(e.target.value))
                    }
                  />
                  <div className="text-danger small mt-1">
                    <ErrorMessage name="phone" />
                  </div>
                </div>
                <div className="col-md-6">
                  <label htmlFor="super-admin-email" className="form-label">
                    Email <span className="text-danger">*</span>
                  </label>
                  <Field id="super-admin-email" type="email" name="email" className="form-control" placeholder="Enter email address" />
                  <div className="text-danger small mt-1">
                    <ErrorMessage name="email" />
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="alert alert-light border mb-0">
                    New super admins receive a secure Brenin SMTP set-password email.
                  </div>
                </div>
                <div className="col-md-6">
                  <label htmlFor="super-admin-status" className="form-label">Status</label>
                  <Field as="select" id="super-admin-status" name="status" className="form-select">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Field>
                </div>
                <div className="col-md-6">
                  <label htmlFor="super-admin-image" className="form-label">Image</label>
                  <input
                    id="super-admin-image"
                    type="file"
                    className="form-control"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) {
                        return;
                      }

                      setImageName(file.name);
                      const reader = new FileReader();
                      reader.onload = () => {
                        void setFieldValue("image", String(reader.result || ""));
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <div className="small text-body-secondary mt-1">{imageName}</div>
                </div>
                {values.image ? (
                  <div className="col-12">
                    {/* <div className="d-flex align-items-center gap-3 rounded border p-3 bg-light-subtle">
                      <img
                        src={values.image}
                        alt="Super admin preview"
                        width={52}
                        height={52}
                        className="rounded-circle object-fit-cover border"
                      />
                      <div className="small text-body-secondary">Image preview</div>
                    </div> */}
                  </div>
                ) : null}
                <div className="col-12">
                  <button type="submit" className="btn btn-primary" disabled={loader || isSubmitting}>
                    {loader ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      </Modal>
    </PageShell>
  );
};

export default SuperAdmins;
