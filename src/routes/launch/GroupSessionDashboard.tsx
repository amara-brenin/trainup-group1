import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { withBase } from "../../helper/basePath";
import type { Socket } from "socket.io-client";
import { getAuthToken } from "../../helper/authSession";
import { jsPDF } from "jspdf";
import { controlGroupSession, getGroupLiveSnapshot, getGroupReport } from "../../helper/groupSessionApi";
import { connectGroupSocket } from "../../helper/groupSocket";

type Attendee = {
  traineeId: string;
  name: string;
  email: string;
  connected: boolean;
  attendanceState: string;
  rejoins: number;
  totalActiveMs: number;
  handRaises: number;
  questionsAsked: number;
  attendancePct: number;
  completionStatus: string;
  joinedAt: string | null;
  confirmTime: string | null;
  completionTime: string | null;
  proctoringRiskScore?: number;
  proctoringEventCount?: number;
};
type Transcript = { traineeId: string; name: string; question: string; answer: string; askedAt: string; questionType?: "voice" | "text" };
type QueueEntry = { traineeId: string; name: string };
type Metrics = { invited: number; joined: number; connected: number; waiting: number; present: number; completed: number };
type Snapshot = {
  id: string;
  trainingId: string;
  trainingTitle: string;
  lifecycle: string;
  phase: string;
  status: string;
  currentTopic: string;
  activeSpeakerId: string;
  queue: QueueEntry[];
  attendeeCount: number;
  capacity: number;
  metrics: Metrics;
  attendees: Attendee[];
  transcripts: Transcript[];
  startTime: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleTimeString() : "—");
const ATTENDANCE_BADGE: Record<string, string> = {
  registered: "bg-secondary",
  joined: "bg-info text-dark",
  waiting: "bg-warning text-dark",
  present: "bg-success",
  completed: "bg-primary",
};

const fmtMs = (ms: number) => {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};

// Feature 4: proctoring risk badge. 0–25 green · 26–50 yellow · 51–75 orange · 76–100 red.
const riskBadge = (score: number, events: number) => {
  const cls = score <= 25 ? "bg-success" : score <= 50 ? "bg-warning text-dark" : score <= 75 ? "text-dark" : "bg-danger";
  const style = score > 50 && score <= 75 ? { background: "#fd7e14" } : undefined;
  return (
    <span className={`badge ${cls}`} style={style} title={`${events} event${events === 1 ? "" : "s"}`}>
      {score} · {events}
    </span>
  );
};

