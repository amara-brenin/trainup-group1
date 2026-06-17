import { useCallback, useEffect, useState } from "react";
import PageShell from "../../component/common/PageShell";
import AxiosHelper from "../../helper/AxiosHelper";

type InsightsData = {
  clientsByPlan: Record<string, number>;
  activePlans: number;
  disabledPlans: number;
  totalAddonPurchases: number;
  totalAddonRevenue: number;
  creditsConsumed: number;
  creditsPurchased: number;
  addonRevenueByMonth: Record<string, number>;
  creditsByMonth: Record<string, { consumed: number; purchased: number }>;
};

const sortedKeys = (obj: Record<string, unknown>) => Object.keys(obj).sort();

const BarSvg = ({ data, color, label }: { data: Record<string, number>; color: string; label: string }) => {
  const keys = sortedKeys(data).slice(-12);
  if (!keys.length) return <div className="text-body-secondary small">No data yet</div>;
  const max = Math.max(1, ...keys.map((k) => data[k]));
  const w = 600;
  const h = 200;
  const barW = Math.max(12, (w - 60) / keys.length - 4);
  return (
    <svg viewBox={`0 0 ${w} ${h + 30}`} className="w-100" style={{ maxHeight: 260 }}>
      <text x={w / 2} y={14} textAnchor="middle" fontSize={11} fill="var(--bs-body-color)">{label}</text>
      {keys.map((k, i) => {
        const val = data[k];
        const barH = (val / max) * (h - 30);
        const x = 40 + i * (barW + 4);
        return (
          <g key={k}>
            <rect x={x} y={h - barH} width={barW} height={barH} rx={3} fill={color} opacity={0.8} />
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" fontSize={8} fill="var(--bs-body-color)">{k.slice(5)}</text>
            <text x={x + barW / 2} y={h - barH - 4} textAnchor="middle" fontSize={8} fill="var(--bs-body-color)">{val.toLocaleString()}</text>
          </g>
        );
      })}
    </svg>
  );
};

const DonutSvg = ({ data }: { data: Record<string, number> }) => {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  if (!entries.length) return <div className="text-body-secondary small">No data yet</div>;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors = ["#4f46e5", "#0891b2", "#16a34a", "#eab308", "#ef4444", "#8b5cf6"];
  let cum = 0;
  const r = 60;
  const cx = 90;
  const cy = 90;
  return (
    <svg viewBox="0 0 280 180" className="w-100" style={{ maxHeight: 200 }}>
      {entries.map(([label, val], i) => {
        const start = cum / total;
        cum += val;
        const end = cum / total;
        const large = end - start > 0.5 ? 1 : 0;
        const x1 = cx + r * Math.cos(2 * Math.PI * start - Math.PI / 2);
        const y1 = cy + r * Math.sin(2 * Math.PI * start - Math.PI / 2);
        const x2 = cx + r * Math.cos(2 * Math.PI * end - Math.PI / 2);
        const y2 = cy + r * Math.sin(2 * Math.PI * end - Math.PI / 2);
        return (
          <g key={label}>
            <path d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`} fill={colors[i % colors.length]} />
            <text x={195} y={30 + i * 22} fontSize={10} fill="var(--bs-body-color)">
              <tspan fill={colors[i % colors.length]}>&#9632; </tspan>{label}: {val}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const BillingInsights = () => {
  const [data, setData] = useState<InsightsData | null>(null);

  const fetch = useCallback(async () => {
    const res = await AxiosHelper.getData<InsightsData>("/billing/insights");
    if (res.data.status) setData(res.data.data);
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);

  if (!data) return <div className="card"><div className="card-body p-4">Loading billing insights...</div></div>;

  const creditConsumptionByMonth: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.creditsByMonth)) {
    creditConsumptionByMonth[k] = v.consumed;
  }

  return (
    <PageShell title="Billing Insights" description="Platform-wide billing, plan distribution, and credit metrics.">
      <div className="row g-3 mb-3">
        {[
          { label: "Active Plans", value: data.activePlans, icon: "ri-checkbox-circle-line", tone: "success" },
          { label: "Disabled Plans", value: data.disabledPlans, icon: "ri-close-circle-line", tone: "secondary" },
          { label: "Add-On Purchases", value: data.totalAddonPurchases, icon: "ri-shopping-cart-line", tone: "primary" },
          { label: "Add-On Revenue", value: data.totalAddonRevenue.toLocaleString(), icon: "ri-money-dollar-circle-line", tone: "warning" },
          { label: "Credits Consumed", value: data.creditsConsumed.toLocaleString(), icon: "ri-fire-line", tone: "danger" },
          { label: "Credits Purchased", value: data.creditsPurchased.toLocaleString(), icon: "ri-coin-line", tone: "info" },
        ].map((m) => (
          <div key={m.label} className="col-6 col-md-4 col-xl-2">
            <div className="card h-100">
              <div className="card-body text-center py-3">
                <i className={`${m.icon} fs-4 text-${m.tone} d-block mb-1`} />
                <div className="fs-5 fw-semibold">{m.value}</div>
                <div className="small text-body-secondary">{m.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-body">
              <h3 className="h6 fw-semibold mb-3">Plan Distribution</h3>
              <DonutSvg data={data.clientsByPlan} />
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-body">
              <h3 className="h6 fw-semibold mb-3">Add-On Revenue Trend</h3>
              <BarSvg data={data.addonRevenueByMonth} color="#4f46e5" label="Monthly Revenue" />
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-body">
              <h3 className="h6 fw-semibold mb-3">Credit Consumption Trend</h3>
              <BarSvg data={creditConsumptionByMonth} color="#ef4444" label="Monthly Consumption" />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h3 className="h6 fw-semibold mb-3">Clients by Plan</h3>
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead><tr><th>Plan</th><th>Clients</th></tr></thead>
              <tbody>
                {Object.entries(data.clientsByPlan).map(([plan, count]) => (
                  <tr key={plan}><td className="fw-semibold">{plan}</td><td>{count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default BillingInsights;
