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

  return (
    <SharedNavbar
      usedCredits={admin.usedCredits}
      totalCredits={admin.totalCredits}
      showCredits={!isSuperAdminRole(admin.role)}
      userSlot={<UserBox />}
      leftContent={
        <div className="logo-topbar">
          <Link to={homePath} className="logo-light">
            <span className="logo-lg">
              <Image src={settings.logo} alt={settings.application_name} height={42} />
            </span>
            <span className="logo-sm">
              <Image src={settings.favicon} alt={settings.application_name} height={30} />
            </span>
          </Link>
          <Link to={homePath} className="logo-dark">
            <span className="logo-lg">
              <Image src={settings.dark_logo} alt={settings.application_name} height={42} />
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
