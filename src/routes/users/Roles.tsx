import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import PermissionMatrix from "../../component/common/PermissionMatrix";
import { Modal } from "../../component/common/Modal";
import { PermissionBlock } from "../../component/common/PermissionBlock";
import {
  filterPermissionModulesForUser,
  fixedRoleDefinitions,
  getFixedRoleDefinition,
  isSamePermissionSet,
  permissionModules,
} from "../../constant/accessControl";
import type { AdminUser, RoleDefinitionRecord, RolePermissionsPayload, RoleRecordStatus } from "../../constant/interfaces";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import AxiosHelper from "../../helper/AxiosHelper";
import { updateAdmin } from "../../redux/authSlice";

type RoleFormValues = {
  name: string;
  description: string;
  status: RoleRecordStatus;
  permission: string[];
};

const createRoleInitialValues: RoleFormValues = {
  name: "",
  description: "",
  status: "active",
  permission: [],
};

const createRoleSchema = Yup.object({
  name: Yup.string().trim().required("Role name is required."),
  description: Yup.string().trim().required("Description is required."),
  status: Yup.string().oneOf(["active", "inactive"]).required("Status is required."),
  permission: Yup.array().of(Yup.string()).min(1, "Select at least one permission.").required("Permission is required."),
});

const editRoleSchema = Yup.object({
  name: Yup.string().trim().required("Role name is required."),
  description: Yup.string().trim().required("Description is required."),
  status: Yup.string().oneOf(["active", "inactive"]).required("Status is required."),
});

