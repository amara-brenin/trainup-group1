// Feature 2: server-authoritative scoring for end-of-training assessments.
// Mirrors the One-on-One scorer semantics (src/component/training-workspace/
// TrainingSlideForm.tsx + trainingQuestions.ts), ported server-side so client
// scores are never trusted.
//
// A checkpoint is "scoreable" only when it carries an answer key:
//   - objective      → expectedAnswer (exact, case-insensitive)
//   - multi_select   → options ∩ keywordMatches (set equality, case-insensitive)
//   - subjective /   → keywordMatches (answer must contain ALL keywords) OR,
//     text_area         if none, expectedAnswer (exact, case-insensitive)
// Unscoreable checkpoints (free text with no key) return null and are excluded
// from the denominator, so the score reflects only gradeable questions.

const norm = (v) => String(v ?? "").trim().toLowerCase();
const normArr = (v) =>
  (Array.isArray(v) ? v : [v])
    .map(norm)
    .filter(Boolean)
    .sort();

// Returns true | false | null (null = not scoreable).
const scoreCheckpoint = (checkpoint, response) => {
  const type = String(checkpoint?.questionType || "subjective");
  const expected = String(checkpoint?.expectedAnswer || "").trim();
  const keywords = Array.isArray(checkpoint?.keywordMatches) ? checkpoint.keywordMatches.filter(Boolean) : [];

  if (type === "objective") {
    if (!expected) return null;
    return norm(response) === norm(expected);
  }

  if (type === "multi_select") {
    const options = Array.isArray(checkpoint?.options) ? checkpoint.options : [];
    const correct = options.filter((o) => keywords.includes(o));
    if (!correct.length) return null;
    return JSON.stringify(normArr(response)) === JSON.stringify(normArr(correct));
  }

  // subjective | text_area
  if (keywords.length) {
    const value = norm(response);
    return keywords.every((k) => value.includes(norm(k)));
  }
  if (expected) {
    return norm(response) === norm(expected);
  }
  return null;
};

// Grades a full submission against the (snapshot) checkpoints.
// answersByCheckpointId: { [checkpointId]: response }
// Returns { score (0-100|null), correct, scoreable, total, passFail, gradedAnswers[] }
const gradeAssessment = (checkpoints, answersByCheckpointId, passPct) => {
  const list = Array.isArray(checkpoints) ? checkpoints : [];
  const answers = answersByCheckpointId && typeof answersByCheckpointId === "object" ? answersByCheckpointId : {};
  let correct = 0;
  let scoreable = 0;
  const gradedAnswers = list.map((cp) => {
    const response = answers[cp.id];
    const result = scoreCheckpoint(cp, response);
    if (result !== null) {
      scoreable += 1;
      if (result) correct += 1;
    }
    return { checkpointId: cp.id, response: response ?? null, correct: result };
  });
  const score = scoreable > 0 ? Math.round((correct / scoreable) * 100) : null;
  const threshold = Number.isFinite(Number(passPct)) ? Number(passPct) : 60;
  // No scoreable questions → cannot fail; treat as pass (record-only).
  const passFail = score === null ? "pass" : score >= threshold ? "pass" : "fail";
  return { score, correct, scoreable, total: list.length, passFail, gradedAnswers };
};

// Single source of truth for attendee completionStatus (used by endSession AND
// the assessment-submit endpoint so they never diverge).
//   - requireAssessmentPass=false OR no assessment → attendance-only.
//   - requireAssessmentPass=true + assessment exists:
//       not submitted → "assessment-pending"
//       submitted      → completed iff attendancePass AND assessment passed.
const resolveCompletionStatus = ({ attendancePass, requireAssessmentPass, hasAssessment, assessment }) => {
  if (!requireAssessmentPass || !hasAssessment) {
    return attendancePass ? "completed" : "incomplete";
  }
  if (!assessment?.submitted) return "assessment-pending";
  const assessmentPass = assessment.passFail === "pass";
  return attendancePass && assessmentPass ? "completed" : "incomplete";
};

// Pure builder for the immutable snapshot from a training payload + session
// config (no DB access). Filters to end_of_training checkpoints + answer keys.
const buildAssessmentSnapshot = (training, config) => {
  const all = Array.isArray(training?.payload?.questionCheckpoints) ? training.payload.questionCheckpoints : [];
  const endQuestions = all.filter((c) => c?.placementMode === "end_of_training");
  const passPct = Number(config?.assessment?.passPct ?? 60) || 60;
  return {
    capturedAt: new Date(),
    passPct,
    checkpoints: endQuestions.map((c) => ({
      id: c.id,
      prompt: c.prompt || c.title || "",
      questionType: c.questionType || "subjective",
      options: Array.isArray(c.options) ? c.options : [],
      expectedAnswer: c.expectedAnswer || "",
      keywordMatches: Array.isArray(c.keywordMatches) ? c.keywordMatches : [],
    })),
  };
};

// Public (answer-key-stripped) view of snapshot checkpoints for the trainee.
const publicCheckpoints = (checkpoints) =>
  (Array.isArray(checkpoints) ? checkpoints : []).map((c) => ({
    id: c.id,
    prompt: c.prompt,
    questionType: c.questionType,
    options: Array.isArray(c.options) ? c.options : [],
  }));

module.exports = {
  scoreCheckpoint,
  gradeAssessment,
  resolveCompletionStatus,
  buildAssessmentSnapshot,
  publicCheckpoints,
};
