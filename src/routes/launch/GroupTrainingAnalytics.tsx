import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { jsPDF } from "jspdf";
import { getTrainingAnalytics, type TrainingAnalytics, type TrainingAnalyticsTrend } from "../../helper/groupSessionApi";

// ---- Lightweight inline-SVG charts (no chart-lib dependency) ----
const W = 460;
const H = 160;
const PAD = 28;

const niceMax = (vals: number[], floor = 10) => {
  const m = Math.max(floor, ...vals, 0);
  return Math.ceil(m / 10) * 10 || floor;
};

const LineChart = ({ values, color, max }: { values: number[]; color: string; max: number }) => {
  if (!values.length) return <div className="text-secondary small">No data.</div>;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = PAD + i * step;
    const y = PAD + innerH - (Math.max(0, Math.min(max, v)) / max) * innerH;
    return [x, y] as const;
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#444" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#444" strokeWidth={1} />
      <text x={PAD - 4} y={PAD + 4} fill="#888" fontSize="9" textAnchor="end">{max}</text>
      <text x={PAD - 4} y={H - PAD} fill="#888" fontSize="9" textAnchor="end">0</text>
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill={color} />)}
    </svg>
  );
};

const BarChart = ({ values, color, max }: { values: number[]; color: string; max: number }) => {
  if (!values.length) return <div className="text-secondary small">No data.</div>;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const bw = innerW / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#444" strokeWidth={1} />
      <text x={PAD - 4} y={PAD + 4} fill="#888" fontSize="9" textAnchor="end">{max}</text>
      {values.map((v, i) => {
        const h = (Math.max(0, Math.min(max, v)) / max) * innerH;
        return <rect key={i} x={PAD + i * bw + bw * 0.15} y={H - PAD - h} width={bw * 0.7} height={h} fill={color} rx={2} />;
      })}
    </svg>
  );
};

