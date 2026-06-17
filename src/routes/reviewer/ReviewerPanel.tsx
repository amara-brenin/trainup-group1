import { useMemo, useState, type CSSProperties } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { Modal } from "../../component/common/Modal";
import PublicExperienceShell from "../../component/common/PublicExperienceShell";
import { reviewerQueue } from "../../constant/demoExperiences";
import { clearPublicRoleSession, getPublicRoleSession } from "../../helper/publicRoleAuth";

type ReviewRecord = (typeof reviewerQueue)[number];
type ReviewerTab = "queue" | "feedback";

const tabButtonClass = (active: boolean) =>
  `btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`;

const ReviewerPanel = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ReviewerTab>("queue");
  const [records, setRecords] = useState<ReviewRecord[]>(reviewerQueue);
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewRecord["status"]>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | ReviewRecord["priority"]>("all");
  const [sortBy, setSortBy] = useState<"recent" | "priority" | "trainer" | "title">("recent");
  const [selectedRecord, setSelectedRecord] = useState<ReviewRecord | null>(null);
  const session = getPublicRoleSession("reviewer");

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const awaitingCount = records.filter((item) => item.status === "awaiting_review").length;
  const changesCount = records.filter((item) => item.status === "changes_requested").length;
  const approvedCount = records.filter((item) => item.status === "approved").length;

  const updateStatus = (id: string, status: ReviewRecord["status"]) => {
    setRecords((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
  };

  const filteredRecords = useMemo(() => {
    const filtered = records.filter((record) => {
      const matchesStatus = statusFilter === "all" ? true : record.status === statusFilter;
      const matchesPriority = priorityFilter === "all" ? true : record.priority === priorityFilter;
      return matchesStatus && matchesPriority;
    });

    const priorityRank: Record<ReviewRecord["priority"], number> = { High: 0, Medium: 1, Low: 2 };

    return [...filtered].sort((left, right) => {
      if (sortBy === "priority") {
        return priorityRank[left.priority] - priorityRank[right.priority];
      }
      if (sortBy === "trainer") {
        return left.trainer.localeCompare(right.trainer);
      }
      if (sortBy === "title") {
        return left.title.localeCompare(right.title);
      }
      return right.submittedOn.localeCompare(left.submittedOn);
    });
  }, [priorityFilter, records, sortBy, statusFilter]);

  return (
    <>
      <PublicExperienceShell
        eyebrow="Reviewer"
        title="Review queue and approvals"
        subtitle="Inspect submitted Trainup training modules, send changes back to trainers, and approve content for publishing."
        badge={`${awaitingCount} pending review`}
        badgeClassName="text-bg-info"
        icon="bi bi-search"
        actions={
          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap w-100">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button className={tabButtonClass(activeTab === "queue")} onClick={() => setActiveTab("queue")}>
                Review Queue
              </button>
              <button className={tabButtonClass(activeTab === "feedback")} onClick={() => setActiveTab("feedback")}>
                Feedback Summary
              </button>
            </div>

            <button
              className="btn btn-sm btn-light"
              onClick={() => {
                clearPublicRoleSession("reviewer");
                navigate("/login", { replace: true });
              }}
            >
              Sign out
            </button>
          </div>
        }
      >
        {activeTab === "queue" ? (
          <>
            <div className="row g-3 mb-3">
              <div className="col-12 col-md-4">
                <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": "#16a7e9" } as CSSProperties}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="small text-body-secondary">Awaiting review</div>
                      <div className="admin-stat-icon" aria-hidden="true"><i className="bi bi-inbox" /></div>
                    </div>
                    <div className="fs-2 fw-semibold">{awaitingCount}</div>
                    <p className="text-body-secondary mb-0">New submissions that still need reviewer action.</p>
                  </div>
                </div>
              </div>
              <div className="col-12 col-md-4">
                <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": "#f15776" } as CSSProperties}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="small text-body-secondary">Changes requested</div>
                      <div className="admin-stat-icon" aria-hidden="true"><i className="bi bi-arrow-repeat" /></div>
                    </div>
                    <div className="fs-2 fw-semibold">{changesCount}</div>
                    <p className="text-body-secondary mb-0">Modules that need edits before approval.</p>
                  </div>
                </div>
              </div>
              <div className="col-12 col-md-4">
                <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": "#47ad77" } as CSSProperties}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="small text-body-secondary">Approved this cycle</div>
                      <div className="admin-stat-icon" aria-hidden="true"><i className="bi bi-check2-circle" /></div>
                    </div>
                    <div className="fs-2 fw-semibold">{approvedCount}</div>
                    <p className="text-body-secondary mb-0">Ready for employee-facing rollout once published.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="admin-reference-toolbar">
              <div className="admin-toolbar-copy">
                <h2 className="h5 fw-semibold mb-1">Current review workload</h2>
                <p className="small text-body-secondary mb-0">
                  Prioritize high-urgency launch content before evergreen modules.
                </p>
              </div>
              <div className="admin-filter-row w-100">
                <div className="admin-filter-controls">
                    <select className="form-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | ReviewRecord["status"])}>
                      <option value="all">All status</option>
                      <option value="awaiting_review">Awaiting review</option>
                      <option value="changes_requested">Changes requested</option>
                      <option value="approved">Approved</option>
                    </select>
                    <select className="form-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "all" | ReviewRecord["priority"])}>
                      <option value="all">All priority</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                    <select className="form-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as "recent" | "priority" | "trainer" | "title")}>
                      <option value="recent">Sort by recent</option>
                      <option value="priority">Sort by priority</option>
                      <option value="trainer">Sort by trainer</option>
                      <option value="title">Sort by title</option>
                    </select>
                  </div>
                </div>
            </div>

            <div className="card admin-reference-table-card">
              <div className="card-body">
                <div className="admin-reference-table-wrapper">
                  <table className="table table-hover align-middle admin-reference-table mb-0">
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th>Trainer</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((record) => (
                        <tr key={record.id}>
                          <td>
                            <div className="fw-semibold">{record.title}</div>
                            <div className="small text-body-secondary">
                              {record.slides} slides • Submitted {record.submittedOn}
                            </div>
                          </td>
                          <td>{record.trainer}</td>
                          <td>
                            <span
                              className={`badge rounded-pill ${
                                record.priority === "High"
                                  ? "text-bg-danger"
                                  : record.priority === "Medium"
                                    ? "text-bg-warning"
                                    : "text-bg-secondary"
                              }`}
                            >
                              {record.priority}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`badge rounded-pill ${
                                record.status === "approved"
                                  ? "text-bg-success"
                                  : record.status === "changes_requested"
                                    ? "text-bg-danger"
                                    : "text-bg-info"
                              }`}
                            >
                              {record.status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="text-end">
                            <div className="d-flex justify-content-end gap-2 flex-wrap">
                              <button className="btn btn-sm btn-outline-primary" onClick={() => setSelectedRecord(record)}>
                                Review
                              </button>
                              <button
                                className="btn btn-sm btn-outline-success"
                                onClick={() => {
                                  updateStatus(record.id, "approved");
                                  toast.success("Module approved.");
                                }}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => {
                                  updateStatus(record.id, "changes_requested");
                                  toast.info("Changes requested for this module.");
                                }}
                              >
                                Request changes
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredRecords.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="admin-empty-state">No review records matched the selected filters.</div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "feedback" ? (
          <div className="row g-3">
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-transparent border-0 pb-0">
                  <h2 className="h5 fw-semibold mb-1">Reviewer operating notes</h2>
                  <p className="small text-body-secondary mb-0">
                    Keep approval quality high while maintaining launch timelines.
                  </p>
                </div>
                <div className="card-body">
                  <div className="experience-list">
                    {[
                      "Check offer references and region-specific retail claims.",
                      "Confirm terminology matches Trainup product training guidance.",
                      "Flag any slide that changes compliance-sensitive wording.",
                      "Return clear, actionable notes to speed up resubmission.",
                    ].map((item) => (
                      <div key={item} className="experience-list-item">
                        <div className="d-flex align-items-start gap-3">
                          <span className="badge text-bg-primary rounded-pill mt-1">&nbsp;</span>
                          <span>{item}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-transparent border-0 pb-0">
                  <h2 className="h5 fw-semibold mb-1">Latest reviewer feedback</h2>
                  <p className="small text-body-secondary mb-0">
                    Snapshot of what is moving through the review loop right now.
                  </p>
                </div>
                <div className="card-body">
                  <div className="experience-list">
                    {records.map((record) => (
                      <div key={record.id} className="experience-list-item">
                        <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
                          <div>
                            <div className="fw-semibold">{record.title}</div>
                            <div className="small text-body-secondary">
                              {record.trainer} • Priority {record.priority}
                            </div>
                          </div>
                          <span
                            className={`badge rounded-pill ${
                              record.status === "approved"
                                ? "text-bg-success"
                                : record.status === "changes_requested"
                                  ? "text-bg-danger"
                                  : "text-bg-info"
                            }`}
                          >
                            {record.status.replaceAll("_", " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </PublicExperienceShell>

      <Modal
        show={Boolean(selectedRecord)}
        title={selectedRecord ? selectedRecord.title : "Review details"}
        onClose={() => setSelectedRecord(null)}
      >
        {selectedRecord ? (
          <div className="experience-list">
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Submitted by</div>
                <div className="fw-semibold">{selectedRecord.trainer}</div>
              </div>
            </div>
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Review focus</div>
                <div className="fw-semibold">
                  Validate positioning, pricing language, and objection handling flow.
                </div>
              </div>
            </div>
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Suggested reviewer note</div>
                <div className="fw-semibold">
                  Confirm all launch offers are regionalized before final publish.
                </div>
              </div>
            </div>
            <div className="d-flex gap-2 pt-2">
              <button
                className="btn btn-success"
                onClick={() => {
                  updateStatus(selectedRecord.id, "approved");
                  toast.success("Module approved.");
                  setSelectedRecord(null);
                }}
              >
                Approve module
              </button>
              <button
                className="btn btn-outline-danger"
                onClick={() => {
                  updateStatus(selectedRecord.id, "changes_requested");
                  toast.info("Trainer has been asked to revise this module.");
                  setSelectedRecord(null);
                }}
              >
                Send back for edits
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
};

export default ReviewerPanel;
