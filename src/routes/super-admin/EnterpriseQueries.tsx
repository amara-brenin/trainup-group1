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
  const [viewingQuery, setViewingQuery] = useState<EnterpriseRequestRow | null>(null);
  const [showOfferForm, setShowOfferForm] = useState(false);
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

  const handleOpenView = (row: EnterpriseRequestRow) => {
    setViewingQuery(row);
    setShowOfferForm(false);
    setOfferPrice(row.approxBudget || 0);
    setOfferCredits(0);
    setOfferValidityDays(30);
  };



  const closeView = () => {
    setViewingQuery(null);
    setShowOfferForm(false);
  };

  const sendOffer = async () => {
    if (!viewingQuery) return;
    if (!offerCredits) {
      toast.error("Enter the custom credits to grant.");
      return;
    }

    setSubmittingOffer(true);
    const res = await AxiosHelper.postData(
      `/enterprise-requests/${viewingQuery.clientId}/${viewingQuery.requestId}/offer`,
      { price: offerPrice, credits: offerCredits, validityDays: offerValidityDays },
    );
    setSubmittingOffer(false);

    if (res.data.status) {
      toast.success("Offer sent to the client.");
      closeView();
      await fetchRows();
    } else {
      toast.error(res.data.message);
    }
  };

  const rejectRequest = async (row: EnterpriseRequestRow) => {
    const result = await Swal.fire({
      title: `Decline ${row.clientName}'s request?`,
      text: "Are you sure you want to decline this enterprise query? This action cannot be easily undone.",
      input: "text",
      inputPlaceholder: "Optional reason (shared with the client)",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Decline",
      confirmButtonColor: "#f15776",
      cancelButtonText: "Cancel",
    });

    if (!result.isConfirmed) return;

    const res = await AxiosHelper.postData(
      `/enterprise-requests/${row.clientId}/${row.requestId}/reject`,
      { reason: result.value || "" },
    );

    if (res.data.status) {
      toast.success("Request declined.");
      closeView();
      await fetchRows();
    } else {
      toast.error(res.data.message);
    }
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
                <th>Status</th>
                <th>Requested</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-4 text-body-secondary">Loading queries…</td></tr>
              ) : rows.length ? (
                rows.map((row) => (
                  <tr key={`${row.clientId}-${row.requestId}`}>
                    <td className="fw-semibold">{row.clientName}</td>
                    <td>
                      <div>{row.requestedByName}</div>
                      <div className="small text-body-secondary">{row.requestedByEmail}</div>
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
                      <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => handleOpenView(row)}>
                        <i className="bi bi-eye me-1" /> View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="text-center py-4 text-body-secondary">No enterprise queries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewingQuery && (
        <Modal show title={`Enterprise Query — ${viewingQuery.clientName}`} onClose={closeView} size="lg">
          <div className="p-1">
            {/* Top Compact Split Grid */}
            <div className="row g-3 mb-3">
              {/* Left Column: Client Details */}
              <div className="col-12 col-md-5 border-end">
                <div className="pe-md-2">
                  <h6 className="fw-bold text-uppercase small text-body-secondary mb-2" style={{ letterSpacing: "0.5px" }}>Request Details</h6>
                  <ul className="list-group list-group-flush small" style={{ fontSize: "13px" }}>
                    <li className="list-group-item px-0 py-1.5 d-flex justify-content-between align-items-center bg-transparent">
                      <span className="text-body-secondary">Company:</span>
                      <strong className="text-end text-dark">{viewingQuery.clientName}</strong>
                    </li>
                    <li className="list-group-item px-0 py-1.5 d-flex justify-content-between align-items-center bg-transparent">
                      <span className="text-body-secondary">Contact Name:</span>
                      <span className="text-end fw-semibold text-dark">{viewingQuery.requestedByName}</span>
                    </li>
                    <li className="list-group-item px-0 py-1.5 d-flex justify-content-between align-items-center bg-transparent">
                      <span className="text-body-secondary">Contact Email:</span>
                      <a href={`mailto:${viewingQuery.requestedByEmail}`} className="text-decoration-none fw-semibold">{viewingQuery.requestedByEmail}</a>
                    </li>
                    <li className="list-group-item px-0 py-1.5 d-flex justify-content-between align-items-center bg-transparent">
                      <span className="text-body-secondary">Requested On:</span>
                      <span className="text-dark">{new Date(viewingQuery.requestedAt).toLocaleDateString()}</span>
                    </li>
                    <li className="list-group-item px-0 py-1.5 d-flex justify-content-between align-items-center bg-transparent">
                      <span className="text-body-secondary">Current Status:</span>
                      <span className={`badge ${STATUS_BADGE[viewingQuery.status] || "text-bg-secondary"}`}>
                        {STATUS_LABEL[viewingQuery.status] || viewingQuery.status}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Right Column: Requirements & Message */}
              <div className="col-12 col-md-7">
                <div className="ps-md-2">
                  <h6 className="fw-bold text-uppercase small text-body-secondary mb-2" style={{ letterSpacing: "0.5px" }}>Approximate Requirements</h6>
                  <div className="row g-2 mb-3 text-center">
                    <div className="col-3">
                      <div className="border rounded py-2 bg-light px-1">
                        <span className="d-block text-body-secondary text-uppercase font-monospace mb-1" style={{ fontSize: "9px" }}>Users</span>
                        <strong className="small text-dark">{viewingQuery.approxUsers?.toLocaleString() || "—"}</strong>
                      </div>
                    </div>
                    <div className="col-3">
                      <div className="border rounded py-2 bg-light px-1">
                        <span className="d-block text-body-secondary text-uppercase font-monospace mb-1" style={{ fontSize: "9px" }}>Trainings/mo</span>
                        <strong className="small text-dark">{viewingQuery.approxTrainings?.toLocaleString() || "—"}</strong>
                      </div>
                    </div>
                    <div className="col-3">
                      <div className="border rounded py-2 bg-light px-1">
                        <span className="d-block text-body-secondary text-uppercase font-monospace mb-1" style={{ fontSize: "9px" }}>Sessions/mo</span>
                        <strong className="small text-dark">{viewingQuery.approxSessions?.toLocaleString() || "—"}</strong>
                      </div>
                    </div>
                    <div className="col-3">
                      <div className="border rounded py-2 bg-light px-1">
                        <span className="d-block text-body-secondary text-uppercase font-monospace mb-1" style={{ fontSize: "9px" }}>Budget</span>
                        <strong className="small text-dark">{viewingQuery.approxBudget ? `₹${viewingQuery.approxBudget.toLocaleString()}` : "—"}</strong>
                      </div>
                    </div>
                  </div>

                  <h6 className="fw-bold text-uppercase small text-body-secondary mb-1" style={{ letterSpacing: "0.5px" }}>Message</h6>
                  <div className="bg-light p-2 rounded border small text-start" style={{ whiteSpace: "pre-wrap", minHeight: "80px", maxHeight: "140px", overflowY: "auto", fontSize: "13px" }}>
                    {viewingQuery.message || <em className="text-body-secondary">No message provided.</em>}
                  </div>
                </div>
              </div>
            </div>

            {/* Offer details if already resolved */}
            {viewingQuery.status === "offer_sent" && viewingQuery.offerCredits ? (
              <div className="alert alert-warning py-2 px-3 d-flex align-items-center my-3 mb-1 small">
                <i className="bi bi-info-circle-fill me-2 fs-6" />
                <div>
                  <strong>Active Offer Sent:</strong> {viewingQuery.offerCredits.toLocaleString()} credits for <strong>₹{viewingQuery.offerPrice?.toLocaleString()}</strong> with validity of {viewingQuery.offerValidityDays || 30} days. Awaiting client payment.
                </div>
              </div>
            ) : viewingQuery.status === "rejected" ? (
              <div className="alert alert-danger py-2 px-3 d-flex align-items-center my-3 mb-1 small">
                <i className="bi bi-x-circle-fill me-2 fs-6" />
                <div>
                  <strong>Declined:</strong> {viewingQuery.rejectReason ? `Reason given: "${viewingQuery.rejectReason}"` : "This query was declined."}
                </div>
              </div>
            ) : null}

            {/* Custom Offer Send Form Section */}
            {showOfferForm && (
              <div className="border rounded p-3 bg-light-subtle my-3 mb-1 animate-fade-in">
                <h5 className="h6 fw-bold mb-2 text-primary"><i className="bi bi-gift-fill me-1" /> Prepare Custom Offer</h5>
                <p className="small text-body-secondary mb-3" style={{ fontSize: "12px" }}>
                  This sends a payable custom offer directly to the client. Credits are granted only once they confirm and pay on their Upgrade &amp; Billing page.
                </p>
                <div className="row g-2">
                  <div className="col-12 col-md-4">
                    <label className="form-label small mb-1">Price (INR)</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={offerPrice}
                      onChange={(e) => setOfferPrice(Number(e.target.value))}
                    />
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label small mb-1">Credits to Grant</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={offerCredits}
                      onChange={(e) => setOfferCredits(Number(e.target.value))}
                    />
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label small mb-1">Validity (days)</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={offerValidityDays}
                      onChange={(e) => setOfferValidityDays(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Actions Footer */}
          <div className="d-flex justify-content-end gap-2 mt-3 pt-2 border-top">
            {showOfferForm ? (
              <>
                <button type="button" className="btn btn-sm btn-light" onClick={() => setShowOfferForm(false)}>
                  <i className="bi bi-arrow-left me-1" /> Back to Details
                </button>
                <button type="button" className="btn btn-sm btn-primary" disabled={submittingOffer} onClick={() => void sendOffer()}>
                  {submittingOffer ? "Sending Offer…" : "Send Offer Now"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-sm btn-light" onClick={closeView}>Close</button>
                {viewingQuery.status === "pending" && (
                  <>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void rejectRequest(viewingQuery)}>
                      <i className="bi bi-x-circle me-1" /> Decline Query
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowOfferForm(true)}>
                      <i className="bi bi-send-fill me-1" /> Prepare Offer
                    </button>
                  </>
                )}
                {viewingQuery.status === "offer_sent" && (
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void rejectRequest(viewingQuery)}>
                    <i className="bi bi-x-circle me-1" /> Decline Query
                  </button>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default EnterpriseQueries;
