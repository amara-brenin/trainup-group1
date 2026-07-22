import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import AxiosHelper from "../../helper/AxiosHelper";
import { Modal } from "../../component/common/Modal";
import SharedNavbar from "../../component/common/SharedNavbar";
import Image from "../../component/common/Image";
import Footer from "../../component/common/Footer";
import AvatarImage from "../../assets/images/avatar.png";
import { useAppSelector } from "../../app/hooks";
import { setLaunchAuthToken, getAuthToken } from "../../helper/authSession";
import type { TraineeSessionRecord, TraineeSessionReportPayload, TrainingAskTranscriptRecord } from "../../constant/interfaces";

type AssignedTrainingRecord = {
  id: string;
  title: string;
  type: string;
  audience: string;
  totalAttempts: number;
};

interface TraineeDashboardData extends TraineeSessionReportPayload {
  assignedTrainings: AssignedTrainingRecord[];
}

type TraineePanelProps = {
  sessionName?: string;
  sessionImage?: string;
  onSignOut: () => void;
};

const getRiskTone = (value: number) => {
  if (value >= 75) return "critical";
  if (value >= 40) return "warning";
  return "safe";
};

const getProgressPercent = (session: TraineeSessionRecord) => {
  if (typeof session.progressPercent === "number") {
    return Math.max(0, Math.min(100, session.progressPercent));
  }
  if (!session.totalSlides) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((session.slidesViewed / session.totalSlides) * 100)));
};

const dedupeAskTranscript = (entries: TrainingAskTranscriptRecord[] = []) => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const question = String(entry?.question || "").trim();
    const answer = String(entry?.answer || "").trim();
    const slideId = String(entry?.slideId || "").trim();
    const key = `${question.toLowerCase()}__${answer.toLowerCase()}__${slideId}`;
    if (!question || !answer || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
};

const getSessionReportFileName = (session: TraineeSessionRecord, traineeName: string) => {
  const baseName = `${traineeName || "trainee"}-${session.trainingTitle || "session"}-report`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${baseName || "session-report"}.pdf`;
};

const buildSessionReportPdf = (session: TraineeSessionRecord, trainee: any) => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const proctoringReport = session.proctoringReport || null;

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageWidth, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Session Report", margin, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${trainee.name || "Trainee"} | ${trainee.email || ""}`, margin, 23);

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(session.trainingTitle || "Training Session", margin, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Session ID: ${session.id}`, margin, 56);
  doc.text(`Status: ${session.status} | Started: ${formatDate(session.startedAt)} | Completed: ${formatDate(session.completedAt)}`, margin, 62);

  const metrics = [
    ["Time Spent", session.timeSpent],
    ["Slides Viewed", `${session.slidesViewed}/${session.totalSlides}`],
    ["Score", session.score !== null ? `${session.score}%` : "-"],
    ["Attention", proctoringReport ? `${proctoringReport.attentionScore}%` : "-"],
    ["Risk", proctoringReport ? `${proctoringReport.riskScore}%` : "-"],
  ];

  metrics.forEach(([label, value], index) => {
    const x = margin + index * ((contentWidth - 8) / 5 + 2);
    const width = (contentWidth - 8) / 5;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, 74, width, 25, 2, 2, "FD");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text(label, x + 3, 82);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(String(value), x + 3, 94);
    doc.setFont("helvetica", "normal");
  });

  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, 112, contentWidth, 32, 2, 2, "FD");
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Progress", margin + 4, 123);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${getProgressPercent(session)}% complete`, pageWidth - margin - 28, 123);
  doc.text(`Questions: ${session.correctAnswers ?? 0}/${session.totalQuestions ?? 0}`, margin + 4, 136);

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Proctoring Summary", margin, 160);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  if (proctoringReport) {
    doc.text(`Attention: ${proctoringReport.attentionLabel}`, margin, 168);
    doc.text(
      `Reading ${proctoringReport.eventCounts.reading} | Talking ${proctoringReport.eventCounts.talking} | Looking Away ${proctoringReport.eventCounts.lookingAway} | Tab Switch ${proctoringReport.eventCounts.tabSwitch}`,
      margin,
      176,
    );
  } else {
    doc.text("No proctoring snapshot was saved for this session.", margin, 168);
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Ask Mode Transcript", margin, 198);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  const transcriptEntries = dedupeAskTranscript(
    Array.isArray(session.askTranscripts) ? session.askTranscripts : session.askHistory,
  );
  const transcript = transcriptEntries.length
    ? transcriptEntries.flatMap((item, index) => [
      `Q${index + 1}: ${item.question}`,
      `Source: ${item.inputMode || "typed"} | STT: ${item.sttProvider || "-"} | Language: ${item.language || "-"} | Slide: ${item.slideId || "-"}`,
      `A: ${item.answer}`,
    ])
    : ["No Ask mode conversation happened in this session."];
  doc.text(doc.splitTextToSize(transcript.join("\n"), contentWidth), margin, 206);

  return doc;
};

