const { ok, fail } = require("../helpers/response");
const {
  filterPermissionArrayForRequester,
  filterPermissionCatalogForRequester,
  getUnauthorizedPermissionKeys,
  getRoleDefinitions,
  getRoleDefinitionById,
  normalizePermissionArray,
  slugifyRoleId,
} = require("../helpers/permissions");
const { getTenantClientId, getTenantSetting, setTenantSetting } = require("../helpers/tenant");

const getEffectiveRequester = (req) => ({
  ...(req.user || {}),
  permission: req.access?.permission || req.user?.permission || [],
  allowed: req.access?.allowed || req.user?.allowed || [],
});

const sanitizeRolesForRequester = (requester, roles) =>
  roles
    .filter((item) => item.id !== "trainee")
    .map((item) => ({
      ...item,
      permission: filterPermissionArrayForRequester(requester, item.permission),
    }));

const list = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const roles = getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions"));
  const requester = getEffectiveRequester(req);
  return ok(res, "Roles loaded.", {
    roles: sanitizeRolesForRequester(requester, roles),
    modules: filterPermissionCatalogForRequester(requester),
  });
};

const create = async (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const status = String(req.body.status || "").trim().toLowerCase() === "inactive" ? "inactive" : "active";
  const requester = getEffectiveRequester(req);
  const requestedPermission = normalizePermissionArray(req.body.permission);
  const unauthorizedPermission = getUnauthorizedPermissionKeys(requester, requestedPermission);
  const permission = filterPermissionArrayForRequester(requester, requestedPermission);
  const roleId = slugifyRoleId(name);

  if (!name) {
    return fail(res, 400, "Role name is required.", {
      name: "Enter a role name.",
    });
  }

  if (!description) {
    return fail(res, 400, "Description is required.", {
      description: "Enter a short role description.",
    });
  }

  if (!roleId) {
    return fail(res, 400, "Role name is invalid.", {
      name: "Use letters or numbers to create the role name.",
    });
  }

  if (!permission.length) {
    return fail(res, 400, "Select at least one permission.", {
      permission: "Choose at least one permission for this role.",
    });
  }

  if (unauthorizedPermission.length) {
    return fail(res, 403, "You can only assign permissions available to your account.", {
      permission: "Remove restricted permissions before saving.",
    });
  }

  const clientId = getTenantClientId(req.user);
  const roles = getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions"));

  if (roles.some((role) => role.id === roleId)) {
    return fail(res, 400, "Role already exists.", {
      name: "Choose a different role name.",
    });
  }

  const nextRoles = [
    ...roles,
    {
      id: roleId,
      name,
      roleName: name,
      description,
      status,
      createdAt: new Date().toISOString(),
      isSystem: false,
      permission,
    },
  ];

  await setTenantSetting(clientId, "rolePermissions", nextRoles);
  const refreshedRoles = getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions"));

  return ok(res, "Role created successfully.", {
    roles: sanitizeRolesForRequester(requester, refreshedRoles),
    modules: filterPermissionCatalogForRequester(requester),
  });
};

const update = async (req, res) => {
  const roleId = String(req.params.id || "").trim();
  const clientId = getTenantClientId(req.user);
  const requester = getEffectiveRequester(req);
  const roles = getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions"));
  const targetRole = getRoleDefinitionById(roleId, roles);

  if (!targetRole) {
    return fail(res, 404, "Role not found.");
  }

  const hasPermissionPayload = Array.isArray(req.body.permission);
  const hasMetadataPayload =
    Object.prototype.hasOwnProperty.call(req.body, "name") ||
    Object.prototype.hasOwnProperty.call(req.body, "description") ||
    Object.prototype.hasOwnProperty.call(req.body, "status");

  if (!hasPermissionPayload && !hasMetadataPayload) {
    return fail(res, 400, "No role changes were provided.");
  }

  const nextName = String(req.body.name ?? targetRole.name ?? targetRole.roleName).trim();
  const nextDescription = String(req.body.description ?? targetRole.description).trim();
  const nextStatus = String(req.body.status ?? targetRole.status).trim().toLowerCase() === "inactive" ? "inactive" : "active";

  if (hasMetadataPayload) {
    if (!nextName) {
      return fail(res, 400, "Role name is required.", {
        name: "Enter a role name.",
      });
    }

    if (!nextDescription) {
      return fail(res, 400, "Description is required.", {
        description: "Enter a short role description.",
      });
    }
  }

  const requestedPermission = hasPermissionPayload ? normalizePermissionArray(req.body.permission) : targetRole.permission;
  const unauthorizedPermission = hasPermissionPayload ? getUnauthorizedPermissionKeys(requester, requestedPermission) : [];
  const permission = hasPermissionPayload
    ? filterPermissionArrayForRequester(requester, requestedPermission)
    : targetRole.permission;

  if (hasPermissionPayload && !permission.length) {
    return fail(res, 400, "Select at least one permission.", {
      permission: "Choose at least one permission for this role.",
    });
  }

  if (unauthorizedPermission.length) {
    return fail(res, 403, "You can only assign permissions available to your account.", {
      permission: "Remove restricted permissions before saving.",
    });
  }

  const nextRoles = roles.map((role) =>
    role.id === roleId
      ? {
          ...role,
          name: nextName,
          roleName: nextName,
          description: nextDescription,
          status: nextStatus,
          permission,
        }
      : role,
  );

  await setTenantSetting(clientId, "rolePermissions", nextRoles);
  const refreshedRoles = getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions"));

  const successMessage = hasMetadataPayload && !hasPermissionPayload
    ? "Role details updated successfully."
    : hasMetadataPayload
      ? "Role updated successfully."
      : "Role permissions updated successfully.";

  return ok(res, successMessage, {
    roles: sanitizeRolesForRequester(requester, refreshedRoles),
    modules: filterPermissionCatalogForRequester(requester),
  });
};

module.exports = {
  create,
  list,
  update,
};
