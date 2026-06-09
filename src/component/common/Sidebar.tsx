import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAppSelector } from "../../app/hooks";
import { adminMenu } from "../../constant/adminMenu";
import { superAdminMenu } from "../../constant/superAdminMenu";
import { getAdminHomePath } from "../../helper/adminHome";
import { getScopedAppPath, isSuperAdminRole } from "../../helper/appShell";
import Image from "./Image";
import { PermissionBlock } from "./PermissionBlock";
import SharedSidebar from "./SharedSidebar";

const Sidebar = () => {
  const settings = useAppSelector((state) => state.settings);
  const admin = useAppSelector((state) => state.admin);
  const isSuperAdmin = isSuperAdminRole(admin.role);
  const menu = isSuperAdmin ? superAdminMenu : adminMenu;
  const homePath = getAdminHomePath(admin.allowed, admin.role);
  const isVisible = (permissionKey?: string, allowedKey?: string) =>
    (!permissionKey || admin.permission.includes(permissionKey)) &&
    (!allowedKey || admin.allowed.includes(allowedKey));

  return (
    <SharedSidebar
      subtitle={isSuperAdmin ? "Platform Console" : admin.clientName || "Workspace"}
      className={isSuperAdmin ? "super-admin-menu" : ""}
      brandSlot={
        <Link to={homePath} className="app-sidebar-logo">
          <span className="app-sidebar-logo-mark">
            <Image src={settings.favicon} alt={settings.application_name} height={34} />
          </span>
          <span className="app-sidebar-logo-copy">
            <strong>{settings.application_name}</strong>
            <small>{isSuperAdmin ? "Platform Console" : admin.clientName || "Workspace"}</small>
          </span>
        </Link>
      }
    >
        <div className="app-sidebar-section-label">Overview</div>

        <ul className="side-nav">
          {menu.map((item) => {
            if (item.superAdminOnly && admin.role !== "super_admin") {
              return null;
            }

            if (item.children?.length) {
              const visibleChildren = item.children.filter(
                (child) =>
                  (!child.superAdminOnly || admin.role === "super_admin") &&
                  isVisible(child.permission_key, child.allowed_key),
              );

              if (!visibleChildren.length) {
                return null;
              }

              return <MultipleMenu key={item.label} label={item.label} icon={item.icon ?? "ri-links-line"} children={visibleChildren} />;
            }

            if (!isVisible(item.permission_key, item.allowed_key)) {
              return null;
            }

            return (
              <SingleMenu
                key={item.link}
                label={item.label}
                link={getScopedAppPath(item.link ?? homePath, admin.role)}
                icon={item.icon ?? "ri-arrow-right-s-line"}
                permissionKey={item.permission_key}
                allowedKey={item.allowed_key}
              />
            );
          })}
        </ul>
    </SharedSidebar>
  );
};

const SingleMenu = ({
  label,
  link,
  icon,
  permissionKey,
  allowedKey,
}: {
  label: string;
  link: string;
  icon: string;
  permissionKey?: string;
  allowedKey?: string;
}) => {
  return (
    <PermissionBlock permissionKey={permissionKey} allowedKey={allowedKey}>
      <li className="side-nav-item">
        <NavLink to={link} className={({ isActive }) => `side-nav-link app-sidebar-link ${isActive ? "active" : ""}`}>
          <span className="app-sidebar-icon">
            <i className={icon} />
          </span>
          <span>{label}</span>
        </NavLink>
      </li>
    </PermissionBlock>
  );
};

const MultipleMenu = ({
  label,
  icon,
  children,
}: {
  label: string;
  icon: string;
  children: NonNullable<(typeof adminMenu)[number]["children"]>;
}) => {
  const location = useLocation();
  const admin = useAppSelector((state) => state.admin);
  const sidenavSize = useAppSelector((state) => state.theme.sidenavSize);
  const isCollapsedView = sidenavSize === "condensed";
  const scopedChildren = children.map((child) => ({
    ...child,
    link: getScopedAppPath(child.link ?? "/dashboard", admin.role),
  }));
  const isActive = scopedChildren.some((child) => child.link === location.pathname);
  const [show, setShow] = useState(isActive);
  const parentLink = scopedChildren[0]?.link ?? "#";

  useEffect(() => {
    if (isActive) {
      setShow(true);
    }
  }, [isActive]);

  return (
    <li
      className="side-nav-item app-sidebar-has-submenu"
      {...(isCollapsedView
        ? {
            onMouseEnter: () => setShow(true),
            onMouseLeave: () => setShow(isActive),
          }
        : {})}
    >
      <a
        href={parentLink}
        className={`side-nav-link app-sidebar-link ${show ? "" : "collapsed"} ${isActive ? "active" : ""}`}
        aria-expanded={show}
        aria-haspopup="menu"
        onClick={(event) => {
          if (isCollapsedView) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          setShow((current) => !current);
        }}
      >
        <span className="app-sidebar-icon">
          <i className={icon} />
        </span>
        <span>{label}</span>
        <span className="menu-arrow app-sidebar-caret" />
      </a>

      <div className={`collapse app-sidebar-submenu-panel ${show ? "show" : ""}`} role="menu" aria-label={`${label} submenu`}>
        <div className="app-sidebar-flyout-title">{label}</div>
        <ul className="side-nav-second-level">
          {scopedChildren.map((child) => (
            <PermissionBlock key={child.link} permissionKey={child.permission_key} allowedKey={child.allowed_key}>
              <li>
                <NavLink to={child.link ?? "/dashboard"} className={({ isActive }) => `app-sidebar-submenu-link ${isActive ? "active" : ""}`}>
                  <span className="app-sidebar-submenu-icon">
                    <i className={child.icon ?? "ri-arrow-right-s-line"} />
                  </span>
                  <span>{child.label}</span>
                </NavLink>
              </li>
            </PermissionBlock>
          ))}
        </ul>
      </div>
    </li>
  );
};

export { Sidebar };
export default Sidebar;
