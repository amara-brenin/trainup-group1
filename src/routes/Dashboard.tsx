import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import PageShell from "../component/common/PageShell";
import { PermissionBlock } from "../component/common/PermissionBlock";
import type { DashboardSummary } from "../constant/interfaces";
import { getScopedAppPath } from "../helper/appShell";
import AxiosHelper from "../helper/AxiosHelper";

const Dashboard = () => {
  const navigate = useNavigate();
  const admin = useAppSelector((state) => state.admin);
  const scopedPath = (path: string) => getScopedAppPath(path, admin.role);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const intro =
    admin.role === "super_admin"
      ? {
          title: "Platform overview",
          description: "Monitor adoption, integration health, and multi-client learning platform rollouts.",
        }
      : {
          title: "Client overview",
          description: "Track learning operations, team access, and training delivery health.",
        };

  const fetchSummary = useCallback(async () => {
    const { data } = await AxiosHelper.getData<DashboardSummary>("/dashboard");
    if (data.status) {
      setSummary(data.data);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  if (!summary) {
    return (
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-body p-4">Loading dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageShell title={intro.title} description={intro.description}>
      <div className="row g-3 mb-3">
        {summary.kpis.map((item) => (
          <div key={item.label} className="col-12 col-md-6 col-xl-3">
            <div className="card admin-card-stat h-100" style={{ borderTopColor: item.color }}>
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <span className="text-body-secondary small fw-semibold">{item.label}</span>
                  <span
                    className="admin-soft-icon d-inline-flex align-items-center justify-content-center rounded-3"
                    style={{ width: 42, height: 42, background: item.subtle, color: item.color }}
                  >
                    <i className={item.icon} />
                  </span>
                </div>
                <div className="fs-2 fw-semibold mb-1">{item.value}</div>
                <div className="small text-body-secondary">{item.hint}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-12">
          <div className="card h-100">
            <div className="card-header bg-transparent border-0 pb-0">
              <h2 className="h5 fw-semibold mb-1">Quick actions</h2>
              <p className="small text-body-secondary mb-0">
                High-frequency admin tasks aligned with the LMS operations flow.
              </p>
            </div>
            <div className="card-body">
              <div className="d-grid gap-2">
                {summary.quickActions.map((action) => (
                  <PermissionBlock
                    key={action.title}
                    permissionKey={action.permissionKey}
                    allowedKey={action.allowedKey}
                  >
                    <button
                      className="admin-quick-action text-start"
                      onClick={() => navigate(scopedPath(action.route))}
                    >
                      <span
                        className="admin-soft-icon d-inline-flex align-items-center justify-content-center rounded-3"
                        style={{ width: 44, height: 44, background: action.subtle, color: action.color }}
                      >
                        <i className={action.icon} />
                      </span>
                      <span>
                        <span className="d-block fw-semibold text-body">{action.title}</span>
                        <span className="small text-body-secondary">{action.description}</span>
                      </span>
                    </button>
                  </PermissionBlock>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default Dashboard;
