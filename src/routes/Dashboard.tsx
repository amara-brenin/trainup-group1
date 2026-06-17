import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import PageShell from "../component/common/PageShell";
import { PermissionBlock } from "../component/common/PermissionBlock";
import type { DashboardSummary } from "../constant/interfaces";
import { getScopedAppPath } from "../helper/appShell";
import AxiosHelper from "../helper/AxiosHelper";

type ResourceUsage = { limit: number | null; used: number; remaining: number | null; unlimited: boolean; purchased: number };
type CapacityUsage = { training: ResourceUsage; session: ResourceUsage; user: ResourceUsage };

const Dashboard = () => {
  const navigate = useNavigate();
  const admin = useAppSelector((state) => state.admin);
  const scopedPath = (path: string) => getScopedAppPath(path, admin.role);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [capacity, setCapacity] = useState<CapacityUsage | null>(null);
  const [creditsSummary, setCreditsSummary] = useState<{ availableCredits: number; totalCredits: number; planExpired?: boolean } | null>(null);
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

  const fetchCapacity = useCallback(async () => {
    if (admin.role === "super_admin") return;
    const [addonRes, billingRes] = await Promise.all([
      AxiosHelper.getData<{ usage: CapacityUsage }>("/billing/addons/history"),
      AxiosHelper.getData<{ availableCredits: number; totalCredits: number; planExpired?: boolean; planStatus?: string }>("/billing/summary"),
    ]);
    if (addonRes.data.status && addonRes.data.data.usage) setCapacity(addonRes.data.data.usage);
    if (billingRes.data.status) setCreditsSummary({
      availableCredits: billingRes.data.data.availableCredits,
      totalCredits: billingRes.data.data.totalCredits,
      planExpired: Boolean(billingRes.data.data.planExpired) || billingRes.data.data.planStatus === "expired",
    });
  }, [admin.role]);

  useEffect(() => {
    void fetchSummary();
    void fetchCapacity();
  }, [fetchSummary, fetchCapacity]);

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

      {/* Phase E / Task 3: Capacity Overview */}
      {capacity && admin.role !== "super_admin" ? (() => {
        const items: { label: string; key: "training" | "session" | "user" }[] = [
          { label: "Trainings", key: "training" },
          { label: "Sessions", key: "session" },
          { label: "Users", key: "user" },
        ];
        const alerts: string[] = [];
        for (const { label, key } of items) {
          const u = capacity[key];
          if (!u.unlimited && u.limit && u.remaining !== null && u.remaining / u.limit < 0.2) {
            alerts.push(u.remaining <= 0 ? `${label} capacity is exhausted.` : `You have only ${u.remaining} ${label.toLowerCase()} slot${u.remaining === 1 ? "" : "s"} remaining.`);
          }
        }
        const creditPct = creditsSummary && creditsSummary.totalCredits > 0 ? Math.min(100, Math.round((creditsSummary.availableCredits / creditsSummary.totalCredits) * 100)) : 100;
        const creditTone = creditPct > 50 ? "success" : creditPct > 20 ? "warning" : "danger";
        return (
          <>
            {alerts.length ? (
              <div className="row g-3 mb-3">
                <div className="col-12">
                  {alerts.map((msg) => (
                    <div key={msg} className="alert alert-warning d-flex align-items-center py-2 mb-2">
                      <i className="ri-error-warning-line me-2 fs-5" />{msg}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="row g-3 mb-3">
              {items.map(({ label, key }) => {
                const u = capacity[key];
                const pct = u.unlimited || !u.limit ? 100 : Math.min(100, Math.round((u.used / u.limit) * 100));
                const remPct = u.unlimited ? 100 : (u.limit ? Math.min(100, Math.round(((u.remaining ?? 0) / u.limit) * 100)) : 0);
                const tone = remPct > 50 ? "success" : remPct > 20 ? "warning" : "danger";
                return (
                  <div key={key} className="col-12 col-md-6 col-xl-3">
                    <div className="card h-100">
                      <div className="card-body">
                        <div className="d-flex justify-content-between mb-2">
                          <span className="small fw-semibold text-body-secondary">{label} Remaining</span>
                          <span className={`badge text-bg-${tone}`}>{u.unlimited ? "Unlimited" : (u.remaining ?? 0).toLocaleString()}</span>
                        </div>
                        {!u.unlimited ? (
                          <>
                            <div className="progress mb-1" style={{ height: 6 }}>
                              <div className={`progress-bar bg-${tone}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="small text-body-secondary">{u.used.toLocaleString()} / {(u.limit ?? 0).toLocaleString()} used</div>
                          </>
                        ) : <div className="small text-body-secondary">No limit</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="col-12 col-md-6 col-xl-3">
                <div className="card h-100">
                  <div className="card-body">
                    <div className="d-flex justify-content-between mb-2">
                      <span className="small fw-semibold text-body-secondary">Credits Remaining</span>
                      <span className={`badge text-bg-${creditsSummary?.planExpired ? "danger" : creditTone}`}>
                        {creditsSummary ? (creditsSummary.planExpired ? 0 : creditsSummary.availableCredits).toLocaleString() : "—"}
                      </span>
                    </div>
                    {creditsSummary ? (
                      creditsSummary.planExpired ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="badge text-bg-danger">Plan Expired</span>
                          <span className="small text-body-secondary">Renew your plan to continue.</span>
                        </div>
                      ) : (
                        <>
                          <div className="progress mb-1" style={{ height: 6 }}>
                            <div className={`progress-bar bg-${creditTone}`} style={{ width: `${100 - creditPct}%` }} />
                          </div>
                          <div className="small text-body-secondary">{(creditsSummary.totalCredits - creditsSummary.availableCredits).toLocaleString()} / {creditsSummary.totalCredits.toLocaleString()} used</div>
                        </>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      })() : null}

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