const Roles = () => {
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const [roles, setRoles] = useState<RoleDefinitionRecord[]>(fixedRoleDefinitions);
  const [savedRoles, setSavedRoles] = useState<RoleDefinitionRecord[]>(fixedRoleDefinitions);
  const [modules, setModules] = useState(filterPermissionModulesForUser(permissionModules, admin.role, admin.permission));
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RoleRecordStatus>("all");
  const [sortBy, setSortBy] = useState<"name" | "status" | "date">("name");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [openCreateRole, setOpenCreateRole] = useState(false);
  const [openEditRole, setOpenEditRole] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const visibleRoles = useMemo(() => roles.filter((role) => role.id !== "trainee"), [roles]);

  const selectedRole = visibleRoles.find((role) => role.id === selectedRoleId) ?? null;
  const editingRole = visibleRoles.find((role) => role.id === editingRoleId) ?? null;
  const savedSelectedRole = savedRoles.filter((role) => role.id !== "trainee").find((role) => role.id === selectedRoleId) ?? null;
  const grantablePermissionKeys = useMemo(
    () => new Set(modules.flatMap((moduleItem) => moduleItem.permissions.map((permission) => permission.key))),
    [modules],
  );
  const fixedSelectedRole = selectedRole ? getFixedRoleDefinition(selectedRole.id) : null;
  const visibleFixedSelectedRole = fixedSelectedRole
    ? {
        ...fixedSelectedRole,
        permission: fixedSelectedRole.permission.filter((permission) => grantablePermissionKeys.has(permission)),
      }
    : null;
  const hasChanges = selectedRole ? !isSamePermissionSet(selectedRole.permission, savedSelectedRole?.permission ?? []) : false;
  const matchesSystemDefault = selectedRole
    ? isSamePermissionSet(selectedRole.permission, visibleFixedSelectedRole?.permission ?? selectedRole.permission)
    : true;
  const defaultPermissionCount = visibleFixedSelectedRole?.permission.length ?? 0;
  const addedPermissionCount = selectedRole && visibleFixedSelectedRole
    ? selectedRole.permission.filter((permissionKey) => !visibleFixedSelectedRole.permission.includes(permissionKey)).length
    : 0;
  const removedPermissionCount = selectedRole && visibleFixedSelectedRole
    ? visibleFixedSelectedRole.permission.filter((permissionKey) => !selectedRole.permission.includes(permissionKey)).length
    : 0;

  const refreshCurrentAdminProfile = useCallback(async () => {
    const response = await AxiosHelper.getData<AdminUser>("/profile");

    if (response.data.status) {
      dispatch(updateAdmin(response.data.data));
      return response.data.data;
    }

    return null;
  }, [dispatch]);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    const response = await AxiosHelper.getData<RolePermissionsPayload>("/roles");

    if (response.data.status) {
      setRoles(response.data.data.roles);
      setSavedRoles(response.data.data.roles);
      setModules(filterPermissionModulesForUser(response.data.data.modules, admin.role, admin.permission));
    }

    setLoading(false);
  }, [admin.permission, admin.role]);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const filteredRoles = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = visibleRoles.filter(
      (role) =>
        (statusFilter === "all" ? true : role.status === statusFilter) &&
        (!needle ||
          [role.name, role.roleName, role.description, role.status].some((value) => value.toLowerCase().includes(needle))),
    );

    return [...filtered].sort((left, right) => {
      if (sortBy === "status") {
        return left.status.localeCompare(right.status) || left.roleName.localeCompare(right.roleName);
      }
      if (sortBy === "date") {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }
      return left.roleName.localeCompare(right.roleName);
    });
  }, [query, sortBy, statusFilter, visibleRoles]);

  const updateRolePermissions = (permission: string[]) => {
    if (!selectedRoleId) {
      return;
    }

    setRoles((current) =>
      current.map((role) =>
        role.id === selectedRoleId
          ? {
              ...role,
              permission,
            }
          : role,
      ),
    );
  };

  const saveRole = async () => {
    if (!selectedRole) {
      return;
    }

    setSavingRoleId(selectedRole.id);
    const response = await AxiosHelper.putData<RolePermissionsPayload, { permission: string[] }>(`/roles/${selectedRole.id}`, {
      permission: selectedRole.permission,
    });

    if (response.data.status) {
      setRoles(response.data.data.roles);
      setSavedRoles(response.data.data.roles);
      setModules(filterPermissionModulesForUser(response.data.data.modules, admin.role, admin.permission));
      const refreshedAdmin = await refreshCurrentAdminProfile();
      toast.success(response.data.message);

      if (refreshedAdmin && selectedRole.id === refreshedAdmin.role) {
        window.location.reload();
        return;
      }
    } else {
      toast.error(response.data.message);
    }

    setSavingRoleId(null);
  };

  const resetRole = () => {
    if (!selectedRole || !savedSelectedRole) {
      return;
    }

    updateRolePermissions(savedSelectedRole.permission);
  };

  const resetRoleToSystemDefault = () => {
    if (!selectedRole || !visibleFixedSelectedRole) {
      return;
    }

    updateRolePermissions(visibleFixedSelectedRole.permission);
  };

  const formatRoleDate = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));

  const editRoleInitialValues: Omit<RoleFormValues, "permission"> = {
    name: editingRole?.roleName ?? "",
    description: editingRole?.description ?? "",
    status: editingRole?.status ?? "active",
  };

  if (loading) {
    return (
      <div className="card app-loading-table">
        <div className="card-body p-4">
          <span className="ds-skeleton app-loading-line is-wide" />
          <div className="app-loading-table-lines">
            <span className="ds-skeleton app-loading-line" />
            <span className="ds-skeleton app-loading-line" />
            <span className="ds-skeleton app-loading-line" />
            <span className="ds-skeleton app-loading-line" />
          </div>
        </div>
      </div>
    );
  }

  if (selectedRole) {
    return (
      <div className="role-page-shell">
        <div className="role-permission-hero">
          <div className="role-permission-hero-main">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setSelectedRoleId(null)}>
              <i className="ri-arrow-left-line me-1" />
              Back
            </button>
            <div>
              <div className="role-permission-title">
                Role Permission for <span>{selectedRole.roleName}</span>
              </div>
              <p className="text-body-secondary mb-0">{selectedRole.description}</p>
            </div>
          </div>
        </div>

        <div className="permission-summary-shell">
          <span className={`badge ${hasChanges ? "text-bg-warning" : "text-bg-light border text-dark"}`}>
            {hasChanges ? "Unsaved changes" : "Saved"}
          </span>
          {visibleFixedSelectedRole ? (
            <div className="permission-summary-caption">
              Default {defaultPermissionCount} permissions
              {matchesSystemDefault ? "" : `, ${addedPermissionCount} added, ${removedPermissionCount} removed`}
            </div>
          ) : null}
        </div>

        <PermissionMatrix
          modules={modules}
          baselinePermissions={visibleFixedSelectedRole?.permission}
          selectedPermissions={selectedRole.permission}
          onChange={updateRolePermissions}
        />

        <PermissionBlock permissionKey={PermissionKeys.rolesEdit} allowedKey={AllowedKeys.roles}>
          <div className="role-permission-actions">
            <button type="button" className="btn btn-outline-secondary" disabled={!hasChanges} onClick={resetRole}>
              Reset changes
            </button>
            {visibleFixedSelectedRole ? (
              <button
                type="button"
                className="btn btn-outline-danger"
                disabled={matchesSystemDefault}
                onClick={resetRoleToSystemDefault}
              >
                Reset to default permissions
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!hasChanges || savingRoleId === selectedRole.id}
              onClick={() => void saveRole()}
            >
              {savingRoleId === selectedRole.id ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                  Saving...
                </>
              ) : (
                "Save permissions"
              )}
            </button>
          </div>
        </PermissionBlock>
      </div>
    );
  }

  if (openCreateRole) {
    return (
      <div className="role-page-shell">
        <div className="role-permission-hero">
          <div className="role-permission-hero-main">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setOpenCreateRole(false)}>
              <i className="ri-arrow-left-line me-1" />
              Back
            </button>
            <div>
              <div className="role-permission-title">
                Create <span>Role</span>
              </div>
              <p className="text-body-secondary mb-0">Define role metadata and permissions in a full-page workflow.</p>
            </div>
          </div>
        </div>

        <Formik
          initialValues={createRoleInitialValues}
          validationSchema={createRoleSchema}
          onSubmit={async (values, { resetForm, setErrors }) => {
            setCreatingRole(true);

            const response = await AxiosHelper.postData<RolePermissionsPayload, RoleFormValues>("/roles", values);

            if (response.data.status) {
              setRoles(response.data.data.roles);
              setSavedRoles(response.data.data.roles);
              setModules(filterPermissionModulesForUser(response.data.data.modules, admin.role, admin.permission));
              setOpenCreateRole(false);
              resetForm();
              toast.success(response.data.message);
            } else {
              setErrors(((response.data.data || {}) as unknown) as Record<string, string>);
              toast.error(response.data.message);
            }

            setCreatingRole(false);
          }}
        >
          {({ values, setFieldValue, isSubmitting }) => (
            <Form className="card">
              <div className="card-body">
                <div className="admin-form-grid admin-form-grid-user admin-form-grid-user-top mb-3">
                  <div>
                    <label htmlFor="name" className="form-label">
                      Role Name <span className="text-danger">*</span>
                    </label>
                    <Field name="name" id="name" className="form-control" />
                    <ErrorMessage name="name" component="small" className="text-danger" />
                  </div>
                </div>

                <div className="mb-3">
                  <label htmlFor="description" className="form-label">
                    Description <span className="text-danger">*</span>
                  </label>
                  <Field as="textarea" name="description" id="description" className="form-control" rows={3} />
                  <ErrorMessage name="description" component="small" className="text-danger" />
                </div>

                <div className="mb-3">
                  <label htmlFor="role-status" className="form-label">
                    Status <span className="text-danger">*</span>
                  </label>
                  <Field as="select" name="status" id="role-status" className="form-select">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Field>
                  <ErrorMessage name="status" component="small" className="text-danger" />
                </div>

                <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                  <div>
                    <h5 className="mb-1">Role Permissions</h5>
                    <p className="text-body-secondary small mb-0">
                      Choose the modules and actions this role should see across the panel.
                    </p>
                  </div>
                  <div className="permission-summary-shell">
                    <div className="permission-summary-caption">
                      New permissions start blank. Saved roles will show added or removed changes automatically.
                    </div>
                    <span className="badge text-bg-primary">{values.permission.length} selected</span>
                  </div>
                </div>

                <PermissionMatrix
                  modules={modules}
                  selectedPermissions={values.permission}
                  onChange={(permission) => setFieldValue("permission", permission)}
                />
                <ErrorMessage name="permission" component="small" className="text-danger d-block mt-2" />

                <div className="d-flex justify-content-end gap-2 pt-4">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setOpenCreateRole(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={creatingRole || isSubmitting}>
                    {creatingRole ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                        Creating...
                      </>
                    ) : (
                      "Create role"
                    )}
                  </button>
                </div>
              </div>
            </Form>
          )}
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
              placeholder="Search roles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select className="form-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | RoleRecordStatus)}>
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select className="form-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as "name" | "status" | "date")}>
              <option value="name">Sort by name</option>
              <option value="status">Sort by status</option>
              <option value="date">Sort by date</option>
            </select>
          </div>

        </div>
        <PermissionBlock permissionKey={PermissionKeys.rolesEdit} allowedKey={AllowedKeys.roles}>
          <button type="button" className="btn btn-primary" onClick={() => setOpenCreateRole(true)}>
            <i className="ri-shield-user-line me-1" />
            Create Role
          </button>
        </PermissionBlock>
      </div>

      <div className="card admin-reference-table-card">
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoles.length ? (
                  filteredRoles.map((role) => (
                    <tr key={role.id}>
                      <td>{role.roleName}</td>
                      <td>{role.status === "active" ? "Active" : "Inactive"}</td>
                      <td>{formatRoleDate(role.createdAt)}</td>
                      <td>
                        <div className="admin-inline-actions">
                          <button
                            type="button"
                            className="admin-inline-action-btn permission"
                            title="Permissions"
                            onClick={() => setSelectedRoleId(role.id)}
                          >
                            <i className="ri-fingerprint-line" />
                          </button>
                          <button
                            type="button"
                            className="admin-inline-action-btn edit"
                            title="Edit role"
                            onClick={() => {
                              setEditingRoleId(role.id);
                              setOpenEditRole(true);
                            }}
                          >
                            <i className="ri-pencil-line" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>
                      <div className="admin-empty-state">No roles matched the search.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={openEditRole} onClose={() => setOpenEditRole(false)} title="Edit Role" size="lg" centered>
        <Formik
          initialValues={editRoleInitialValues}
          validationSchema={editRoleSchema}
          enableReinitialize
          onSubmit={async (values, { setErrors, setSubmitting }) => {
            if (!editingRole) {
              setSubmitting(false);
              return;
            }

            const response = await AxiosHelper.putData<RolePermissionsPayload, Omit<RoleFormValues, "permission">>(
              `/roles/${editingRole.id}`,
              values,
            );

            if (response.data.status) {
              setRoles(response.data.data.roles);
              setSavedRoles(response.data.data.roles);
              if (selectedRoleId === editingRole.id) {
                setSelectedRoleId(editingRole.id);
              }
              setOpenEditRole(false);
              setEditingRoleId(null);
              toast.success(response.data.message);
            } else {
              setErrors(((response.data.data || {}) as unknown) as Record<string, string>);
              toast.error(response.data.message);
            }

            setSubmitting(false);
          }}
        >
          {({ isSubmitting }) => (
            <Form>
              <div className="mb-3">
                <label htmlFor="edit-role-name" className="form-label">
                  Role Name <span className="text-danger">*</span>
                </label>
                <Field name="name" id="edit-role-name" className="form-control" />
                <ErrorMessage name="name" component="small" className="text-danger" />
              </div>

              <div className="mb-3">
                <label htmlFor="edit-role-description" className="form-label">
                  Description <span className="text-danger">*</span>
                </label>
                <Field as="textarea" name="description" id="edit-role-description" className="form-control" rows={3} />
                <ErrorMessage name="description" component="small" className="text-danger" />
              </div>

              <div className="mb-3">
                <label htmlFor="edit-role-status" className="form-label">
                  Status <span className="text-danger">*</span>
                </label>
                <Field as="select" name="status" id="edit-role-status" className="form-select">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Field>
                <ErrorMessage name="status" component="small" className="text-danger" />
              </div>

              <div className="d-flex justify-content-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setOpenEditRole(false);
                    setEditingRoleId(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save changes"}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </Modal>
    </>
  );
};

export default Roles;
