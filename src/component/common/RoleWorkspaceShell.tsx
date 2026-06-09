import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AvatarImage from "../../assets/images/avatar.png";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import { closeSidebar } from "../../redux/themeSlice";
import Footer from "./Footer";
import Image from "./Image";
import SharedNavbar from "./SharedNavbar";
import SharedSidebar from "./SharedSidebar";

type WorkspaceRole = "trainer" | "reviewer";
type WorkspaceNavKey = "dashboard" | "trainings" | "profile";

type RoleWorkspaceShellProps = {
  role: WorkspaceRole;
  sessionName: string;
  sessionEmail?: string;
  sessionImage?: string;
  roleLabel?: string;
  usedCredits?: number;
  totalCredits?: number;
  permission?: string[];
  allowed?: string[];
  activeItem: WorkspaceNavKey;
  onSelectItem: (item: WorkspaceNavKey) => void;
  onSignOut: () => void;
  children: ReactNode;
};

const roleMeta: Record<WorkspaceRole, { label: string; subtitle: string; icon: string }> = {
  trainer: {
    label: "Content Trainer",
    subtitle: "Training authoring workspace",
    icon: "ri-edit-box-line",
  },
  reviewer: {
    label: "Reviewer",
    subtitle: "Review and approval workspace",
    icon: "ri-search-eye-line",
  },
};

const RoleWorkspaceShell = ({
  role,
  sessionName,
  sessionImage,
  roleLabel,
  usedCredits = 0,
  totalCredits = 0,
  permission = [],
  allowed = [],
  activeItem,
  onSelectItem,
  onSignOut,
  children,
}: RoleWorkspaceShellProps) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const { sidenavSize, menuActive } = useAppSelector((state) => state.theme);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const meta = roleMeta[role];
  const canViewBilling = allowed.includes(AllowedKeys.billing) && permission.includes(PermissionKeys.billingView);
  const menuItems = useMemo(
    () => [
      { key: "dashboard" as const, label: "Dashboard", icon: "ri-layout-grid-line" },
      { key: "trainings" as const, label: "Training", icon: "ri-book-open-line" },
    ],
    [],
  );

  const selectItem = (item: WorkspaceNavKey) => {
    setShowUserMenu(false);
    onSelectItem(item);
  };

  return (
    <>
      <div className="wrapper">
        <SharedSidebar
          subtitle={admin.clientName || meta.subtitle}
          className="role-workspace-sidebar"
          onBrandClick={() => selectItem("dashboard")}
        >
          <div className="side-nav-title app-sidebar-section-label">Workspace</div>
          <ul className="side-nav">
            {menuItems.map((item) => (
              <li key={item.key} className="side-nav-item">
                <button
                  type="button"
                  className={`side-nav-link app-sidebar-link ${activeItem === item.key ? "active" : ""}`}
                  onClick={() => selectItem(item.key)}
                  title={item.label}
                >
                  <span className="app-sidebar-icon">
                    <i className={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </SharedSidebar>

        <SharedNavbar
          usedCredits={usedCredits}
          totalCredits={totalCredits}
          // leftContent={
          //   admin.clientName ? (
          //     <span className="badge bg-primary-subtle text-primary-emphasis border border-primary-subtle">
          //       {admin.clientName}
          //     </span>
          //   ) : null
          // }
          userSlot={
            <li className="dropdown">
              <button
                type="button"
                className={`app-user-menu-button dropdown-toggle arrow-none ${showUserMenu ? "show" : ""}`}
                onClick={() => setShowUserMenu((current) => !current)}
                aria-expanded={showUserMenu}
              >
                <Image src={sessionImage || AvatarImage} alt={sessionName} width={34} className="rounded-circle" />
                <span className="d-none d-lg-flex flex-column text-start">
                  <strong>{sessionName}</strong>
                  <small>{roleLabel || meta.label}</small>
                </span>
              </button>

              <div className={`dropdown-menu dropdown-menu-end dropdown-menu-animated profile-dropdown ${showUserMenu ? "show" : ""}`}>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setShowUserMenu(false);
                    selectItem("profile");
                  }}
                >
                  <i className="ri-user-line fs-18 align-middle me-1" />
                  <span>My Account</span>
                </button>
                {canViewBilling ? (
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate("/upgrade-billings");
                      }}
                    >
                      <i className="ri-secure-payment-line fs-18 align-middle me-1" />
                      <span>Upgrade & Billings</span>
                    </button>
                ) : null}
                <button
                  type="button"
                  className="dropdown-item dropdown-item-danger"
                  onClick={() => {
                    setShowUserMenu(false);
                    onSignOut();
                  }}
                >
                  <i className="ri-logout-box-line fs-18 align-middle me-1" />
                  <span>Logout</span>
                </button>
              </div>
            </li>
          }
        />

        <div className="content-page">
          <div className="content">
            <div className="container-fluid pt-4 pt-md-2">{children}</div>
          </div>
          <Footer />
        </div>
      </div>

      {sidenavSize === "full" && menuActive ? (
        <div className="offcanvas-backdrop fade show" onClick={() => dispatch(closeSidebar())} />
      ) : null}
    </>
  );
};

export default RoleWorkspaceShell;
