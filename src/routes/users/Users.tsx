import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import PermissionMatrix from "../../component/common/PermissionMatrix";
import { Modal } from "../../component/common/Modal";
import { Pagination } from "../../component/common/Pagination";
import { PermissionBlock } from "../../component/common/PermissionBlock";
import {
  filterPermissionModulesForUser,
  fixedRoleDefinitions,
  isSamePermissionSet,
  permissionModules,
} from "../../constant/accessControl";
import type {
  AdminUser,
  BillingSummary,
  PageParamState,
  PaginatedResponse,
  RoleDefinitionRecord,
  RolePermissionsPayload,
  UserFormValues,
  UserRecord,
} from "../../constant/interfaces";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import AxiosHelper from "../../helper/AxiosHelper";
import { impersonateUser } from "../../helper/impersonationApi";
import { useDebounce } from "../../hooks/useDebounce";
import { updateAdmin } from "../../redux/authSlice";

const defaultValues: UserFormValues = {
  name: "",
  email: "",
  role: "trainer",
  status: "active",
  password: "",
  permission: fixedRoleDefinitions.find((definition) => definition.id === "trainer")?.permission ?? [],
};

const filterVisibleRoles = (roles: RoleDefinitionRecord[]) => roles.filter((role) => role.id !== "trainee");

