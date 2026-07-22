import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import AxiosHelper from "../../helper/AxiosHelper";
import { Modal } from "../../component/common/Modal";
import ActionDropdown from "../../component/common/ActionDropdown";

type Plan = {
  id: string; code: string; name: string;
  monthlyPrice: number; yearlyPrice: number; credits: number;
  trainingLimit: number | null; sessionLimit: number | null; userLimit: number | null;
  validityDays: number; active: boolean; discountPercentage?: number;
};
type PlanChange = {
  id: string; action: string; changedBy: string; changedAt: string;
  previousValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null;
};

const blankForm = (): Partial<Plan> => ({
  code: "", name: "", monthlyPrice: 0, yearlyPrice: 0, credits: 0,
  trainingLimit: null, sessionLimit: null, userLimit: null, validityDays: 30, discountPercentage: 0
});

const numOrNull = (val: number | null) => (val === null || val === undefined ? "∞" : val.toLocaleString());

const PlanManagement = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<Partial<Plan>>({});
  const [historyFor, setHistoryFor] = useState<Plan | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<PlanChange[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const res = await AxiosHelper.getData<{ record: Plan[] }>("/plans");
    setLoading(false);
    if (res.data.status) {
      // Handle both "record" and "records" key variations from backend, with fallback
      setPlans(res.data.data.record || (res.data.data as any).records || []);
    } else {
      toast.error(res.data.message);
    }
  }, []);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  const openCreate = () => { setForm(blankForm()); setCreating(true); };
  const openEdit = (plan: Plan) => { setForm({ ...plan }); setEditing(plan); };
  const closeForm = () => { setCreating(false); setEditing(null); setForm({}); };

  const setField = <K extends keyof Plan>(field: K, val: string) => {
    const numeric: (keyof Plan)[] = ["monthlyPrice", "yearlyPrice", "credits", "trainingLimit", "sessionLimit", "userLimit", "validityDays", "discountPercentage"];
    setForm((prev) => ({
      ...prev,
      [field]: numeric.includes(field) ? (val === "" ? null : Number(val)) : val,
    }));
  };

  const savePlan = async () => {
    if (!form.code || !form.name) return toast.error("Code and Name are required.");
    setSaving(true);
    try {
      if (editing) {
        const res = await AxiosHelper.putData<{ record: Plan }, Partial<Plan>>(`/plans/${editing.id}`, form);
        if (res.data.status) { toast.success("Plan updated."); closeForm(); await fetchPlans(); }
        else toast.error(res.data.message);
      } else {
        const res = await AxiosHelper.postData<{ record: Plan }, Partial<Plan>>("/plans", form);
        if (res.data.status) { toast.success("Plan created."); closeForm(); await fetchPlans(); }
        else toast.error(res.data.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    const res = await AxiosHelper.putData(`/plans/${plan.id}`, { active: !plan.active });
    if (res.data.status) { toast.success(`Plan ${plan.active ? "disabled" : "activated"}.`); await fetchPlans(); }
    else toast.error(res.data.message);
  };

  const openHistory = async (plan: Plan) => {
    setHistoryFor(plan);
    setHistoryLoading(true);
    const res = await AxiosHelper.getData<{ record: PlanChange[] }>(`/plans/${plan.id}/history`);
    setHistoryLoading(false);
    if (res.data.status) setHistory(res.data.data.record);
    else toast.error(res.data.message);
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-end mb-3">
        <button className="btn btn-primary" onClick={openCreate}><i className="bi bi-plus-lg me-1" />Create Plan</button>
      </div>

      <div className="card admin-reference-table-card">
        <div className="admin-reference-table-wrapper">
          <table className="table table-bordered align-middle admin-reference-table mb-0">
            <thead>
              <tr>
                <th>Plan</th><th>Monthly</th><th>Yearly</th><th>Credits</th>
                <th>Trainings</th><th>Sessions</th><th>Users</th><th>Status</th><th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-4 text-body-secondary">Loading plans…</td></tr>
              ) : plans.length ? (
                plans.map((p) => (
                  <tr key={p.id}>
                    <td><div className="fw-semibold">{p.name}</div><div className="small text-body-secondary">{p.code}</div></td>
                    <td>{p.monthlyPrice.toLocaleString()}</td>
                    <td>{p.yearlyPrice.toLocaleString()}</td>
                    <td>{p.credits.toLocaleString()}</td>
                    <td>{numOrNull(p.trainingLimit)}</td>
                    <td>{numOrNull(p.sessionLimit)}</td>
                    <td>{numOrNull(p.userLimit)}</td>
                    <td><span className={`badge ${p.active ? "text-bg-success" : "text-bg-secondary"}`}>{p.active ? "Active" : "Disabled"}</span></td>
                    <td className="text-end">
                      <ActionDropdown label={`Open actions for ${p.name}`}>
                        {({ close }) => (
                          <>
                            <button className="dropdown-item" onClick={() => { close(); openEdit(p); }}>
                              <i className="bi bi-pencil" />
                              <span>Edit</span>
                            </button>
                            <button className="dropdown-item" onClick={() => { close(); void toggleActive(p); }}>
                              <i className={p.active ? "bi bi-slash-circle" : "bi bi-check-circle"} />
                              <span>{p.active ? "Disable" : "Activate"}</span>
                            </button>
                            <button className="dropdown-item" onClick={() => { close(); void openHistory(p); }}>
                              <i className="bi bi-clock-history" />
                              <span>History</span>
                            </button>
                          </>
                        )}
                      </ActionDropdown>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={9} className="text-center py-4 text-body-secondary">No plans yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <Modal show title={editing ? `Edit ${editing.name}` : "Create Plan"} onClose={closeForm}>
          <div className="row g-2">
            <div className="col-6"><label className="form-label small">Code</label>
              <input className="form-control" value={form.code || ""} disabled={Boolean(editing)} onChange={(e) => setField("code", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Name</label>
              <input className="form-control" value={form.name || ""} onChange={(e) => setField("name", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Monthly Price</label>
              <input type="number" className="form-control" value={form.monthlyPrice ?? 0} onChange={(e) => setField("monthlyPrice", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Yearly Price</label>
              <input type="number" className="form-control" value={form.yearlyPrice ?? 0} onChange={(e) => setField("yearlyPrice", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Credits</label>
              <input type="number" className="form-control" value={form.credits ?? 0} onChange={(e) => setField("credits", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Validity (days)</label>
              <input type="number" className="form-control" value={form.validityDays ?? 30} onChange={(e) => setField("validityDays", e.target.value)} /></div>
            <div className="col-4"><label className="form-label small">Training Count <span className="text-body-secondary">(blank = ∞)</span></label>
              <input type="number" className="form-control" value={form.trainingLimit ?? ""} onChange={(e) => setField("trainingLimit", e.target.value)} /></div>
            <div className="col-4"><label className="form-label small">Session Count</label>
              <input type="number" className="form-control" value={form.sessionLimit ?? ""} onChange={(e) => setField("sessionLimit", e.target.value)} /></div>
            <div className="col-4"><label className="form-label small">User Count</label>
              <input type="number" className="form-control" value={form.userLimit ?? ""} onChange={(e) => setField("userLimit", e.target.value)} /></div>
          </div>
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-light" onClick={closeForm}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !form.code || !form.name} onClick={() => void savePlan()}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </Modal>
      )}

      {historyFor && (
        <Modal show title={`${historyFor.name} — Change History`} onClose={() => setHistoryFor(null)}>
          {historyLoading ? (
            <div className="text-body-secondary py-3">Loading history...</div>
          ) : history.length ? (
            <ul className="list-group">
              {history.map((h) => (
                <li key={h.id} className="list-group-item">
                  <div className="d-flex justify-content-between">
                    <span className="fw-semibold text-capitalize">{h.action}</span>
                    <span className="small text-body-secondary">{new Date(h.changedAt).toLocaleString()}</span>
                  </div>
                  <div className="small text-body-secondary">By {h.changedBy || "System"}</div>
                </li>
              ))}
            </ul>
          ) : <div className="text-body-secondary">No changes recorded.</div>}
        </Modal>
      )}
    </div>
  );
};

export default PlanManagement;