const TraineePanel = ({ sessionName, sessionImage, onSignOut }: TraineePanelProps) => {
  const settings = useAppSelector((state) => state.settings);
  const [data, setData] = useState<TraineeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Two-level navigation state:
  const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(null);
  const [previewSessionId, setPreviewSessionId] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [confirmLaunchTrainingId, setConfirmLaunchTrainingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const response = await AxiosHelper.getData<TraineeDashboardData>("/trainee/dashboard");
      if (response.data.status) {
        setData(response.data.data);
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const activeSession = useMemo(
    () => data?.sessions.find((session) => session.id === previewSessionId) ?? null,
    [data?.sessions, previewSessionId],
  );

  const activeProctoringReport = activeSession?.proctoringReport || null;
  const activeRiskTone = getRiskTone(activeProctoringReport?.riskScore ?? 0);
  const activeAttentionTone = getRiskTone(100 - (activeProctoringReport?.attentionScore ?? 100));
  const activeAskTranscript = useMemo(
    () => activeSession
      ? dedupeAskTranscript(Array.isArray(activeSession.askTranscripts) ? activeSession.askTranscripts : activeSession.askHistory)
      : [],
    [activeSession],
  );

  const downloadSessionReport = () => {
    if (!activeSession || !data) return;
    const doc = buildSessionReportPdf(activeSession, data.trainee);
    doc.save(getSessionReportFileName(activeSession, sessionName || "trainee"));
  };

  const lightLogo = settings.logo || settings.favicon;

  const leftContent = (
    <div className="logo-topbar" style={{ display: 'flex', alignItems: 'center' }}>
      <span className="logo-lg d-flex align-items-center">
        <Image src={lightLogo} alt={settings.application_name} height={42} />
      </span>
    </div>
  );

  const userSlot = (
    <li className="dropdown">
      <button
        type="button"
        className={`app-user-menu-button dropdown-toggle arrow-none ${showUserMenu ? "show" : ""}`}
        onClick={() => setShowUserMenu((current) => !current)}
        aria-expanded={showUserMenu}
      >
        <Image src={sessionImage || AvatarImage} alt={sessionName} width={34} className="rounded-circle" />
        <span className="d-none d-lg-flex flex-column text-start">
          <strong>{sessionName || "Trainee"}</strong>
          <small>Trainee</small>
        </span>
      </button>

      <div className={`dropdown-menu dropdown-menu-end dropdown-menu-animated profile-dropdown ${showUserMenu ? "show" : ""}`}>
        <button
          type="button"
          className="dropdown-item dropdown-item-danger"
          onClick={() => {
            setShowUserMenu(false);
            onSignOut();
          }}
        >
          <i className="ri-logout-box-line fs-18 align-middle me-1" />
          <span>Logout</span>
        </button>
      </div>
    </li>
  );

  const renderTrainingsView = () => {
    if (!data) return null;
    return (
      <div className="card admin-reference-table-card">
        <div className="card-header border-bottom">
          <h5 className="mb-0">Your Assigned Trainings</h5>
        </div>
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr>
                  <th>Training Title</th>
                  <th>Type</th>
                  <th>Audience</th>
                  <th>Total Attempts</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!data.assignedTrainings || data.assignedTrainings.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="admin-empty-state">You have no assigned training modules yet.</div>
                    </td>
                  </tr>
                ) : (
                  data.assignedTrainings.map((training) => (
                    <tr key={training.id}>
                      <td className="fw-medium text-dark">{training.title}</td>
                      <td>
                        <span className="badge text-bg-light">{training.type || "General"}</span>
                      </td>
                      <td>{training.audience || "All"}</td>
                      <td>{training.totalAttempts}</td>
                      <td className="text-end">
                        {training.totalAttempts === 0 ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => setConfirmLaunchTrainingId(training.id)}
                          >
                            <i className="ri-play-circle-line me-1" />
                            Join
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => setSelectedTrainingId(training.id)}
                          >
                            <i className="ri-eye-line me-1" />
                            View Attempts
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderSessionsView = () => {
    if (!data || !selectedTrainingId) return null;
    const training = data.assignedTrainings.find((t) => t.id === selectedTrainingId);
    const sessions = data.sessions.filter((s) => s.trainingId === selectedTrainingId);

    return (
      <div className="card admin-reference-table-card">
        <div className="card-header border-bottom d-flex justify-content-between align-items-center">
          <div>
            <button
              type="button"
              className="btn btn-sm btn-link text-decoration-none p-0 me-3"
              onClick={() => setSelectedTrainingId(null)}
            >
              <i className="ri-arrow-left-line me-1" /> Back
            </button>
            <h5 className="d-inline mb-0">{training?.title} - Attempts</h5>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setConfirmLaunchTrainingId(selectedTrainingId)}
          >
            <i className="ri-add-line me-1" /> New Attempt
          </button>
        </div>
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Score</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-empty-state">No attempts recorded for this training yet.</div>
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <span
                          className={`badge ${
                            session.status === "completed"
                              ? "text-bg-success"
                              : session.status === "in-progress"
                                ? "text-bg-warning"
                                : "text-bg-secondary"
                          }`}
                        >
                          {session.status}
                        </span>
                      </td>
                      <td>{session.slidesViewed}/{session.totalSlides}</td>
                      <td>{session.score !== null ? `${session.score}%` : "-"}</td>
                      <td>{formatDate(session.startedAt)}</td>
                      <td>{formatDate(session.completedAt)}</td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => setPreviewSessionId(session.id)}
                        >
                          <i className="ri-file-chart-line me-1" />
                          Report
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{`
        html, body {
          background-color: var(--admin-page-bg, #f4f5f7) !important;
          background-image: none !important;
        }
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: var(--admin-page-bg, #f4f5f7);
        }
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
        html body .wrapper.trainee-no-sidebar .navbar-custom {
          left: 0 !important;
          margin-left: 0 !important;
          width: 100% !important;
        }
        html body .wrapper.trainee-no-sidebar .content-page {
          margin-left: 0 !important;
          width: 100% !important;
        }
        html body .wrapper.trainee-no-sidebar .footer {
          left: 0 !important;
          width: 100% !important;
        }
      `}</style>
      <div className="wrapper trainee-no-sidebar" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--admin-page-bg, #f4f5f7)', width: '100%' }}>
        <SharedNavbar
        leftContent={leftContent}
        userSlot={userSlot}
        usedCredits={0}
        totalCredits={0}
        showCredits={false}
        hideHamburger={true}
      />
      <div className="content-page" style={{ marginLeft: 0, padding: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="content" style={{ flex: 1 }}>
          <div className="container-fluid pt-4">
            {loading ? (
              <div className="text-center p-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : !data ? (
              <div className="text-center p-5 text-muted">Failed to load dashboard data.</div>
            ) : (
              <div className="row g-4">
                <div className="col-12">
                  <div className="card">
                    <div className="card-body">
                      <h5 className="card-title mb-4">Your Progress Summary</h5>
                      <div className="row text-center g-3">
                        <div className="col-sm-3 col-6">
                          <div className="p-3 border rounded">
                            <div className="fs-3 fw-bold text-primary">{data.assignedTrainings?.length || 0}</div>
                            <div className="text-muted small text-uppercase">Assigned</div>
                          </div>
                        </div>
                        <div className="col-sm-3 col-6">
                          <div className="p-3 border rounded">
                            <div className="fs-3 fw-bold text-success">{data.summary.completedSessions}</div>
                            <div className="text-muted small text-uppercase">Completed</div>
                          </div>
                        </div>
                        <div className="col-sm-3 col-6">
                          <div className="p-3 border rounded">
                            <div className="fs-3 fw-bold text-warning">{data.summary.inProgressSessions}</div>
                            <div className="text-muted small text-uppercase">In Progress</div>
                          </div>
                        </div>
                        <div className="col-sm-3 col-6">
                          <div className="p-3 border rounded">
                            <div className="fs-3 fw-bold text-info">{data.summary.averageScore ?? "-"}</div>
                            <div className="text-muted small text-uppercase">Avg Score</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-12">
                  {!selectedTrainingId ? renderTrainingsView() : renderSessionsView()}
                </div>
              </div>
            )}
          </div>
        </div>
        <Footer />
      </div>

      <Modal
        show={Boolean(activeSession)}
        title="Session Report"
        onClose={() => setPreviewSessionId("")}
        size="xl"
        centered
        scrollable
        dialogClassName="session-report-dialog"
        bodyClassName="session-report-modal-body"
        headerActions={
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-primary btn-sm" onClick={downloadSessionReport} disabled={!activeSession}>
              <i className="ri-download-2-line me-1" />
              Download Report
            </button>
          </div>
        }
      >
        {activeSession ? (
          <div className="training-session-report-page">
            <div className="training-session-report-header">
              <div className="training-session-report-kicker">Session Report</div>
              <div className="h4 mb-2">{activeSession.trainingTitle}</div>
              <div className="training-session-report-subtitle">
                Session ID: {activeSession.id} | Status: {activeSession.status}
              </div>
              <div className="training-session-report-subtitle">
                Started {formatDate(activeSession.startedAt)} | Completed {formatDate(activeSession.completedAt)}
              </div>
            </div>

            <div className="training-session-report">
              <div className="training-session-report-grid training-session-report-grid--hero">
                <div className="training-session-report-card">
                  <div className="small text-body-secondary">Time Spent</div>
                  <div className="training-session-report-value">{activeSession.timeSpent}</div>
                </div>
                <div className="training-session-report-card">
                  <div className="small text-body-secondary">Slides Viewed</div>
                  <div className="training-session-report-value">
                    {activeSession.slidesViewed}/{activeSession.totalSlides}
                  </div>
                </div>
                <div className="training-session-report-card">
                  <div className="small text-body-secondary">Score</div>
                  <div className="training-session-report-value">
                    {activeSession.score !== null ? `${activeSession.score}%` : "-"}
                  </div>
                </div>
                <div className={`training-session-report-card training-session-report-card--${activeAttentionTone}`}>
                  <div className="small text-body-secondary">Attention</div>
                  <div className="training-session-report-value">
                    {activeProctoringReport ? `${activeProctoringReport.attentionScore}%` : "-"}
                  </div>
                </div>
                <div className={`training-session-report-card training-session-report-card--${activeRiskTone}`}>
                  <div className="small text-body-secondary">Risk</div>
                  <div className="training-session-report-value">
                    {activeProctoringReport ? `${activeProctoringReport.riskScore}%` : "-"}
                  </div>
                </div>
              </div>

              <div className="training-session-report-grid">
                <div className="training-session-report-card training-session-report-card--timeline">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <strong>Progress</strong>
                    <span className="small text-body-secondary">{getProgressPercent(activeSession)}%</span>
                  </div>
                  <div className="training-session-report-progress">
                    <span style={{ width: `${getProgressPercent(activeSession)}%` }} />
                  </div>
                  <div className="small text-body-secondary mt-2">
                    Questions: {activeSession.correctAnswers ?? 0}/{activeSession.totalQuestions ?? 0}
                  </div>
                </div>

                <div className="training-session-report-card training-session-report-card--proctor">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <strong>Proctoring Summary</strong>
                    {activeProctoringReport ? (
                      <span className={`training-session-report-severity training-session-report-severity--${activeRiskTone}`}>
                        {activeProctoringReport.attentionLabel}
                      </span>
                    ) : null}
                  </div>
                  {activeProctoringReport ? (
                    <>
                      <div className="training-session-proctor-grid">
                        <div className="training-session-proctor-metric"><span>Reading</span><strong>{activeProctoringReport.eventCounts.reading}</strong></div>
                        <div className="training-session-proctor-metric"><span>Talking</span><strong>{activeProctoringReport.eventCounts.talking}</strong></div>
                        <div className="training-session-proctor-metric"><span>Looking Away</span><strong>{activeProctoringReport.eventCounts.lookingAway}</strong></div>
                        <div className="training-session-proctor-metric"><span>Tab Switch</span><strong>{activeProctoringReport.eventCounts.tabSwitch}</strong></div>
                      </div>
                      <div className="training-session-proctor-log">
                        {activeProctoringReport.events.length ? activeProctoringReport.events.slice(0, 6).map((item, index) => (
                          <div key={`${item.timestamp}-${index}`} className="training-session-proctor-log-item">
                            <span>{item.timestamp}</span>
                            <p>{item.message}</p>
                          </div>
                        )) : <div className="small text-body-secondary">No proctoring events were stored for this session.</div>}
                      </div>
                    </>
                  ) : (
                    <div className="small text-body-secondary">No proctoring snapshot was saved for this session.</div>
                  )}
                </div>

                <div className="training-session-report-card">
                  <strong className="d-block mb-3">Ask Mode Transcript</strong>
                  <div className="training-session-transcript">
                    {activeAskTranscript.length ? activeAskTranscript.map((item, index) => (
                      <div key={`${item.question}-${index}`} className="training-session-transcript-item">
                        <div className="fw-semibold mb-1">{item.question}</div>
                        <div className="small text-body-secondary mb-1">
                          Source: {item.inputMode || "typed"} | STT: {item.sttProvider || "-"} | Language: {item.language || "-"} | Slide: {item.slideId || "-"}
                        </div>
                        <div className="small text-body-secondary">{item.answer}</div>
                      </div>
                    )) : <div className="small text-body-secondary">No Ask mode conversation happened in this session.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Launch Confirmation Modal */}
      <Modal
        show={!!confirmLaunchTrainingId}
        onClose={() => setConfirmLaunchTrainingId(null)}
        title="Start Training"
      >
        <div className="modal-body">
          <p className="mb-0 fs-5 text-dark">Are you sure you want to start a new attempt for this training?</p>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-light"
            onClick={() => setConfirmLaunchTrainingId(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (confirmLaunchTrainingId) {
                setLaunchAuthToken(getAuthToken());
                window.open(`/slideshows/${confirmLaunchTrainingId}`, "_blank");
                setConfirmLaunchTrainingId(null);
              }
            }}
          >
            Start
          </button>
        </div>
      </Modal>
    </div>
    </>
  );
};

export default TraineePanel;