// Admin live dashboard for an AI-managed group session. Reads the REST snapshot,
// subscribes to live deltas over the socket (admin-observer), and exposes the
// fallback controls (pause/resume/skip/end).
const GroupSessionDashboard = () => {
  const { gsId = "" } = useParams();
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await getGroupLiveSnapshot(gsId);
    if (!data.status) {
      setError(data.message || "Unable to load session.");
      return;
    }
    setSnapshot(data.data.session as unknown as Snapshot);
  }, [gsId]);

  useEffect(() => {
    if (!getAuthToken()) {
      setError("Sign in as admin/trainer to view the live dashboard.");
      return;
    }
    void refresh();

    const socket = connectGroupSocket({ token: getAuthToken(), gsId }, "admin");
    socketRef.current = socket;
    socket.on("queue:update", (p: { queue: QueueEntry[] }) =>
      setSnapshot((s) => (s ? { ...s, queue: p.queue || [] } : s)),
    );
    socket.on("attendance:update", (p: { count: number }) =>
      setSnapshot((s) => (s ? { ...s, attendeeCount: p.count } : s)),
    );
    const applyState = (p: { lifecycle?: string; phase?: string; status?: string; activeSpeakerId?: string }) =>
      setSnapshot((s) =>
        s
          ? {
              ...s,
              lifecycle: p.lifecycle ?? s.lifecycle,
              phase: p.phase ?? s.phase,
              status: p.status ?? s.status,
              activeSpeakerId: p.activeSpeakerId ?? s.activeSpeakerId,
            }
          : s,
      );
    socket.on("session:state", applyState);
    socket.on("session:sync", applyState);
    socket.on("session:attention", () => void refresh());
    socket.on("floor:granted", () => void refresh());
    socket.on("floor:released", () => setSnapshot((s) => (s ? { ...s, activeSpeakerId: "" } : s)));
    socket.on("qa:answer", () => void refresh());
    socket.on("session:ended", () => void refresh());

    // Fallback poll for richer metrics not pushed over the socket.
    const id = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearInterval(id);
      socket.disconnect();
    };
  }, [gsId, refresh]);

  const control = async (action: string) => {
    setBusy(true);
    const { data } = await controlGroupSession(gsId, action);
    setBusy(false);
    if (!data.status) {
      setError(data.message || "Action failed.");
      return;
    }
    void refresh();
  };

  // Phase 1: fetch the consolidated report JSON and render a PDF client-side
  // (jspdf is already a dependency — no backend PDF lib needed).
  const downloadReport = async () => {
    setBusy(true);
    const { data } = await getGroupReport(gsId);
    setBusy(false);
    if (!data.status || !data.data?.report) {
      setError(data.message || "Report is not available.");
      return;
    }
    const r = data.data.report;
    const s = r.sessionSummary;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    const width = doc.internal.pageSize.getWidth();
    const bottom = doc.internal.pageSize.getHeight() - margin;
    let y = margin;
    const line = (text: string, size = 10, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      for (const w of doc.splitTextToSize(String(text), width - margin * 2)) {
        if (y > bottom) { doc.addPage(); y = margin; }
        doc.text(w, margin, y);
        y += size + 4;
      }
    };
    const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

    line("Group Training — Consolidated Report", 16, true);
    y += 2;
    if (r.reportStatus === "live") {
      doc.setTextColor(180, 95, 6);
      line(
        "Live Session Snapshot — Attendance %, Completion %, Drop-Off Rate and Final Engagement Metrics are provisional and will be finalized when the session ends.",
        9,
        true,
      );
      doc.setTextColor(0, 0, 0);
      y += 2;
    }
    line(`${s.trainingName}  ·  Session ${s.sessionId}`, 11, true);
    line(`Date: ${fmt(s.date)}   Duration: ${s.durationMin} min`);
    line(`Invited ${s.invitedCount} · Joined ${s.joinedCount} · Completed ${s.completedCount} · Drop-off ${s.dropOffCount}`);
    line(`Avg attendance ${s.averageAttendancePct}% · Avg duration ${s.averageDurationMin} min · Questions ${s.totalQuestions} · Hand raises ${s.totalHandRaises}`);
    y += 8; line("Participants", 13, true);
    if (!r.participants.length) line("No participants recorded.");
    r.participants.forEach((p) => {
      const assess = p.assessmentScore != null ? ` | Assess:${p.assessmentScore}% ${p.assessmentPassFail || ""}` : "";
      line(`${p.name || "—"} | ${p.email || "—"} | ${p.attendancePct}% | ${p.completionStatus} | Q:${p.questionsAsked} | Hands:${p.handRaises} | ${p.durationMin}m${assess}`);
    });
    if (r.dataQuality.hasAssessmentData) {
      y += 8; line("Assessment", 13, true);
      line(`Submitted ${r.sessionSummary.assessmentSubmittedCount} · Passed ${r.sessionSummary.assessmentPassedCount} · Pass rate ${r.sessionSummary.assessmentPassRatePct}% · Avg score ${r.sessionSummary.averageAssessmentScore ?? "N/A"}%`);
    }
    if (r.dataQuality.hasProctoringData) {
      y += 8; line("Proctoring Summary", 13, true);
      line(`Avg risk ${r.sessionSummary.averageRiskScore} · Total events ${r.sessionSummary.totalProctoringEvents}`);
      r.participants
        .filter((p) => p.proctoringEventCount > 0 || p.proctoringRiskScore > 0)
        .forEach((p) => line(`${p.name || "—"} | risk ${p.proctoringRiskScore} | ${p.proctoringEventCount} event(s)`));
    }
    y += 8; line("Interactions", 13, true);
    if (!r.interactions.length) line("No questions asked.");
    r.interactions.forEach((it, i) => {
      const type = it.questionType ? `[${it.questionType}]` : "[N/A]";
      const rt = it.responseTimeSec != null ? ` (response ${it.responseTimeSec}s)` : "";
      line(`${i + 1}. ${type} ${it.askedBy || "—"}: ${it.question}${rt}`);
    });
    y += 8; line("Engagement", 13, true);
    line(`Most active: ${r.engagement.mostActiveParticipant} · Most questions: ${r.engagement.mostQuestionsAsked}`);
    line(`Highest attendance: ${r.engagement.highestAttendance ? `${r.engagement.highestAttendance.name} (${r.engagement.highestAttendance.pct}%)` : "—"}`);
    line(`Lowest attendance: ${r.engagement.lowestAttendance ? `${r.engagement.lowestAttendance.name} (${r.engagement.lowestAttendance.pct}%)` : "—"}`);
    line(`Drop-off rate: ${r.engagement.dropOffRatePct}% · Participation rate: ${r.engagement.participationRatePct}%`);
    doc.save(`group-report-${s.sessionId}.pdf`);
  };

  if (error) {
    return <div className="container py-5 text-danger text-center">{error}</div>;
  }
  if (!snapshot) {
    return <div className="container py-5 text-center">Loading live dashboard…</div>;
  }

  const activeName =
    snapshot.attendees.find((a) => a.traineeId === snapshot.activeSpeakerId)?.name || "—";

  const m = snapshot.metrics || { invited: 0, joined: 0, connected: 0, waiting: 0, present: 0, completed: 0 };
  // Report is "final" only once the session reaches a terminal lifecycle; until
  // then attendance/completion/drop-off in the report are provisional (Task 1).
  const reportIsLive = !["completed", "cancelled", "ended"].includes(snapshot.lifecycle);

  return (
    <div className="container-fluid py-3">
      {reportIsLive ? (
        <div className="alert alert-warning py-2 small mb-3" role="alert">
          <strong>Live Session Snapshot</strong> — Attendance %, Completion %, Drop-Off Rate and Final
          Engagement Metrics are provisional and will be finalized when the session ends.
        </div>
      ) : null}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <h5 className="mb-0">{snapshot.trainingTitle}</h5>
          <div className="text-muted small">
            Topic: {snapshot.currentTopic || "—"} · Started: {fmtTime(snapshot.startedAt)}
            {snapshot.endedAt ? ` · Ended: ${fmtTime(snapshot.endedAt)}` : ""}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="badge bg-dark text-uppercase">{snapshot.lifecycle}</span>
          {snapshot.lifecycle === "live" ? <span className="badge bg-info text-dark text-uppercase">{snapshot.phase}</span> : null}
          <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => control("pause")}>Pause</button>
          <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => control("resume")}>Resume</button>
          <button className="btn btn-sm btn-outline-warning" disabled={busy} onClick={() => control("skip-queue")}>Skip Speaker</button>
          <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => control("end")}>End</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void downloadReport()}>
            <i className="bi bi-file-earmark-pdf me-1" />Report (PDF)
          </button>
          {snapshot.trainingId ? (
            <button
              className="btn btn-sm btn-outline-info"
              onClick={() => navigate(withBase(`/training/${snapshot.trainingId}/analytics`))}
              title="View training-level analytics across all sessions"
            >
              <i className="bi bi-graph-up me-1" />View Analytics
            </button>
          ) : null}
        </div>
      </div>

      {/* Live monitoring metrics */}
      <div className="row g-2 mb-3">
        {[
          ["Invited", m.invited, "bi-envelope"],
          ["Joined", m.joined, "bi-box-arrow-in-right"],
          ["Waiting", m.waiting, "bi-hourglass-split"],
          ["Present", m.present, "bi-person-check"],
          ["Completed", m.completed, "bi-award"],
          ["In Queue", snapshot.queue.length, "bi-hand-index"],
          ["Now Speaking", activeName, "bi-mic"],
        ].map(([label, value, icon]) => (
          <div key={label as string} className="col-6 col-md-4 col-xl">
            <div className="card h-100">
              <div className="card-body py-2">
                <div className="text-primary mb-1"><i className={`bi ${icon}`} /></div>
                <div className="fs-5 fw-semibold">{value}</div>
                <div className="small text-body-secondary">{label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-7">
          <div className="card h-100">
            <div className="card-header fw-semibold">Participants</div>
            <div className="table-responsive">
              <table className="table table-sm mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Name</th><th>State</th><th>Conn</th><th>Joined</th><th>Active</th><th>Attend %</th><th>Hands</th><th>Q&apos;s</th><th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.attendees.map((a) => (
                    <tr key={a.traineeId}>
                      <td>{a.name}<div className="small text-muted">{a.email}</div></td>
                      <td>
                        <span className={`badge ${ATTENDANCE_BADGE[a.attendanceState] || "bg-secondary"} text-capitalize`}>
                          {a.attendanceState}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${a.connected ? "bg-success" : "bg-secondary"}`}>
                          {a.connected ? "On" : "Off"}
                        </span>
                      </td>
                      <td className="small">{fmtTime(a.joinedAt)}</td>
                      <td>{fmtMs(a.totalActiveMs)}</td>
                      <td>{a.attendancePct}%</td>
                      <td>{a.handRaises}</td>
                      <td>{a.questionsAsked}</td>
                      <td>{riskBadge(a.proctoringRiskScore || 0, a.proctoringEventCount || 0)}</td>
                    </tr>
                  ))}
                  {!snapshot.attendees.length ? (
                    <tr><td colSpan={9} className="text-muted text-center py-3">No participants yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="card mb-3">
            <div className="card-header fw-semibold">Question Queue</div>
            <ol className="list-group list-group-numbered list-group-flush">
              {snapshot.queue.map((q) => (
                <li key={q.traineeId} className="list-group-item">{q.name}</li>
              ))}
              {!snapshot.queue.length ? <li className="list-group-item text-muted">No hands raised.</li> : null}
            </ol>
          </div>
          <div className="card">
            <div className="card-header fw-semibold">Q&amp;A Transcript</div>
            <div className="list-group list-group-flush" style={{ maxHeight: 320, overflowY: "auto" }}>
              {[...snapshot.transcripts].reverse().map((t, i) => (
                <div key={i} className="list-group-item">
                  <div className="small fw-semibold d-flex align-items-center gap-2">
                    {t.name}
                    <span className={`badge ${t.questionType === "text" ? "bg-info text-dark" : "bg-secondary"}`}>
                      {t.questionType === "text" ? "💬 Text" : "🎤 Voice"}
                    </span>
                  </div>
                  <div className="small text-muted">Q: {t.question}</div>
                  <div className="small">A: {t.answer}</div>
                </div>
              ))}
              {!snapshot.transcripts.length ? <div className="list-group-item text-muted">No questions yet.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupSessionDashboard;