const Donut = ({ voice, text }: { voice: number; text: number }) => {
  const total = voice + text;
  if (!total) return <div className="text-secondary small">No questions.</div>;
  const r = 52; const c = 2 * Math.PI * r; const cx = 70; const cy = 70;
  const voiceLen = (voice / total) * c;
  return (
    <svg viewBox="0 0 140 140" style={{ width: 140, height: 140 }} role="img">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0d6efd" strokeWidth={16}
        strokeDasharray={`${voiceLen} ${c - voiceLen}`} transform={`rotate(-90 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0dcaf0" strokeWidth={16}
        strokeDasharray={`${c - voiceLen} ${voiceLen}`} strokeDashoffset={-voiceLen} transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy} fill="#fff" fontSize="13" textAnchor="middle" dominantBaseline="middle">{total} Q</text>
    </svg>
  );
};

// This page is always dark by design (the wrapper below is hard-coded to
// #0b1220 regardless of the app's light/dark toggle). design-system.css has
// an unconditional `.card { background: ... !important }` rule that beats
// even inline styles, so in light mode it repaints these cards white —
// leaving the (still-forced) white text unreadable. ".gta-card.card" has
// higher specificity than ".card" alone, so it wins over that rule even
// though both use !important — see the <style> block in the page wrapper.
const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="col-12 col-lg-6">
    <div className="card gta-card h-100 text-white"><div className="card-body">
      <div className="fw-semibold mb-2">{title}</div>{children}
    </div></div>
  </div>
);

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

const GroupTrainingAnalytics = () => {
  const { trainingId = "" } = useParams();
  const [data, setData] = useState<TrainingAnalytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await getTrainingAnalytics(trainingId);
      if (res.data.status && res.data.data?.analytics) setData(res.data.data.analytics);
      else setError(res.data.message || "Unable to load training analytics.");
    })();
  }, [trainingId]);

  // Charts read chronologically (endpoint returns newest-first).
  const trend = useMemo<TrainingAnalyticsTrend[]>(() => (data ? [...data.sessionTrend].reverse() : []), [data]);

  if (error) return <div className="container py-5 text-danger text-center">{error}</div>;
  if (!data) return <div className="container py-5 text-center">Loading training analytics…</div>;

  const attendance = trend.map((t) => t.attendancePct);
  const questions = trend.map((t) => t.questionsAsked);
  const passRates = trend.map((t) => t.assessmentPassRate);
  const risks = trend.map((t) => t.riskScore);

  const downloadPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40; const width = doc.internal.pageSize.getWidth(); const bottom = doc.internal.pageSize.getHeight() - margin;
    let y = margin;
    const line = (text: string, size = 10, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
      for (const w of doc.splitTextToSize(String(text), width - margin * 2)) {
        if (y > bottom) { doc.addPage(); y = margin; }
        doc.text(w, margin, y); y += size + 4;
      }
    };
    line("Group Training — Analytics", 16, true); y += 2;
    line(`${data.trainingName}  ·  ${data.trainingId}`, 11, true);
    y += 6; line("Training Summary", 13, true);
    line(`Sessions ${data.totalSessions} (final ${data.completedSessions} · live ${data.liveSessions})`);
    line(`Invited ${data.totalInvited} · Joined ${data.totalJoined} · Completed ${data.totalCompleted}`);
    y += 6; line("Attendance Analytics", 13, true);
    line(`Avg attendance ${data.avgAttendancePct}% · Avg session duration ${data.avgSessionDuration} min`);
    y += 6; line("Question Analytics", 13, true);
    line(`Total ${data.totalQuestions} · Voice ${data.totalVoiceQuestions} · Text ${data.totalTextQuestions} · Text ratio ${Math.round(data.textQuestionRatio * 100)}% · Avg/session ${data.avgQuestionsPerSession}`);
    y += 6; line("Assessment Analytics", 13, true);
    line(`Avg score ${data.avgAssessmentScore ?? "N/A"}% · Pass rate ${data.assessmentPassRate}%`);
    y += 6; line("Proctoring Analytics", 13, true);
    line(`Avg risk ${data.avgRiskScore} · Total events ${data.totalProctoringEvents}`);
    y += 6; line("Session Trend", 13, true);
    line("Date | Joined | Attend% | Questions | Pass% | Risk | Status", 9, true);
    data.sessionTrend.forEach((t) =>
      line(`${fmtDate(t.sessionDate)} | ${t.joinedCount} | ${t.attendancePct}% | ${t.questionsAsked} | ${t.assessmentPassRate}% | ${t.riskScore} | ${t.reportStatus}`, 9));
    doc.save(`training-analytics-${data.trainingId}.pdf`);
  };

  const kpis: Array<[string, string]> = [
    ["Total Sessions", String(data.totalSessions)],
    ["Avg Attendance", `${data.avgAttendancePct}%`],
    ["Assessment Pass", `${data.assessmentPassRate}%`],
    ["Avg Risk Score", String(data.avgRiskScore)],
    ["Total Questions", String(data.totalQuestions)],
    ["Voice/Text", `${data.totalVoiceQuestions}/${data.totalTextQuestions}`],
  ];

  return (
    <div className="container-fluid py-3 text-white" style={{ background: "#0b1220", minHeight: "100vh" }}>
      <style>{`
        .gta-card.card {
          background: #13203a !important;
          border-color: #2c3e63 !important;
          color: #fff !important;
        }
        /* The Session Trend table inherits design-system.css's light-theme
           text/header colors regardless of this page's forced dark cards —
           override both so rows stay readable in light theme too. */
        .gta-card .table-responsive {
          background: transparent !important;
        }
        .gta-card table.table-dark thead th {
          background: #1b2c52 !important;
          color: #cdd7ee !important;
          border-color: #2c3e63 !important;
        }
        .gta-card table.table-dark tbody td {
          color: #fff !important;
          border-color: #2c3e63 !important;
        }
      `}</style>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <h5 className="mb-0">{data.trainingName || "Group Training"} — Analytics</h5>
          <div className="text-secondary small">{data.completedSessions} final · {data.liveSessions} live session(s)</div>
        </div>
        <button className="btn btn-sm btn-primary" onClick={downloadPdf}>
          <i className="bi bi-file-earmark-pdf me-1" />Analytics (PDF)
        </button>
      </div>

      <div className="row g-2 mb-3">
        {kpis.map(([label, value]) => (
          <div key={label} className="col-6 col-md-4 col-xl-2">
            <div className="card gta-card h-100 text-white"><div className="card-body py-2">
              <div className="fs-5 fw-semibold">{value}</div>
              <div className="small text-secondary">{label}</div>
            </div></div>
          </div>
        ))}
      </div>

      <div className="row g-3 mb-3">
        <ChartCard title="Attendance Trend (%)"><LineChart values={attendance} color="#198754" max={100} /></ChartCard>
        <ChartCard title="Questions Per Session"><BarChart values={questions} color="#ff6200" max={niceMax(questions)} /></ChartCard>
        <ChartCard title="Assessment Pass Rate Trend (%)"><LineChart values={passRates} color="#0d6efd" max={100} /></ChartCard>
        <ChartCard title="Risk Score Trend"><LineChart values={risks} color="#dc3545" max={100} /></ChartCard>
        <ChartCard title="Voice vs Text Questions">
          <div className="d-flex align-items-center gap-3">
            <Donut voice={data.totalVoiceQuestions} text={data.totalTextQuestions} />
            <div className="small">
              <div><span style={{ color: "#0d6efd" }}>●</span> Voice: {data.totalVoiceQuestions}</div>
              <div><span style={{ color: "#0dcaf0" }}>●</span> Text: {data.totalTextQuestions}</div>
              <div className="text-secondary mt-1">Text ratio {Math.round(data.textQuestionRatio * 100)}%</div>
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="card gta-card text-white">
        <div className="card-header fw-semibold">Session Trend</div>
        <div className="table-responsive">
          <table className="table table-sm table-dark mb-0 align-middle">
            <thead>
              <tr><th>Date</th><th>Joined</th><th>Attendance %</th><th>Questions</th><th>Assessment Pass %</th><th>Risk</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.sessionTrend.map((t) => (
                <tr key={t.sessionId}>
                  <td className="small">{fmtDate(t.sessionDate)}</td>
                  <td>{t.joinedCount}</td>
                  <td>{t.attendancePct}%</td>
                  <td>{t.questionsAsked}</td>
                  <td>{t.assessmentPassRate}%</td>
                  <td>{t.riskScore}</td>
                  <td><span className={`badge ${t.reportStatus === "final" ? "bg-success" : "bg-warning text-dark"}`}>{t.reportStatus}</span></td>
                </tr>
              ))}
              {!data.sessionTrend.length ? (
                <tr><td colSpan={7} className="text-secondary text-center py-3">No sessions yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default GroupTrainingAnalytics;
