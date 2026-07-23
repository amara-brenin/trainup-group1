import { NavLink, Outlet } from "react-router-dom";
import PageShell from "../../component/common/PageShell";

const UpgradeBillingHub = () => {
  return (
    <PageShell
      title="Upgrade & Billing"
      description="Manage your platform's pricing, monitor system-wide credit usage, and configure global billing integrations."
    >

      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap gap-2">
          <NavLink
            to="/upgrade-billing"
            end
            className={({ isActive }) => `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`}
          >
            Plans
          </NavLink>
          <NavLink
            to="/upgrade-billing/settings"
            className={({ isActive }) => `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`}
          >
            Global Settings
          </NavLink>
          <NavLink
            to="/upgrade-billing/insights"
            className={({ isActive }) => `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`}
          >
            Billing Insights
          </NavLink>
          <NavLink
            to="/upgrade-billing/queries"
            className={({ isActive }) => `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`}
          >
            Queries
          </NavLink>
        </div>
      </div>

      <Outlet />
    </PageShell>
  );
};

export default UpgradeBillingHub;
