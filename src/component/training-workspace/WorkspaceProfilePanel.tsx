import { useCallback, useEffect, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import type { AdminUser } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";

type WorkspaceProfilePanelProps = {
  onProfileChange: (profile: AdminUser) => void;
};

const validationSchema = Yup.object({
  name: Yup.string().required("Name is required."),
  email: Yup.string().email("Use a valid email address.").required("Email is required."),
  currentPassword: Yup.string().test("current-password-required", "Current password is required.", function (value) {
    const { newPassword, confirmPassword } = this.parent as { newPassword?: string; confirmPassword?: string };
    return !(newPassword || confirmPassword) || Boolean(value);
  }),
  newPassword: Yup.string()
    .test("new-password-required", "New password is required.", function (value) {
      const { currentPassword, confirmPassword } = this.parent as { currentPassword?: string; confirmPassword?: string };
      return !(currentPassword || confirmPassword) || Boolean(value);
    })
    .test("new-password-min", "Password must be at least 6 characters.", (value) => !value || value.length >= 6),
  confirmPassword: Yup.string().test("confirm-password-match", "Passwords must match.", function (value) {
    const { newPassword } = this.parent as { newPassword?: string };
    return !newPassword || value === newPassword;
  }),
});

const buildProfileInitialValues = (profile: AdminUser) => ({
  name: profile.fullname || profile.name,
  email: profile.email,
  phone: profile.phone || "",
  title: profile.title || "",
  department: profile.department || "",
  image: profile.image || "",
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const WorkspaceProfilePanel = ({ onProfileChange }: WorkspaceProfilePanelProps) => {
  const [initialValues, setInitialValues] = useState({
    name: "",
    email: "",
    phone: "",
    title: "",
    department: "",
    image: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

  const fetchProfile = useCallback(async () => {
    const response = await AxiosHelper.getData<AdminUser>("/profile");

    if (response.data.status) {
      setInitialValues(buildProfileInitialValues(response.data.data));
      onProfileChange(response.data.data);
    } else {
      toast.error(response.data.message);
    }

    setLoading(false);
  }, [onProfileChange]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return (
      <div className="card">
        <div className="card-body p-4">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body">
        <Formik
          initialValues={initialValues}
          enableReinitialize
          validationSchema={validationSchema}
          onSubmit={async (values, { setErrors }) => {
            setSaving(true);
            const response = await AxiosHelper.putData<AdminUser, typeof values>("/profile", values);

            if (response.data.status) {
              setInitialValues(buildProfileInitialValues(response.data.data));
              onProfileChange(response.data.data);
              toast.success(response.data.message);
            } else {
              setErrors((response.data.data || {}) as unknown as Record<string, string>);
              toast.error(response.data.message);
            }

            setSaving(false);
          }}
        >
          {({ values, setFieldValue }) => (
            <Form>
              <div className="d-flex flex-wrap gap-2 mb-4 pb-3 border-bottom">
                <button
                  type="button"
                  className={`btn btn-sm ${activeTab === "details" ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => {
                    setActiveTab("details");
                    void setFieldValue("currentPassword", "");
                    void setFieldValue("newPassword", "");
                    void setFieldValue("confirmPassword", "");
                  }}
                >
                  Profile details
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${activeTab === "password" ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setActiveTab("password")}
                >
                  Password
                </button>
              </div>

              {activeTab === "details" && (
                <div className="app-profile-editor">
                  <div className="app-profile-avatar-panel">
                    <div className="app-profile-avatar-preview">
                      {values.image ? (
                        <img src={values.image} alt={values.name || "Profile"} />
                      ) : (
                        <span>{(values.name || "U").slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      <div className="app-profile-avatar-title">Profile photo</div>
                      <p className="app-profile-avatar-help">Upload a square JPG or PNG for the account menu and workspace identity.</p>
                      <div className="app-profile-avatar-actions">
                        <label htmlFor="workspace-profile-image" className="btn btn-light btn-sm">
                          <i className="ri-upload-cloud-2-line" />
                          Upload photo
                        </label>
                        {values.image ? (
                          <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => void setFieldValue("image", "")}>
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <input
                        id="workspace-profile-image"
                        type="file"
                        accept="image/*"
                        className="visually-hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";

                          if (!file) {
                            return;
                          }

                          if (!file.type.startsWith("image/")) {
                            toast.error("Upload a valid image file.");
                            return;
                          }

                          if (file.size > 1024 * 1024) {
                            toast.error("Profile photo must be under 1 MB.");
                            return;
                          }

                          const reader = new FileReader();
                          reader.onload = () => {
                            void setFieldValue("image", String(reader.result || ""));
                          };
                          reader.onerror = () => toast.error("Unable to read the selected image.");
                          reader.readAsDataURL(file);
                        }}
                      />
                    </div>
                  </div>

                  <div className="admin-form-grid">
                    <div>
                      <label htmlFor="workspace-profile-name" className="form-label">Name</label>
                      <Field id="workspace-profile-name" name="name" className="form-control" />
                      <ErrorMessage name="name" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="workspace-profile-email" className="form-label">Email</label>
                      <Field id="workspace-profile-email" name="email" className="form-control" />
                      <ErrorMessage name="email" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="workspace-profile-phone" className="form-label">Phone</label>
                      <Field id="workspace-profile-phone" name="phone" className="form-control" />
                    </div>
                    <div>
                      <label htmlFor="workspace-profile-title" className="form-label">Role</label>
                      <Field id="workspace-profile-title" name="title" className="form-control" />
                    </div>
                    <div>
                      <label htmlFor="workspace-profile-department" className="form-label">Department</label>
                      <Field id="workspace-profile-department" name="department" className="form-control" />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "password" && (
                <div className="app-profile-password-panel">
                  <div className="d-flex align-items-center justify-content-between mb-3">
                    <div>
                      <h2 className="h6 fw-semibold mb-1">Update password</h2>
                      <p className="small text-body-secondary mb-0">Enter your current password before setting a new one.</p>
                    </div>
                    <Link to="/forgot-password" target="_blank" className="btn btn-outline-secondary btn-sm">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="admin-form-grid">
                    <div>
                      <label htmlFor="workspace-profile-current-password" className="form-label">Current password</label>
                      <Field id="workspace-profile-current-password" name="currentPassword" type="password" className="form-control" autoComplete="current-password" />
                      <ErrorMessage name="currentPassword" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="workspace-profile-new-password" className="form-label">New password</label>
                      <Field id="workspace-profile-new-password" name="newPassword" type="password" className="form-control" autoComplete="new-password" />
                      <ErrorMessage name="newPassword" component="small" className="text-danger" />
                    </div>
                    <div>
                      <label htmlFor="workspace-profile-confirm-password" className="form-label">Confirm password</label>
                      <Field id="workspace-profile-confirm-password" name="confirmPassword" type="password" className="form-control" autoComplete="new-password" />
                      <ErrorMessage name="confirmPassword" component="small" className="text-danger" />
                    </div>
                  </div>
                </div>
              )}

              <div className="d-flex justify-content-end pt-4 border-top mt-4">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving..." : activeTab === "password" ? "Update password" : "Save profile details"}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
};

export default WorkspaceProfilePanel;
