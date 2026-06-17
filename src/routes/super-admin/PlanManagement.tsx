import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import AxiosHelper from "../../helper/AxiosHelper";
import { Modal } from "../../component/common/Modal";

type Plan = {
  id: string; code: string; name: string;
  monthlyPrice: number; yearlyPrice: number; credits: number;
  trainingLimit: number | null; sessionLimit: number | null; userLimit: number | null;
  validityDays: number; features: string[]; active: boolean;
};
type PlanChange = {
  id: string; action: string; changedBy: string; changedAt: string;
  previousValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null;
};

const blankForm = (): Partial<Plan> => ({
  code: "", name: "", monthlyPrice: 0, yearlyPrice: 0, credits: 0,
  trainingLimit: 0, sessionLimit: 0, userLimit: 0, validityDays: 30, features: [],
});
const numOrNull = (v: number | null) => (v === null ? "Unlimited" : v.toLocaleString());

const PlanManagement = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Plan>>(blankForm());
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<Plan | null>(null);
  const [history, setHistory] = useState<PlanChange[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await AxiosHelper.getData<{ record: Plan[] }>("/plans");
    setLoading(false);
    if (res.data.status) setPlans(res.data.data.record);
    else toast.error(res.data.message);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setForm(blankForm()); setCreating(true); setEditing(null); };
  const openEdit = (p: Plan) => { setForm({ ...p }); setEditing(p); setCreating(false); };
  const closeForm = () => { setCreating(false); setEditing(null); };

  const setField = (k: keyof Plan, v: string) => {
    const numeric: (keyof Plan)[] = ["monthlyPrice", "yearlyPrice", "credits", "trainingLimit", "sessionLimit", "userLimit", "validityDays"];
    setForm((f) => ({ ...f, [k]: numeric.includes(k) ? (v === "" ? null : Number(v)) : v }));
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form };
    const res = editing
      ? await AxiosHelper.putData<{ plan: Plan }, typeof payload>(`/plans/${editing.id}`, payload)
      : await AxiosHelper.postData<{ plan: Plan }, typeof payload>("/plans", payload);
    setSaving(false);
    if (res.data.status) {
      toast.success(editing ? "Plan updated. Existing subscribers keep their snapshot." : "Plan created.");
      closeForm();
      void load();
    } else {
      toast.error(res.data.message);
    }
  };

  const toggleActive = async (p: Plan) => {
    const res = await AxiosHelper.putData<{ plan: Plan }, { active: boolean }>(`/plans/${p.id}`, { active: !p.active });
    if (res.data.status) { toast.success(`Plan ${!p.active ? "activated" : "deactivated"}.`); void load(); }
    else toast.error(res.data.message);
  };

  const openHistory = async (p: Plan) => {
    setHistoryFor(p);
    const res = await AxiosHelper.getData<{ record: PlanChange[] }>(`/plans/${p.id}/history`);
    if (res.data.status) setHistory(res.data.data.record);
  };

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h1 className="h4 fw-semibold mb-1">Plan Management</h1>
          <p className="text-body-secondary mb-0">Edit plan pricing & limits without a deployment. Existing subscribers keep the entitlement they purchased.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><i className="bi bi-plus-lg me-1" />Create Plan</button>
      </div>

      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
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
                      <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(p)}>Edit</button>
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => void toggleActive(p)}>{p.active ? "Disable" : "Activate"}</button>
                      <button className="btn btn-sm btn-outline-info" onClick={() => void openHistory(p)}>History</button>
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

      {creating || editing ? (
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
            <button className="btn btn-primary" disabled={saving || !form.code || !form.name} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </Modal>
      ) : null}

      {historyFor ? (
        <Modal show title={`${historyFor.name} — Change History`} onClose={() => setHistoryFor(null)}>
          {history.length ? (
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
      ) : null}
    </div>
  );
};

export default PlanManagement;