const Users = () => {
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const [open, setOpen] = useState<null | "add" | "edit" | "permissions">(null);
  const [loader, setLoader] = useState(false);
  const [checkingUserLimit, setCheckingUserLimit] = useState(false);
  const [initialValues, setInitialValues] = useState<UserFormValues>(defaultValues);
  const [roleDefinitions, setRoleDefinitions] = useState<RoleDefinitionRecord[]>(fixedRoleDefinitions);
  const [modules, setModules] = useState(filterPermissionModulesForUser(permissionModules, admin.role, admin.permission));
  const [data, setData] = useState<PaginatedResponse<UserRecord>>({
    count: 0,
    totalPages: 1,
    record: [],
    pagination: [1],
  });
  const [param, setParam] = useState<PageParamState>({ limit: 10, pageNo: 1, query: "" });
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "role" | "status" | "activity">("name");
  const debouncedQuery = useDebounce(param.query);
  const availableRoleDefinitions = useMemo(() => filterVisibleRoles(roleDefinitions), [roleDefinitions]);

  const validationSchema = useMemo(
    () =>
      Yup.object({
        name: Yup.string().required("Name is required."),
        email: Yup.string().email("Use a valid email address.").required("Email is required."),
        role: Yup.string().required("Role is required."),
        status: Yup.string().required("Status is required."),
        permission:
          open === "edit"
            ? Yup.array().of(Yup.string())
            : Yup.array().of(Yup.string()).min(1, "Select at least one permission.").required("Permission is required."),
      }),
    [open],
  );

  const getRoleDefaults = useCallback(
    (role: UserFormValues["role"]) => roleDefinitions.find((definition) => definition.id === role)?.permission ?? [],
    [roleDefinitions],
  );

  const refreshCurrentAdminProfile = useCallback(async () => {
    const response = await AxiosHelper.getData<AdminUser>("/profile");

    if (response.data.status) {
      dispatch(updateAdmin(response.data.data));
      return response.data.data;
    }

    return null;
  }, [dispatch]);

  const fetchRoles = useCallback(async () => {
    const response = await AxiosHelper.getData<RolePermissionsPayload>("/roles");

    if (response.data.status) {
      setRoleDefinitions(response.data.data.roles);
      setModules(filterPermissionModulesForUser(response.data.data.modules, admin.role, admin.permission));
    }
  }, [admin.permission, admin.role]);

  const fetchRecords = useCallback(async () => {
    const response = await AxiosHelper.getData<PaginatedResponse<UserRecord>>("/users", {
      limit: param.limit,
      pageNo: param.pageNo,
      query: debouncedQuery,
      status: statusFilter,
      role: roleFilter,
      sortBy,
    });

    if (response.data.status) {
      setData(response.data.data);
    }
  }, [debouncedQuery, param.limit, param.pageNo, roleFilter, sortBy, statusFilter]);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const openAddModal = async () => {
    setCheckingUserLimit(true);
    try {
      const response = await AxiosHelper.getData<BillingSummary>("/billing/summary");
      const summary = response.data.data;
      const userLimit = summary?.planLimits?.users;
      const currentUserCount = summary?.activeUsers ?? summary?.planUsage?.users ?? data.count;

      if (!response.data.status) {
        toast.error(response.data.message || "Unable to verify user limit.");
        return;
      }

      if (userLimit !== null && userLimit !== undefined && currentUserCount >= userLimit) {
        toast.error(`Current ${summary.currentPlan} plan allows only ${userLimit} active user${userLimit === 1 ? "" : "s"}. Upgrade your plan before adding another user.`);
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify user limit.");
      return;
    } finally {
      setCheckingUserLimit(false);
    }

    const defaultRole = availableRoleDefinitions.find((role) => role.id === "trainer" && role.status === "active")?.id
      ?? availableRoleDefinitions.find((role) => role.status === "active")?.id
      ?? "trainer";

    setInitialValues({
      ...defaultValues,
      role: defaultRole,
      permission: getRoleDefaults(defaultRole),
    });
    setOpen("add");
  };

  const handleEdit = (user: UserRecord) => {
    setInitialValues({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role === "super_admin" ? "admin" : user.role,
      status: user.status,
      password: "",
      permission: [...user.permission],
    });
    setOpen("edit");
  };

  const handlePermissions = (user: UserRecord) => {
    if (user.id === admin._id || (user.isPrimaryAdmin && admin.role !== "super_admin")) {
      toast.error(user.id === admin._id ? "You cannot change your own permissions." : "Primary admin permissions can only be changed by a super admin.");
      return;
    }

    setInitialValues({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role === "super_admin" ? "admin" : user.role,
      status: user.status,
      password: "",
      permission: [...user.permission],
    });
    setOpen("permissions");
  };

  const handleDelete = async (user: UserRecord) => {
    if (user.isPrimaryAdmin && admin.role !== "super_admin") {
      toast.error("Primary admin can only be removed by a super admin.");
      return;
    }

    const result = await Swal.fire({
      title: `Remove ${user.name}?`,
      text: "This removes the user from the admin panel access list.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Remove",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const response = await AxiosHelper.deleteData<boolean>(`/users/${user.id}`);

    if (response.data.status) {
      toast.success(response.data.message);
      await fetchRecords();
    } else {
      toast.error(response.data.message);
    }
  };

  // FEATURE 2: Client Admin (or SA-as-CA) → User impersonation.
  const canImpersonateUser = (user: UserRecord) =>
    user.id !== admin._id && user.role !== "super_admin" && user.status === "active";

  const handleImpersonate = async (user: UserRecord) => {
    const result = await Swal.fire({
      title: "Login as User",
      html: "You are about to access this user's panel. Your current admin session will be preserved.",
      icon: "info",
      showCancelButton: true,
      cancelButtonText: "Cancel",
      confirmButtonText: "Continue",
      confirmButtonColor: "#3e60d5",
    });

    if (!result.isConfirmed) {
      return;
    }

    try {
      await impersonateUser(user.id); // redirects into the user's panel on success
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the session.");
    }
  };

  const getPermissionSummary = (user: UserRecord) =>
    modules.filter((moduleItem) => user.allowed.includes(moduleItem.allowedKey)).map((moduleItem) => moduleItem.label);

  const getRoleLabel = (user: UserRecord) =>
    user.roleName || roleDefinitions.find((role) => role.id === user.role)?.roleName || user.role;

  const canOpenPermissionEditor = (user: UserRecord) => user.id !== admin._id && (!user.isPrimaryAdmin || admin.role === "super_admin");
  const canDeleteUser = (user: UserRecord) => !user.isPrimaryAdmin || admin.role === "super_admin";

  const filteredUsers = data.record;

  const submitUserForm = async (
    values: UserFormValues,
    {
      resetForm,
      setErrors,
    }: {
      resetForm: () => void;
      setErrors: (errors: Record<string, string>) => void;
    },
  ) => {
    setLoader(true);

    const response =
      open === "add"
        ? await AxiosHelper.postData<UserRecord, UserFormValues>("/users", values)
        : await AxiosHelper.putData<UserRecord, UserFormValues>(`/users/${values.id}`, values);

    if (response.data.status) {
      setOpen(null);
      toast.success(response.data.message);
      const refreshedAdmin = await refreshCurrentAdminProfile();
      await fetchRecords();
      resetForm();

      if (refreshedAdmin && values.id === refreshedAdmin._id) {
        window.location.reload();
        return;
      }
    } else {
      setErrors(((response.data.data || {}) as unknown) as Record<string, string>);
      toast.error(response.data.message);
    }

    setLoader(false);
  };

  if (open === "permissions") {
    return (
      <div className="role-page-shell">
        <div className="role-permission-hero">
          <div className="role-permission-hero-main">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(null)}>
              <i className="ri-arrow-left-line me-1" />
              Back
            </button>
            <div>
              <div className="role-permission-title">
                User Permission for <span>{initialValues.name || "User"}</span>
              </div>
              <p className="text-body-secondary mb-0">Adjust role defaults and module access for this account.</p>
            </div>
          </div>
        </div>

        <Formik
          initialValues={initialValues}
          enableReinitialize
          validationSchema={validationSchema}
          onSubmit={async (values, { resetForm, setErrors }) =>
            submitUserForm(values, {
              resetForm: () => resetForm(),
              setErrors,
            })}
        >
          {({ values, setFieldValue, isSubmitting }) => {
            const roleDefaults = getRoleDefaults(values.role);
            const customPermission = !isSamePermissionSet(values.permission, roleDefaults);
            const addedCount = values.permission.filter((permissionKey) => !roleDefaults.includes(permissionKey)).length;
            const removedCount = roleDefaults.filter((permissionKey) => !values.permission.includes(permissionKey)).length;

            return (
              <Form className="card">
                <div className="card-body">
                  <div className="mb-4">
                    <label htmlFor="role" className="form-label">
                      Role <span className="text-danger">*</span>
                    </label>
                    <Field
                      as="select"
                      name="role"
                      id="role"
                      className="form-select"
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                        const nextRole = event.target.value as UserFormValues["role"];
                        setFieldValue("role", nextRole);
                        setFieldValue("permission", getRoleDefaults(nextRole));
                      }}
                    >
                      {availableRoleDefinitions
                        .filter((role) => role.status === "active" || role.id === values.role)
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.roleName}
                          </option>
                        ))}
                    </Field>
                    <ErrorMessage name="role" component="small" className="text-danger" />
                  </div>

                  <div className="permission-summary-shell mb-3">
                    <span className={`badge ${customPermission ? "text-bg-warning" : "text-bg-light border text-dark"}`}>
                      {customPermission ? "Custom override" : "Matches role default"}
                    </span>
                    <div className="permission-summary-caption">
                      Default {roleDefaults.length} permissions
                      {customPermission ? `, ${addedCount} added, ${removedCount} removed` : ""}
                    </div>
                    <span className="badge text-bg-primary">{values.permission.length} selected</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      disabled={!customPermission}
                      onClick={() => setFieldValue("permission", roleDefaults)}
                    >
                      Reset to role default
                    </button>
                  </div>

                  <PermissionMatrix
                    modules={modules}
                    baselinePermissions={roleDefaults}
                    selectedPermissions={values.permission}
                    onChange={(permission) => setFieldValue("permission", permission)}
                  />
                  <ErrorMessage name="permission" component="small" className="text-danger d-block mt-2" />

                  <div className="d-flex justify-content-end gap-2 pt-4">
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={loader || isSubmitting}>
                      {loader ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                          Saving...
                        </>
                      ) : (
                        "Save permissions"
                      )}
                    </button>
                  </div>
                </div>
              </Form>
            );
          }}
        </Formik>
      </div>
    );
  }

  if (open === "add") {
    return (
      <div className="role-page-shell">
        <div className="role-permission-hero">
          <div className="role-permission-hero-main">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(null)}>
              <i className="ri-arrow-left-line me-1" />
              Back
            </button>
            <div>
              <div className="role-permission-title">
                Invite <span>User</span>
              </div>
              <p className="text-body-secondary mb-0">Create a new client admin panel user and assign access in one place.</p>
            </div>
          </div>
        </div>

        <Formik
          initialValues={initialValues}
          enableReinitialize
          validationSchema={validationSchema}
          onSubmit={async (values, { resetForm, setErrors }) =>
            submitUserForm(values, {
              resetForm: () => resetForm(),
              setErrors,
            })}
        >
          {({ values, setFieldValue, isSubmitting }) => {
            const roleDefaults = getRoleDefaults(values.role);
            const isCustomPermission = !isSamePermissionSet(values.permission, roleDefaults);
            const addedPermissionCount = values.permission.filter((permissionKey) => !roleDefaults.includes(permissionKey)).length;
            const removedPermissionCount = roleDefaults.filter((permissionKey) => !values.permission.includes(permissionKey)).length;

            return (
              <Form className="card">
                <div className="card-body">
                  <div className="admin-form-grid admin-form-grid-user admin-form-grid-user-top mb-3">
                    <div>
                      <label htmlFor="name" className="form-label">
                        Name <span className="text-danger">*</span>
                      </label>
                      <Field name="name" id="name" className="form-control" />
                      <ErrorMessage name="name" component="small" className="text-danger" />
                    </div>

                    <div>
                      <label htmlFor="email" className="form-label">
                        Email <span className="text-danger">*</span>
                      </label>
                      <Field name="email" id="email" type="email" className="form-control" />
                      <ErrorMessage name="email" component="small" className="text-danger" />
                    </div>

                    <div>
                      <label htmlFor="role" className="form-label">
                        Role <span className="text-danger">*</span>
                      </label>
                      <Field
                        as="select"
                        name="role"
                        id="role"
                        className="form-select"
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          const nextRole = event.target.value as UserFormValues["role"];
                          setFieldValue("role", nextRole);
                          setFieldValue("permission", getRoleDefaults(nextRole));
                        }}
                      >
                        {availableRoleDefinitions
                          .filter((role) => role.status === "active" || role.id === values.role)
                          .map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.roleName}
                            </option>
                          ))}
                      </Field>
                      <ErrorMessage name="role" component="small" className="text-danger" />
                    </div>
                  </div>

                  <div className="admin-form-grid admin-form-grid-user mb-4">
                    <div>
                      <label htmlFor="user-status" className="form-label">
                        Status <span className="text-danger">*</span>
                      </label>
                      <Field as="select" name="status" id="user-status" className="form-select">
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </Field>
                      <ErrorMessage name="status" component="small" className="text-danger" />
                    </div>

                    <div className="d-flex align-items-end">
                      <div className="alert alert-light border mb-0 w-100">
                        A secure set-password email will be sent to this user. No plain-text password is shared.
                      </div>
                    </div>
                  </div>

                  <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                    <div>
                      <h5 className="mb-1">Roles & Permissions</h5>
                      <p className="text-body-secondary small mb-0">
                        Start with the selected role defaults, then turn individual access on or off for this user.
                      </p>
                    </div>
                    <div className="permission-summary-shell">
                      <span className={`badge ${isCustomPermission ? "text-bg-warning" : "text-bg-light border text-dark"}`}>
                        {isCustomPermission ? "Custom override" : "Matches role default"}
                      </span>
                      <div className="permission-summary-caption">
                        Default {roleDefaults.length} permissions
                        {isCustomPermission ? `, ${addedPermissionCount} added, ${removedPermissionCount} removed` : ""}
                      </div>
                      <span className="badge text-bg-primary">{values.permission.length} selected</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled={!isCustomPermission}
                        onClick={() => setFieldValue("permission", roleDefaults)}
                      >
                        Reset to role default
                      </button>
                    </div>
                  </div>

                  <PermissionMatrix
                    modules={modules}
                    baselinePermissions={roleDefaults}
                    selectedPermissions={values.permission}
                    onChange={(permission) => setFieldValue("permission", permission)}
                  />
                  <ErrorMessage name="permission" component="small" className="text-danger d-block mt-2" />

                  <div className="d-flex justify-content-end gap-2 pt-4">
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={loader || isSubmitting}>
                      {loader ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                          Saving...
                        </>
                      ) : (
                        "Invite user"
                      )}
                    </button>
                  </div>
                </div>
              </Form>
            );
          }}
        </Formik>
      </div>
    );
  }

  return (
    <>
      <div className="admin-reference-toolbar">
        <div className="admin-filter-row w-100">
          <div className="admin-filter-controls">
            <input
              type="text"
              className="form-control"
              placeholder="Search users"
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
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setParam((previous) => ({ ...previous, pageNo: 1 }));
              }}
            >
              <option value="all">All roles</option>
              {availableRoleDefinitions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleName}
                </option>
              ))}
            </select>
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
                setSortBy(event.target.value as "name" | "role" | "status" | "activity");
                setParam((previous) => ({ ...previous, pageNo: 1 }));
              }}
            >
              <option value="name">Sort by name</option>
              <option value="role">Sort by role</option>
              <option value="status">Sort by status</option>
              <option value="activity">Sort by last active</option>
            </select>
          </div>

        </div>

        <PermissionBlock permissionKey={PermissionKeys.usersAdd} allowedKey={AllowedKeys.users}>
          <button className="btn btn-primary" disabled={checkingUserLimit} onClick={() => void openAddModal()}>
            <i className="ri-user-add-line me-1" />
            {checkingUserLimit ? "Checking..." : "Invite User"}
          </button>
        </PermissionBlock>
      </div>

      <div className="card admin-reference-table-card">
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Permission</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const permissionSummary = getPermissionSummary(user);
                  const canManagePermissions = canOpenPermissionEditor(user);
                  const canDelete = canDeleteUser(user);

                  return (
                    <tr key={user.id}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{getRoleLabel(user)}</td>
                      <td>
                        <div className="small fw-semibold">
                          {user.permissionSource === "custom" ? "Custom override" : "Role default"}
                        </div>
                        <div className="small text-body-secondary">
                          {permissionSummary.length ? permissionSummary.slice(0, 2).join(", ") : "No modules enabled"}
                        </div>
                      </td>
                      <td>{user.status === "active" ? "Active" : "Inactive"}</td>
                      <td>{user.lastActive}</td>
                      <td>
                        <div className="admin-inline-actions">
                          <PermissionBlock permissionKey={PermissionKeys.usersEdit} allowedKey={AllowedKeys.users}>
                            <button
                              type="button"
                              className="admin-inline-action-btn permission"
                              title={canManagePermissions ? "Permissions" : "Only super admin can change primary admin permissions"}
                              disabled={!canManagePermissions}
                              onClick={() => handlePermissions(user)}
                            >
                              <i className="ri-fingerprint-line" />
                            </button>
                          </PermissionBlock>
                          {/* <PermissionBlock permissionKey={PermissionKeys.usersEdit} allowedKey={AllowedKeys.users}>
                            <button
                              type="button"
                              className="admin-inline-action-btn permission"
                              title="Send password email"
                              onClick={() => void handlePasswordEmail(user)}
                            >
                              <i className="ri-mail-send-line" />
                            </button>
                          </PermissionBlock> */}
                          <PermissionBlock permissionKey={PermissionKeys.usersEdit} allowedKey={AllowedKeys.users}>
                            <button
                              type="button"
                              className="admin-inline-action-btn edit"
                              title="Edit"
                              onClick={() => handleEdit(user)}
                            >
                              <i className="ri-pencil-line" />
                            </button>
                          </PermissionBlock>
                          <PermissionBlock permissionKey={PermissionKeys.usersEdit} allowedKey={AllowedKeys.users}>
                            <button
                              type="button"
                              className="admin-inline-action-btn permission"
                              title={canImpersonateUser(user) ? "Login as User" : "This account cannot be impersonated"}
                              disabled={!canImpersonateUser(user)}
                              onClick={() => void handleImpersonate(user)}
                            >
                              <i className="ri-login-box-line" />
                            </button>
                          </PermissionBlock>
                          <PermissionBlock permissionKey={PermissionKeys.usersDelete} allowedKey={AllowedKeys.users}>
                            <button
                              type="button"
                              className="admin-inline-action-btn delete"
                              title={canDelete ? "Delete" : "Only super admin can delete primary admin"}
                              disabled={!canDelete}
                              onClick={() => void handleDelete(user)}
                            >
                              <i className="ri-delete-bin-line" />
                            </button>
                          </PermissionBlock>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="admin-empty-state">No users matched the selected filters.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <Pagination showStatistics data={data} param={param} setParam={setParam} />
        </div>
      </div>

      <Modal show={open === "edit"} onClose={() => setOpen(null)} title="Update User" size="lg" centered>
        <Formik
          initialValues={initialValues}
          enableReinitialize
          validationSchema={validationSchema}
          onSubmit={async (values, { resetForm, setErrors }) =>
            submitUserForm(values, {
              resetForm: () => resetForm(),
              setErrors,
            })}
        >
          {({ isSubmitting }) => {
            return (
              <Form>
                <div className="admin-form-grid admin-form-grid-user admin-form-grid-user-top mb-3">
                  <div>
                    <label htmlFor="name" className="form-label">
                      Name <span className="text-danger">*</span>
                    </label>
                    <Field name="name" id="name" className="form-control" />
                    <ErrorMessage name="name" component="small" className="text-danger" />
                  </div>

                  <div>
                    <label htmlFor="email" className="form-label">
                      Email <span className="text-danger">*</span>
                    </label>
                    <Field name="email" id="email" type="email" className="form-control" />
                    <ErrorMessage name="email" component="small" className="text-danger" />
                  </div>
                </div>

                <div className="admin-form-grid admin-form-grid-user mb-4">
                  <div>
                    <label htmlFor="user-status" className="form-label">
                      Status <span className="text-danger">*</span>
                    </label>
                    <Field as="select" name="status" id="user-status" className="form-select">
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Field>
                    <ErrorMessage name="status" component="small" className="text-danger" />
                  </div>

                  <div className="d-flex align-items-end">
                    <div className="alert alert-light border mb-0 w-100">
                      Use the mail action in the table to send a secure reset password link.
                    </div>
                  </div>
                </div>

                <div className="d-flex justify-content-end gap-2 pt-4">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={loader || isSubmitting}>
                    {loader ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                        Saving...
                      </>
                    ) : (
                      "Save user"
                    )}
                  </button>
                </div>
              </Form>
            );
          }}
        </Formik>
      </Modal>
    </>
  );
};

export default Users;
