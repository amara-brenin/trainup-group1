import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Modal } from "../../component/common/Modal";
import PageShell from "../../component/common/PageShell";
import type { TraineeSessionRecord, TraineeSessionReportPayload, TrainingAskTranscriptRecord } from "../../constant/interfaces";
import AxiosHelper from "../../helper/AxiosHelper";

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

    if (!question || !answer || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const formatDate = (value?: string | null) => value || "-";
const getSessionReportFileName = (session: TraineeSessionRecord, traineeName: string) => {
  const baseName = `${traineeName || "trainee"}-${session.trainingTitle || "session"}-report`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${baseName || "session-report"}.pdf`;
};

const buildSessionReportPdf = (session: TraineeSessionRecord, trainee: TraineeSessionReportPayload["trainee"]) => {
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
  doc.text(`${trainee.name} | ${trainee.email}`, margin, 23);

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

const TraineeReport = () => {
  const navigate = useNavigate();
  const { traineeId = "", sessionId = "" } = useParams();
  const [data, setData] = useState<TraineeSessionReportPayload | null>(null);
  const [previewSessionId, setPreviewSessionId] = useState("");

  const fetchReport = useCallback(async () => {
    const response = await AxiosHelper.getData<TraineeSessionReportPayload>(`/trainees/${traineeId}/sessions`);
    if (response.data.status) {
      setData(response.data.data);
    }
  }, [traineeId]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const activeSession = useMemo(
    () => data?.sessions.find((session) => session.id === (previewSessionId || sessionId)) ?? null,
    [data?.sessions, previewSessionId, sessionId],
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

  const reopenSessionAttempt = async () => {
    if (!activeSession) {
      return;
    }

    try {
      const response = await AxiosHelper.postData(
        `/trainees/${traineeId}/sessions/${activeSession.trainingId}/${activeSession.id}/reopen`,
        {},
      );

      if (!response.data.status) {
        throw new Error(response.data.message || "Unable to reopen this attempt.");
      }

      toast.success("Attempt reopened for this trainee.");
      await fetchReport();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reopen this attempt.");
    }
  };

  const closeReportPreview = () => {
    setPreviewSessionId("");
    if (sessionId) {
      navigate(`/trainees/${traineeId}/report`);
    }
  };

  const downloadSessionReport = () => {
    if (!activeSession || !data) {
      return;
    }

    buildSessionReportPdf(activeSession, data.trainee).save(getSessionReportFileName(activeSession, data.trainee.name));
  };

  if (!data) {
    return (
      <PageShell>
        <div className="card app-loading-table">
          <div className="card-body p-4">
            <span className="ds-skeleton app-loading-line is-wide" />
            <div className="app-loading-table-lines">
              <span className="ds-skeleton app-loading-line" />
              <span className="ds-skeleton app-loading-line" />
              <span className="ds-skeleton app-loading-line" />
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="role-permission-hero mb-3">
        <div className="role-permission-hero-main">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navigate("/trainees")}
          >
            <i className="ri-arrow-left-line me-1" />
            Back
          </button>
          <div>
            <div className="role-permission-title">
              Session Report for <span>{data.trainee.name}</span>
            </div>
            <p className="text-body-secondary mb-0">{data.trainee.email}</p>
          </div>
        </div>
      </div>

      <div className="training-session-report-grid training-session-report-grid--hero mb-3">
        <div className="training-session-report-card">
          <div className="small text-body-secondary">Total Sessions</div>
          <div className="training-session-report-value">{data.summary.totalSessions}</div>
        </div>
        <div className="training-session-report-card">
          <div className="small text-body-secondary">Completed</div>
          <div className="training-session-report-value">{data.summary.completedSessions}</div>
        </div>
        <div className="training-session-report-card">
          <div className="small text-body-secondary">In Progress</div>
          <div className="training-session-report-value">{data.summary.inProgressSessions}</div>
        </div>
        <div className="training-session-report-card">
          <div className="small text-body-secondary">Not Started</div>
          <div className="training-session-report-value">{data.summary.notStartedSessions}</div>
        </div>
        <div className="training-session-report-card">
          <div className="small text-body-secondary">Avg Score</div>
          <div className="training-session-report-value">
            {data.summary.averageScore !== null ? `${data.summary.averageScore}%` : "-"}
          </div>
        </div>
      </div>

      <div className="card admin-reference-table-card mb-3">
        <div className="card-body">
          <div className="admin-reference-table-wrapper">
            <table className="table table-bordered align-middle admin-reference-table mb-0">
              <thead>
                <tr>
                  <th>Training</th>
                  <th>Status</th>
                  <th>Slides</th>
                  <th>Score</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.length ? (
                  data.sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <div className="fw-semibold">{session.trainingTitle}</div>
                        <div className="small text-body-secondary">
                          {[session.trainingType, session.trainingAudience].filter(Boolean).join(" | ") || "Training session"}
                        </div>
                      </td>
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
                      <td>
                        <button
                          type="button"
                          className={`btn btn-sm ${activeSession?.id === session.id ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => setPreviewSessionId(session.id)}
                        >
                          <i className="ri-file-chart-line me-1" />
                          Report
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="admin-empty-state">No attended sessions found for this trainee.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        show={Boolean(activeSession)}
        title="Session Report"
        onClose={closeReportPreview}
        size="xl"
        centered
        scrollable
        dialogClassName="session-report-dialog"
        bodyClassName="session-report-modal-body"
        headerActions={
          <div className="d-flex gap-2 flex-wrap">
            {activeSession?.status === "completed" ? (
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={reopenSessionAttempt}>
                <i className="ri-refresh-line me-1" />
                Reopen Attempt
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={downloadSessionReport} disabled={!activeSession}>
              <i className="ri-download-2-line me-1" />
              Report
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
    </PageShell>
  );
};

export default TraineeReport;
