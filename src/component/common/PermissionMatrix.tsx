import type { PermissionModuleDefinition } from "../../constant/interfaces";

type PermissionMatrixProps = {
  modules: PermissionModuleDefinition[];
  selectedPermissions: string[];
  onChange: (permission: string[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  baselinePermissions?: string[];
};

const PermissionMatrix = ({
  modules,
  selectedPermissions,
  onChange,
  disabled = false,
  readOnly = false,
  baselinePermissions = [],
}: PermissionMatrixProps) => {
  const hasPermission = (permissionKey: string) => selectedPermissions.includes(permissionKey);
  const baselineSet = new Set(baselinePermissions);

  const getPermissionState = (permissionKey: string) => {
    if (!baselinePermissions.length) {
      return null;
    }

    const selected = hasPermission(permissionKey);
    const enabledByDefault = baselineSet.has(permissionKey);

    if (enabledByDefault && !selected) {
      return {
        label: "Removed",
        className: "permission-diff-chip removed",
      };
    }

    if (!enabledByDefault && selected) {
      return {
        label: "Added",
        className: "permission-diff-chip added",
      };
    }

    return null;
  };

  const togglePermission = (permissionKey: string) => {
    if (readOnly || disabled) {
      return;
    }

    if (hasPermission(permissionKey)) {
      onChange(selectedPermissions.filter((item) => item !== permissionKey));
      return;
    }

    onChange([...selectedPermissions, permissionKey]);
  };

  const toggleModule = (moduleId: string) => {
    if (readOnly || disabled) {
      return;
    }

    const moduleItem = modules.find((item) => item.id === moduleId);

    if (!moduleItem) {
      return;
    }

    const modulePermissionKeys = moduleItem.permissions.map((item) => item.key);
    const hasAllPermissions = modulePermissionKeys.every((permissionKey) => hasPermission(permissionKey));

    if (hasAllPermissions) {
      onChange(selectedPermissions.filter((item) => !modulePermissionKeys.includes(item)));
      return;
    }

    onChange(Array.from(new Set([...selectedPermissions, ...modulePermissionKeys])));
  };

  return (
    <div className="permission-matrix">
      {modules.map((moduleItem) => {
        const selectedCount = moduleItem.permissions.filter((permission) => hasPermission(permission.key)).length;
        const allSelected = selectedCount === moduleItem.permissions.length;

        return (
          <div key={moduleItem.id} className="permission-module-card">
            <div className="permission-module-header">
              <div>
                <h6 className="mb-1">{moduleItem.label}</h6>
                <p className="mb-0 text-body-secondary small">{moduleItem.description}</p>
              </div>
              <div className="permission-module-meta d-flex align-items-center gap-2">
                <div className="small text-body-secondary fw-semibold">
                  {selectedCount}/{moduleItem.permissions.length}
                </div>
                <label className="form-check form-switch m-0">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={allSelected}
                    disabled={disabled || readOnly}
                    onChange={() => toggleModule(moduleItem.id)}
                  />
                  <span className="form-check-label small fw-semibold">Check all</span>
                </label>
              </div>
            </div>

            <div className="permission-module-list">
              {moduleItem.permissions.map((permission) => {
                const permissionState = getPermissionState(permission.key);

                return (
                  <label key={permission.key} className="permission-toggle-card">
                    <div className="permission-toggle-copy">
                      <div className="permission-toggle-head">
                        <span className="d-block fw-semibold text-body">{permission.label}</span>
                        {permissionState ? (
                          <span className={permissionState.className}>
                            <span className="permission-diff-dot" />
                            {permissionState.label}
                          </span>
                        ) : null}
                      </div>
                      <span className="small text-body-secondary">{permission.description}</span>
                    </div>
                    <div className="form-check form-switch m-0">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={hasPermission(permission.key)}
                        disabled={disabled || readOnly}
                        onChange={() => togglePermission(permission.key)}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PermissionMatrix;
