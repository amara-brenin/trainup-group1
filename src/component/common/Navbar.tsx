import { Link } from "react-router-dom";
import { useAppSelector } from "../../app/hooks";
import { getAdminHomePath } from "../../helper/adminHome";
import { isSuperAdminRole } from "../../helper/appShell";
import Image from "./Image";
import SharedNavbar from "./SharedNavbar";
import UserBox from "./UserBox";

export const Navbar = () => {
  const settings = useAppSelector((state) => state.settings);
  const admin = useAppSelector((state) => state.admin);
  const homePath = getAdminHomePath(admin.allowed, admin.role);

  // Tenants often upload only a primary logo (settings.logo) and leave the dark
  // variant unset, in which case `dark_logo` resolves to a server default that
  // may not render on the frontend host. Fall back to the primary logo (then
  // favicon) so the topbar brand is always visible — matching the login page,
  // which uses settings.logo directly.
  const lightLogo = settings.logo || settings.favicon;
  const darkLogo = settings.dark_logo || settings.logo || settings.favicon;

  return (
    <SharedNavbar
      usedCredits={admin.usedCredits}
      totalCredits={admin.totalCredits}
      planExpired={admin.planExpired}
      showCredits={!isSuperAdminRole(admin.role)}
      userSlot={<UserBox />}
      leftContent={
        <div className="logo-topbar">
          <Link to={homePath} className="logo-light">
            <span className="logo-lg">
              <Image src={lightLogo} alt={settings.application_name} height={42} />
            </span>
            <span className="logo-sm">
              <Image src={settings.favicon} alt={settings.application_name} height={30} />
            </span>
          </Link>
          <Link to={homePath} className="logo-dark">
            <span className="logo-lg">
              <Image src={darkLogo} alt={settings.application_name} height={42} />
            </span>
            <span className="logo-sm">
              <Image src={settings.favicon} alt={settings.application_name} height={30} />
            </span>
          </Link>
        </div>
      }
    />
  );
};

export default Navbar;
