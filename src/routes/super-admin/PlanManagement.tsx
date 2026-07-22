import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import AxiosHelper from "../../helper/AxiosHelper";
import { Modal } from "../../component/common/Modal";
import ActionDropdown from "../../component/common/ActionDropdown";

// Matches the backend Plan model / planView() (super-admin/planController.js) —
// per-resource lifetime limits (trainingLimit/sessionLimit/userLimit) and a
// separate yearlyPrice no longer exist; billing moved to a single credit pool
// with one price + an optional discount (see credits.js / commit ae5d3ea).
type Plan = {
  id: string; code: string; name: string;
  price: number; discountPercentage?: number; credits: number;
  validityDays: number; active: boolean;
  features?: string[];
};
type PlanChange = {
  id: string; action: string; changedBy: string; changedAt: string;
  previousValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null;
};

const blankForm = (): Partial<Plan> => ({
  name: "", price: 0, discountPercentage: 0, credits: 0, validityDays: 30, features: [],
});

// The backend still requires a "code" (internal identifier, kept immutable
// after creation — see Plan.js / planController.js) but admins no longer type
// it themselves; it's derived from the plan name so the field can be dropped
// from the Create/Edit form entirely.
const deriveCodeFromName = (name: string) => {
  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || `PLAN_${Date.now()}`;
};

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
    const numeric: (keyof Plan)[] = ["price", "credits", "validityDays", "discountPercentage"];
    setForm((prev) => ({
      ...prev,
      [field]: numeric.includes(field) ? (val === "" ? null : Number(val)) : val,
    }));
  };

  const savePlan = async () => {
    if (!form.name) return toast.error("Name is required.");
    setSaving(true);
    try {
      if (editing) {
        const res = await AxiosHelper.putData<{ record: Plan }, Partial<Plan>>(`/plans/${editing.id}`, form);
        if (res.data.status) { toast.success("Plan updated."); closeForm(); await fetchPlans(); }
        else toast.error(res.data.message);
      } else {
        const payload: Partial<Plan> = { ...form, code: deriveCodeFromName(form.name) };
        const res = await AxiosHelper.postData<{ record: Plan }, Partial<Plan>>("/plans", payload);
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

  const deletePlan = async (plan: Plan) => {
    const result = await Swal.fire({
      title: `Delete ${plan.name}?`,
      text: "This removes the plan definition. Existing subscribers already on it are unaffected — they fall back to the default plan pricing.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) {
      return;
    }

    const res = await AxiosHelper.deleteData(`/plans/${plan.id}`);
    if (res.data.status) { toast.success("Plan deleted."); await fetchPlans(); }
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
                <th>Plan</th><th>Price</th><th>Discount %</th><th>Credits</th>
                <th>Validity (days)</th><th>Status</th><th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-4 text-body-secondary">Loading plans…</td></tr>
              ) : plans.length ? (
                plans.map((p) => (
                  <tr key={p.id}>
                    <td><div className="fw-semibold">{p.name}</div></td>
                    <td>
                      {p.discountPercentage ? (
                        <div>
                          <div className="text-decoration-line-through text-body-secondary small">
                            {Number(p.price ?? 0).toLocaleString()}
                          </div>
                          <div className="fw-semibold">
                            {Math.round(Number(p.price ?? 0) * (1 - Number(p.discountPercentage) / 100)).toLocaleString()}
                          </div>
                        </div>
                      ) : (
                        Number(p.price ?? 0).toLocaleString()
                      )}
                    </td>
                    <td>{Number(p.discountPercentage ?? 0)}%</td>
                    <td>{Number(p.credits ?? 0).toLocaleString()}</td>
                    <td>{Number(p.validityDays ?? 0)}</td>
                    <td><span className={`badge ${p.active ? "text-bg-success" : "text-bg-secondary"}`}>{p.active ? "Active" : "Disabled"}</span></td>
                    <td className="text-end">
                      <ActionDropdown label={`Open actions for ${p.name}`}>
                        {({ close }) => (
                          <>
                            <button type="button" className="dropdown-item" onClick={() => { close(); openEdit(p); }}>
                              <i className="bi bi-pencil" />
                              <span>Edit</span>
                            </button>
                            <button type="button" className="dropdown-item" onClick={() => { close(); void toggleActive(p); }}>
                              <i className={p.active ? "bi bi-slash-circle" : "bi bi-check-circle"} />
                              <span>{p.active ? "Disable" : "Activate"}</span>
                            </button>
                            <button type="button" className="dropdown-item" onClick={() => { close(); void openHistory(p); }}>
                              <i className="bi bi-clock-history" />
                              <span>History</span>
                            </button>
                            {p.code !== "ENTERPRISE" ? (
                              <button type="button" className="dropdown-item text-danger" onClick={() => { close(); void deletePlan(p); }}>
                                <i className="bi bi-trash" />
                                <span>Delete</span>
                              </button>
                            ) : null}
                          </>
                        )}
                      </ActionDropdown>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="text-center py-4 text-body-secondary">No plans yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <Modal show title={editing ? `Edit ${editing.name}` : "Create Plan"} onClose={closeForm}>
          <div className="row g-2">
            <div className="col-12"><label className="form-label small">Name</label>
              <input
                className="form-control"
                value={form.name || ""}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>
            <div className="col-6"><label className="form-label small">Price</label>
              <input
                type="number"
                className="form-control"
                value={form.price ?? 0}
                onChange={(e) => setField("price", e.target.value)}
              />
            </div>
            <div className="col-6"><label className="form-label small">Discount %</label>
              <input type="number" className="form-control" value={form.discountPercentage ?? 0} onChange={(e) => setField("discountPercentage", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Credits</label>
              <input type="number" className="form-control" value={form.credits ?? 0} onChange={(e) => setField("credits", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Validity (days)</label>
              <input type="number" className="form-control" value={form.validityDays ?? 30} onChange={(e) => setField("validityDays", e.target.value)} /></div>
            <div className="col-12"><label className="form-label small">Features (one per line)</label>
              <textarea
                className="form-control"
                rows={3}
                value={Array.isArray(form.features) ? form.features.join("\n") : ""}
                onChange={(e) => setForm((prev) => ({ ...prev, features: e.target.value.split("\n") }))}
                placeholder="Example:&#10;Pay-as-you-go with credits&#10;Dedicated onboarding support"
              />
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-light" onClick={closeForm}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !form.name} onClick={() => void savePlan()}>{saving ? "Saving…" : "Save"}</button>
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
