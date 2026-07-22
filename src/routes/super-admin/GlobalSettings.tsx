import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import AxiosHelper from "../../helper/AxiosHelper";

type CreditCosts = {
  training: number;
  session: number;
  user: number;
};

const GlobalSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [costs, setCosts] = useState<CreditCosts>({ training: 500, session: 100, user: 200 });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await AxiosHelper.getData<{ creditCosts: CreditCosts }>("/settings/billing");
    setLoading(false);
    if (res.data.status) {
      setCosts(res.data.data.creditCosts);
    } else {
      toast.error(res.data.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    const res = await AxiosHelper.putData<{ creditCosts: CreditCosts }, { creditCosts: CreditCosts }>(
      "/settings/billing",
      { creditCosts: costs }
    );
    setSaving(false);
    if (res.data.status) {
      toast.success("Global billing settings updated.");
    } else {
      toast.error(res.data.message);
    }
  };

  const setField = (field: keyof CreditCosts, value: string) => {
    setCosts((prev) => ({ ...prev, [field]: Number(value) }));
  };

  if (loading) {
    return (
      <div className="container-fluid py-3">
        <div className="text-center text-body-secondary py-5">Loading settings...</div>
      </div>
    );
  }

  return (
    <div>

      <div className="card max-w-2xl">
        <div className="card-header bg-white border-bottom-0 pt-4 pb-0">
          <h5 className="card-title fw-semibold mb-0">Global Credit Costs</h5>
          <p className="small text-body-secondary mb-0 mt-1">
            Set the default credit deduction amounts for core platform actions. These apply to all clients unless overridden.
          </p>
        </div>
        <div className="card-body">
          <div className="row g-4">
            <div className="col-12">
              <label className="form-label fw-medium text-body-secondary small">Training Creation</label>
              <div className="input-group">
                <input
                  type="number"
                  className="form-control"
                  value={costs.training}
                  onChange={(e) => setField("training", e.target.value)}
                />
                <span className="input-group-text bg-light text-body-secondary">credits</span>
              </div>
              <div className="form-text">Deducted when a client creates a new training program.</div>
            </div>

            <div className="col-12">
              <label className="form-label fw-medium text-body-secondary small">Session Creation</label>
              <div className="input-group">
                <input
                  type="number"
                  className="form-control"
                  value={costs.session}
                  onChange={(e) => setField("session", e.target.value)}
                />
                <span className="input-group-text bg-light text-body-secondary">credits</span>
              </div>
              <div className="form-text">Deducted when a client schedules a new session.</div>
            </div>

            <div className="col-12">
              <label className="form-label fw-medium text-body-secondary small">User Invitation</label>
              <div className="input-group">
                <input
                  type="number"
                  className="form-control"
                  value={costs.user}
                  onChange={(e) => setField("user", e.target.value)}
                />
                <span className="input-group-text bg-light text-body-secondary">credits</span>
              </div>
              <div className="form-text">Deducted when a client adds or invites a new user to their tenant.</div>
            </div>
          </div>
        </div>
        <div className="card-footer bg-light border-top text-end">
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GlobalSettings;
