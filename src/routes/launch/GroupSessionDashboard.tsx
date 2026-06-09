import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { getAuthToken } from "../../helper/authSession";
import { controlGroupSession, getGroupLiveSnapshot } from "../../helper/groupSessionApi";
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
};
type Transcript = { traineeId: string; name: string; question: string; answer: string; askedAt: string };
type QueueEntry = { traineeId: string; name: string };
type Metrics = { invited: number; joined: number; connected: number; waiting: number; present: number; completed: number };
type Snapshot = {
  id: string;
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

// Admin live dashboard for an AI-managed group session. Reads the REST snapshot,
// subscribes to live deltas over the socket (admin-observer), and exposes the
// fallback controls (pause/resume/skip/end).
const GroupSessionDashboard = () => {
  const { gsId = "" } = useParams();
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

    const socket = connectGroupSocket({ token: getAuthToken(), gsId });
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

  if (error) {
    return <div className="container py-5 text-danger text-center">{error}</div>;
  }
  if (!snapshot) {
    return <div className="container py-5 text-center">Loading live dashboard…</div>;
  }

  const activeName =
    snapshot.attendees.find((a) => a.traineeId === snapshot.activeSpeakerId)?.name || "—";

  const m = snapshot.metrics || { invited: 0, joined: 0, connected: 0, waiting: 0, present: 0, completed: 0 };

  return (
    <div className="container-fluid py-3">
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
                    <th>Name</th><th>State</th><th>Conn</th><th>Joined</th><th>Active</th><th>Attend %</th><th>Hands</th><th>Q&apos;s</th>
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
                    </tr>
                  ))}
                  {!snapshot.attendees.length ? (
                    <tr><td colSpan={8} className="text-muted text-center py-3">No participants yet.</td></tr>
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
                  <div className="small fw-semibold">{t.name}</div>
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
