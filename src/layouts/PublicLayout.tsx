import { Outlet } from "react-router-dom";
import Footer from "../component/common/Footer";

const PublicLayout = () => {
  return (
    <div>
      <div className="account-pages pt-2 pt-sm-5 pb-4 pb-sm-5 position-relative">
        <div className="container">
          <Outlet />
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default PublicLayout;
