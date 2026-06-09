import { useMemo, useState, type CSSProperties } from "react";
import { ErrorMessage, Field, Form, Formik } from "formik";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import * as Yup from "yup";
import { Modal } from "../../component/common/Modal";
import PublicExperienceShell from "../../component/common/PublicExperienceShell";
import { trainerTrainings } from "../../constant/demoExperiences";
import { clearPublicRoleSession, getPublicRoleSession } from "../../helper/publicRoleAuth";

type TrainingRecord = (typeof trainerTrainings)[number];
type TrainerTab = "dashboard" | "library" | "builder";
type BuilderFormValues = {
  title: string;
  audience: string;
  slides: number;
};

const builderInitialValues: BuilderFormValues = {
  title: "",
  audience: "",
  slides: 6,
};

const builderValidationSchema = Yup.object({
  title: Yup.string().min(4, "Use at least 4 characters.").required("Training title is required."),
  audience: Yup.string().required("Audience is required."),
  slides: Yup.number().min(3, "Minimum 3 slides.").max(30, "Keep it under 30 slides.").required("Slide count is required."),
});

const tabButtonClass = (active: boolean) =>
  `btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`;

const TrainerPanel = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TrainerTab>("dashboard");
  const [trainings, setTrainings] = useState<TrainingRecord[]>(trainerTrainings);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TrainingRecord["status"]>("all");
  const [sortBy, setSortBy] = useState<"recent" | "title" | "audience" | "slides">("recent");
  const [selectedTraining, setSelectedTraining] = useState<TrainingRecord | null>(null);
  const session = getPublicRoleSession("trainer");

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const filteredTrainings = useMemo(() => {
    const needle = query.toLowerCase();
    const filtered = trainings.filter(
      (training) =>
        (statusFilter === "all" ? true : training.status === statusFilter) &&
        (
          training.title.toLowerCase().includes(needle) ||
          training.audience.toLowerCase().includes(needle) ||
          training.trainer.toLowerCase().includes(needle)
        ),
    );

    return [...filtered].sort((left, right) => {
      if (sortBy === "title") {
        return left.title.localeCompare(right.title);
      }
      if (sortBy === "audience") {
        return left.audience.localeCompare(right.audience);
      }
      if (sortBy === "slides") {
        return right.slides - left.slides;
      }
      return right.submittedOn.localeCompare(left.submittedOn);
    });
  }, [query, sortBy, statusFilter, trainings]);

  const draftCount = trainings.filter((item) => item.status === "draft").length;
  const reviewCount = trainings.filter((item) => item.status === "review").length;
  const approvedCount = trainings.filter((item) => item.status === "approved").length;

  return (
    <>
      <PublicExperienceShell
        eyebrow="Content Trainer"
        title="Training authoring workspace"
        subtitle="Build learning modules, manage draft status, and prepare reviewer-ready content without touching the admin shell."
        badge={`${reviewCount} module${reviewCount === 1 ? "" : "s"} awaiting review`}
        badgeClassName="text-bg-warning"
        icon="bi bi-pencil-square"
        actions={
          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap w-100">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button className={tabButtonClass(activeTab === "dashboard")} onClick={() => setActiveTab("dashboard")}>
                Overview
              </button>
              <button className={tabButtonClass(activeTab === "library")} onClick={() => setActiveTab("library")}>
                Training Library
              </button>
              <button className={tabButtonClass(activeTab === "builder")} onClick={() => setActiveTab("builder")}>
                Create Draft
              </button>
            </div>

            <button
              className="btn btn-sm btn-light"
              onClick={() => {
                clearPublicRoleSession("trainer");
                navigate("/login", { replace: true });
              }}
            >
              Sign out
            </button>
          </div>
        }
      >
        {activeTab === "dashboard" ? (
          <>
            <div className="row g-3 mb-3">
              <div className="col-12 col-md-4">
                <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": "#3e60d5" } as CSSProperties}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="small text-body-secondary">Drafts in progress</div>
                      <div className="admin-stat-icon" aria-hidden="true"><i className="bi bi-pencil-square" /></div>
                    </div>
                    <div className="fs-2 fw-semibold">{draftCount}</div>
                    <p className="text-body-secondary mb-0">Continue content outlines and add slide notes before submission.</p>
                  </div>
                </div>
              </div>
              <div className="col-12 col-md-4">
                <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": "#ffc35a" } as CSSProperties}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="small text-body-secondary">Waiting for review</div>
                      <div className="admin-stat-icon" aria-hidden="true"><i className="bi bi-hourglass-split" /></div>
                    </div>
                    <div className="fs-2 fw-semibold">{reviewCount}</div>
                    <p className="text-body-secondary mb-0">Reviewer handoff is queued. Keep source assets and notes ready.</p>
                  </div>
                </div>
              </div>
              <div className="col-12 col-md-4">
                <div className="card admin-card-stat admin-stat-with-icon h-100" style={{ "--stat-color": "#47ad77" } as CSSProperties}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="small text-body-secondary">Approved modules</div>
                      <div className="admin-stat-icon" aria-hidden="true"><i className="bi bi-check2-circle" /></div>
                    </div>
                    <div className="fs-2 fw-semibold">{approvedCount}</div>
                    <p className="text-body-secondary mb-0">These modules are ready to publish into the employee learning flow.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12 col-xl-7">
                <div className="card h-100">
                  <div className="card-header bg-transparent border-0 pb-0">
                    <h2 className="h5 fw-semibold mb-1">Submission pipeline</h2>
                    <p className="small text-body-secondary mb-0">
                      Current training assets across draft, review, and approved states.
                    </p>
                  </div>
                  <div className="card-body">
                    <div className="experience-list">
                      {trainings.map((training) => (
                        <button
                          key={training.id}
                          className="experience-list-item text-start"
                          onClick={() => setSelectedTraining(training)}
                        >
                          <div>
                            <div className="fw-semibold">{training.title}</div>
                            <div className="small text-body-secondary">
                              {training.audience} • {training.slides} slides
                            </div>
                          </div>
                          <span
                            className={`badge rounded-pill ${
                              training.status === "approved"
                                ? "text-bg-success"
                                : training.status === "review"
                                  ? "text-bg-warning"
                                  : "text-bg-secondary"
                            }`}
                          >
                            {training.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-xl-5">
                <div className="card h-100">
                  <div className="card-header bg-transparent border-0 pb-0">
                    <h2 className="h5 fw-semibold mb-1">Trainer checklist</h2>
                    <p className="small text-body-secondary mb-0">
                      Keep these assets ready before sending a module to review.
                    </p>
                  </div>
                  <div className="card-body">
                    <div className="experience-list">
                      {[
                        "Align launch messaging with current Samsung retail script.",
                        "Attach slide-wise talking points for store associates.",
                        "Validate device names, offers, and Care+ references.",
                        "Mark objection-handling slides that need reviewer attention.",
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
            </div>
          </>
        ) : null}

        {activeTab === "library" ? (
          <>
            <div className="admin-reference-toolbar">
              <div className="admin-toolbar-copy">
                <h2 className="h5 fw-semibold mb-1">Training library</h2>
                <p className="small text-body-secondary mb-0">
                  Search authored modules, then inspect status before reviewer handoff.
                </p>
              </div>
              <div className="admin-filter-row w-100">
                <div className="admin-filter-controls">
                  <div className="position-relative flex-grow-1">
                    <i className="bi bi-search position-absolute top-50 start-0 translate-middle-y ms-3 text-body-secondary" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="form-control ps-5"
                      placeholder="Search title, audience, or trainer"
                    />
                  </div>
                  <select className="form-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TrainingRecord["status"])}>
                    <option value="all">All status</option>
                    <option value="draft">Draft</option>
                    <option value="review">Review</option>
                    <option value="approved">Approved</option>
                  </select>
                  <select className="form-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as "recent" | "title" | "audience" | "slides")}>
                    <option value="recent">Sort by recent</option>
                    <option value="title">Sort by title</option>
                    <option value="audience">Sort by audience</option>
                    <option value="slides">Sort by slide count</option>
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
                      <th>Audience</th>
                      <th>Trainer</th>
                      <th>Slides</th>
                      <th>Status</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrainings.length ? (
                      filteredTrainings.map((training) => (
                        <tr key={training.id}>
                          <td>
                            <div className="fw-semibold">{training.title}</div>
                            <div className="small text-body-secondary">{training.submittedOn}</div>
                          </td>
                          <td>{training.audience}</td>
                          <td>{training.trainer}</td>
                          <td>{training.slides}</td>
                          <td>
                            <span
                              className={`badge rounded-pill ${
                                training.status === "approved"
                                  ? "text-bg-success"
                                  : training.status === "review"
                                    ? "text-bg-warning"
                                    : "text-bg-secondary"
                              }`}
                            >
                              {training.status}
                            </span>
                          </td>
                          <td className="text-end">
                            <button className="btn btn-sm btn-outline-primary" onClick={() => setSelectedTraining(training)}>
                              Preview
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <div className="admin-empty-state">No training modules matched this search.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
            </div>
          </div>
          </>
        ) : null}

        {activeTab === "builder" ? (
          <div className="row g-3">
            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-transparent border-0 pb-0">
                  <h2 className="h5 fw-semibold mb-1">Create new draft</h2>
                  <p className="small text-body-secondary mb-0">
                    Start with a concise module title and target audience, then move it into the review pipeline.
                  </p>
                </div>
                <div className="card-body">
                  <Formik
                    initialValues={builderInitialValues}
                    validationSchema={builderValidationSchema}
                    onSubmit={(values, { resetForm, setSubmitting }) => {
                      const nextId = `T${String(trainings.length + 1).padStart(3, "0")}`;

                      setTrainings((current) => [
                        {
                          id: nextId,
                          title: values.title,
                          status: "draft",
                          slides: Number(values.slides),
                          trainer: "Rohan Mehta",
                          audience: values.audience,
                          submittedOn: "04 Apr 2026",
                        },
                        ...current,
                      ]);

                      toast.success("New trainer draft created.");
                      resetForm();
                      setSubmitting(false);
                      setActiveTab("library");
                    }}
                  >
                    {({ isSubmitting }) => (
                      <Form>
                        <div className="mb-3">
                          <label htmlFor="title" className="form-label">
                            Module title
                          </label>
                          <Field id="title" name="title" className="form-control" placeholder="Galaxy AI demo script" />
                          <ErrorMessage name="title" component="small" className="text-danger" />
                        </div>

                        <div className="mb-3">
                          <label htmlFor="audience" className="form-label">
                            Target audience
                          </label>
                          <Field id="audience" name="audience" className="form-control" placeholder="Retail sales teams" />
                          <ErrorMessage name="audience" component="small" className="text-danger" />
                        </div>

                        <div className="mb-4">
                          <label htmlFor="slides" className="form-label">
                            Estimated slides
                          </label>
                          <Field id="slides" name="slides" type="number" className="form-control" min="3" max="30" />
                          <ErrorMessage name="slides" component="small" className="text-danger" />
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                          {isSubmitting ? "Creating..." : "Create Draft"}
                        </button>
                      </Form>
                    )}
                  </Formik>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-transparent border-0 pb-0">
                  <h2 className="h5 fw-semibold mb-1">Recommended structure</h2>
                  <p className="small text-body-secondary mb-0">
                    Keep the training flow tight so reviewers can approve quickly.
                  </p>
                </div>
                <div className="card-body">
                  <div className="experience-list">
                    {[
                      "Launch context and product story",
                      "Feature-to-benefit conversion for field teams",
                      "Handling objections and offer positioning",
                      "Knowledge check or talk-track recap",
                    ].map((step, index) => (
                      <div key={step} className="experience-list-item">
                        <div className="d-flex align-items-center gap-3">
                          <span className="badge text-bg-dark rounded-pill">{index + 1}</span>
                          <span>{step}</span>
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
        show={Boolean(selectedTraining)}
        title={selectedTraining ? selectedTraining.title : "Training preview"}
        onClose={() => setSelectedTraining(null)}
      >
        {selectedTraining ? (
          <div className="experience-list">
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Audience</div>
                <div className="fw-semibold">{selectedTraining.audience}</div>
              </div>
            </div>
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Trainer</div>
                <div className="fw-semibold">{selectedTraining.trainer}</div>
              </div>
            </div>
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Slides and timeline</div>
                <div className="fw-semibold">
                  {selectedTraining.slides} slides • Submitted {selectedTraining.submittedOn}
                </div>
              </div>
            </div>
            <div className="experience-list-item">
              <div>
                <div className="small text-body-secondary mb-1">Current status</div>
                <div className="fw-semibold text-capitalize">{selectedTraining.status}</div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
};

export default TrainerPanel;
