import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import AxiosHelper from "../../helper/AxiosHelper";
import { clearAuthToken } from "../../helper/authSession";
import { getScopedAppPath } from "../../helper/appShell";
import { loggedOutAdmin } from "../../redux/authSlice";
import Image from "./Image";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";

const UserBox = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [show, setShow] = useState(false);
  const admin = useAppSelector((state) => state.admin);
  const profilePath = getScopedAppPath("/profile", admin.role);
  const settingsPath = getScopedAppPath("/settings", admin.role);
  const billingPath = getScopedAppPath("/upgrade-billings", admin.role);

  const logout = async () => {
    await AxiosHelper.postData("/auth/logout", {});
    clearAuthToken();
    dispatch(loggedOutAdmin());
    toast.success("Logged out successfully.");
    navigate("/login", { replace: true });
  };

  return (
    <>
      <li className="dropdown">
        <button
          type="button"
          className={`app-user-menu-button dropdown-toggle arrow-none ${show ? "show" : ""}`}
          onClick={() => setShow((current) => !current)}
          aria-expanded={show}
        >
          <span className="account-user-avatar">
            <Image src={admin.image} alt={admin.fullname} width={34} className="rounded-circle" />
          </span>
          <span className="app-user-menu-copy d-lg-flex flex-column d-none text-start">
            <h5 className="my-0">{admin.fullname || admin.name}</h5>
            <h6 className="my-0 fw-normal">{admin.roleName || admin.role}</h6>
          </span>
        </button>

        <div className={`dropdown-menu dropdown-menu-end dropdown-menu-animated profile-dropdown ${show ? "show" : ""}`}>
          <button
            type="button"
            className="dropdown-item"
            onClick={() => {
              setShow(false);
              navigate(profilePath);
            }}
          >
            <i className="ri-user-line fs-18 align-middle me-1" />
            <span>My Account</span>
          </button>
          {admin.role !== "super_admin" && admin.allowed.includes(AllowedKeys.settings) ? (
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                setShow(false);
                navigate(settingsPath);
              }}
            >
              <i className="ri-settings-3-line fs-18 align-middle me-1" />
              <span>Settings</span>
            </button>
          ) : null}
          {admin.role !== "super_admin" &&
          admin.allowed.includes(AllowedKeys.billing) &&
          admin.permission.includes(PermissionKeys.billingView) ? (
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                setShow(false);
                navigate(billingPath);
              }}
            >
              <i className="ri-secure-payment-line fs-18 align-middle me-1" />
              <span>Upgrade & Billings</span>
            </button>
          ) : null}
          <button type="button" className="dropdown-item dropdown-item-danger" onClick={logout}>
            <i className="ri-logout-box-line fs-18 align-middle me-1" />
            <span>Logout</span>
          </button>
        </div>
      </li>
    </>
  );
};

export default UserBox;
