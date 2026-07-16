import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import PageShell from "../../component/common/PageShell";
import type { AdminUser } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";
import { sanitizePhoneInput } from "../../helper/validation";
import { updateAdmin } from "../../redux/authSlice";

const validationSchema = Yup.object({
  name: Yup.string().required("Name is required."),
  email: Yup.string().email("Use a valid email address.").required("Email is required."),
  currentPassword: Yup.string().test("current-password-required", "Current password is required.", function (value) {
    const { newPassword, confirmPassword } = this.parent as { newPassword?: string; confirmPassword?: string };
    const shouldValidatePassword = [newPassword, confirmPassword].some((item) => String(item || "").trim());
    return !shouldValidatePassword || Boolean(String(value || "").trim());
  }),
  newPassword: Yup.string()
    .test("new-password-required", "New password is required.", function (value) {
      const { confirmPassword } = this.parent as { confirmPassword?: string };
      const shouldValidatePassword = [confirmPassword].some((item) => String(item || "").trim());
      return !shouldValidatePassword || Boolean(String(value || "").trim());
    })
    .test("new-password-min", "Password must be at least 6 characters.", (value) => !String(value || "").trim() || String(value || "").trim().length >= 6),
  confirmPassword: Yup.string().test("confirm-password-match", "Passwords must match.", function (value) {
    const { newPassword } = this.parent as { newPassword?: string };
    const normalizedNewPassword = String(newPassword || "").trim();
    return !normalizedNewPassword || String(value || "").trim() === normalizedNewPassword;
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

const Profile = () => {
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const [initialValues, setInitialValues] = useState(buildProfileInitialValues(admin));
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

  const fetchProfile = useCallback(async () => {
    const response = await AxiosHelper.getData<AdminUser>("/profile");
    if (response.data.status) {
      dispatch(updateAdmin(response.data.data));
      setInitialValues(buildProfileInitialValues(response.data.data));
    }
  }, [dispatch]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  return (
    <PageShell title="Profile" description="Update your personal account information for this workspace.">
      <Formik
        initialValues={initialValues}
        enableReinitialize
        validationSchema={validationSchema}
        onSubmit={async (values, { setErrors }) => {
          setSaving(true);
          const response = await AxiosHelper.putData<AdminUser, typeof values>("/profile", values);

          if (response.data.status) {
            dispatch(updateAdmin(response.data.data));
            setInitialValues(buildProfileInitialValues(response.data.data));
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
            <div className="card mb-3">
              <div className="card-body d-flex flex-wrap gap-2">
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
            </div>

            <div className="card">
              <div className="card-body">
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
                          <label htmlFor="profile-image" className="btn btn-light btn-sm">
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
                          id="profile-image"
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
                        <label htmlFor="profile-name" className="form-label">Name</label>
                        <Field id="profile-name" name="name" className="form-control" />
                        <ErrorMessage name="name" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="profile-email" className="form-label">Email</label>
                        <Field id="profile-email" name="email" className="form-control" />
                        <ErrorMessage name="email" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="profile-phone" className="form-label">Phone</label>
                        <Field
                          id="profile-phone"
                          name="phone"
                          className="form-control"
                          inputMode="numeric"
                          value={values.phone}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            void setFieldValue("phone", sanitizePhoneInput(e.target.value))
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="profile-title" className="form-label">Role</label>
                        <Field id="profile-title" name="title" className="form-control" />
                      </div>
                      <div>
                        <label htmlFor="profile-department" className="form-label">Department</label>
                        <Field id="profile-department" name="department" className="form-control" />
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
                        <label htmlFor="profile-current-password" className="form-label">Current password</label>
                        <Field id="profile-current-password" name="currentPassword" type="password" className="form-control" autoComplete="current-password" />
                        <ErrorMessage name="currentPassword" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="profile-new-password" className="form-label">New password</label>
                        <Field id="profile-new-password" name="newPassword" type="password" className="form-control" autoComplete="new-password" />
                        <ErrorMessage name="newPassword" component="small" className="text-danger" />
                      </div>
                      <div>
                        <label htmlFor="profile-confirm-password" className="form-label">Confirm password</label>
                        <Field id="profile-confirm-password" name="confirmPassword" type="password" className="form-control" autoComplete="new-password" />
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
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </PageShell>
  );
};

export default Profile;
