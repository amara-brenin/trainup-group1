import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import AxiosHelper from "../../helper/AxiosHelper";
import { Modal } from "../../component/common/Modal";

type EnterpriseRequestRow = {
  clientId: string;
  clientName: string;
  requestId: string;
  requestedAt: string;
  requestedByName: string;
  requestedByEmail: string;
  message: string;
  approxUsers: number | null;
  approxTrainings: number | null;
  approxSessions: number | null;
  approxBudget: number | null;
  status: "pending" | "offer_sent" | "paid" | "rejected" | string;
  offerPrice: number | null;
  offerCredits: number | null;
  offerValidityDays: number | null;
  rejectReason: string;
  resolvedAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  pending: "text-bg-primary",
  offer_sent: "text-bg-warning",
  paid: "text-bg-success",
  rejected: "text-bg-danger",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  offer_sent: "Offer sent",
  paid: "Paid",
  rejected: "Rejected",
};

const EnterpriseQueries = () => {
  const [rows, setRows] = useState<EnterpriseRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [offerFor, setOfferFor] = useState<EnterpriseRequestRow | null>(null);
  const [offerPrice, setOfferPrice] = useState(0);
  const [offerCredits, setOfferCredits] = useState(0);
  const [offerValidityDays, setOfferValidityDays] = useState(30);
  const [submittingOffer, setSubmittingOffer] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const res = await AxiosHelper.getData<{ record: EnterpriseRequestRow[] }>("/enterprise-requests");
    setLoading(false);
    if (res.data.status) {
      setRows(res.data.data.record || []);
    } else {
      toast.error(res.data.message);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const openOffer = (row: EnterpriseRequestRow) => {
    setOfferFor(row);
    setOfferPrice(row.approxBudget || 0);
    setOfferCredits(0);
    setOfferValidityDays(30);
  };

  const closeOffer = () => setOfferFor(null);

  const sendOffer = async () => {
    if (!offerFor) return;
    if (!offerCredits) {
      toast.error("Enter the custom credits to grant.");
      return;
    }

    setSubmittingOffer(true);
    const res = await AxiosHelper.postData(
      `/enterprise-requests/${offerFor.clientId}/${offerFor.requestId}/offer`,
      { price: offerPrice, credits: offerCredits, validityDays: offerValidityDays },
    );
    setSubmittingOffer(false);

    if (res.data.status) {
      toast.success("Offer sent to the client.");
      closeOffer();
      await fetchRows();
    } else {
      toast.error(res.data.message);
    }
  };

  const rejectRequest = async (row: EnterpriseRequestRow) => {
    const result = await Swal.fire({
      title: `Decline ${row.clientName}'s request?`,
      input: "text",
      inputPlaceholder: "Optional reason (shared with the client)",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Decline",
      confirmButtonColor: "#f15776",
    });

    if (!result.isConfirmed) return;

    const res = await AxiosHelper.postData(
      `/enterprise-requests/${row.clientId}/${row.requestId}/reject`,
      { reason: result.value || "" },
    );

    if (res.data.status) {
      toast.success("Request declined.");
      await fetchRows();
    } else {
      toast.error(res.data.message);
    }
  };

  const approxSummary = (row: EnterpriseRequestRow) => {
    const parts: string[] = [];
    if (row.approxUsers) parts.push(`${row.approxUsers.toLocaleString()} users`);
    if (row.approxTrainings) parts.push(`${row.approxTrainings.toLocaleString()} trainings/mo`);
    if (row.approxSessions) parts.push(`${row.approxSessions.toLocaleString()} sessions/mo`);
    if (row.approxBudget) parts.push(`budget ${row.approxBudget.toLocaleString()}`);
    return parts.length ? parts.join(", ") : "—";
  };

  return (
    <div>
      <div className="mb-3">
        <h2 className="h5 fw-semibold mb-1">Enterprise Queries</h2>
        <p className="small text-body-secondary mb-0">
          Every company's Enterprise pricing request, in one place. Send a custom offer or decline — the client pays to activate once an offer is sent.
        </p>
      </div>

      <div className="card admin-reference-table-card">
        <div className="admin-reference-table-wrapper">
          <table className="table table-bordered align-middle admin-reference-table mb-0">
            <thead>
              <tr>
                <th>Company</th>
                <th>Requested By</th>
                <th>Approx. requirement</th>
                <th>Message</th>
                <th>Status</th>
                <th>Requested</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-4 text-body-secondary">Loading queries…</td></tr>
              ) : rows.length ? (
                rows.map((row) => (
                  <tr key={`${row.clientId}-${row.requestId}`}>
                    <td className="fw-semibold">{row.clientName}</td>
                    <td>
                      <div>{row.requestedByName}</div>
                      <div className="small text-body-secondary">{row.requestedByEmail}</div>
                    </td>
                    <td>{approxSummary(row)}</td>
                    <td style={{ maxWidth: 260 }}>
                      <div className="small text-truncate" title={row.message}>{row.message || "—"}</div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[row.status] || "text-bg-secondary"}`}>
                        {STATUS_LABEL[row.status] || row.status}
                      </span>
                      {row.status === "offer_sent" && row.offerCredits ? (
                        <div className="small text-body-secondary mt-1">
                          {row.offerCredits.toLocaleString()} credits{row.offerPrice ? ` @ ${row.offerPrice.toLocaleString()}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td>{new Date(row.requestedAt).toLocaleDateString()}</td>
                    <td className="text-end">
                      {row.status === "pending" ? (
                        <div className="d-flex justify-content-end gap-2">
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => openOffer(row)}>
                            Send Offer
                          </button>
                          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void rejectRequest(row)}>
                            Decline
                          </button>
                        </div>
                      ) : row.status === "offer_sent" ? (
                        <div className="d-flex justify-content-end gap-2">
                          <span className="small text-body-secondary align-self-center">Awaiting payment</span>
                          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void rejectRequest(row)}>
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="small text-body-secondary">
                          {row.status === "rejected" && row.rejectReason ? row.rejectReason : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="text-center py-4 text-body-secondary">No enterprise queries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {offerFor && (
        <Modal show title={`Send Offer — ${offerFor.clientName}`} onClose={closeOffer}>
          <p className="small text-body-secondary">
            This sends a payable offer to the client. Credits are granted only once they confirm payment on their own Upgrade &amp; Billing page.
          </p>
          <div className="row g-2">
            <div className="col-6">
              <label className="form-label small">Price</label>
              <input
                type="number"
                className="form-control"
                value={offerPrice}
                onChange={(e) => setOfferPrice(Number(e.target.value))}
              />
            </div>
            <div className="col-6">
              <label className="form-label small">Credits</label>
              <input
                type="number"
                className="form-control"
                value={offerCredits}
                onChange={(e) => setOfferCredits(Number(e.target.value))}
              />
            </div>
            <div className="col-6">
              <label className="form-label small">Validity (days)</label>
              <input
                type="number"
                className="form-control"
                value={offerValidityDays}
                onChange={(e) => setOfferValidityDays(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-light" onClick={closeOffer}>Cancel</button>
            <button className="btn btn-primary" disabled={submittingOffer} onClick={() => void sendOffer()}>
              {submittingOffer ? "Sending…" : "Send Offer"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default EnterpriseQueries;
