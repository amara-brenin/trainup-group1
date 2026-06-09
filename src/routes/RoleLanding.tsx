import { Link } from "react-router-dom";

const cards = [
  {
    title: "Content Trainer",
    subtitle: "Create drafts, manage training modules, and submit content for review.",
    to: "/login",
    icon: "ri-edit-box-line",
    button: "Open Trainer Panel",
  },
  {
    title: "Reviewer",
    subtitle: "Review submitted modules, request updates, and approve publication.",
    to: "/login",
    icon: "ri-search-eye-line",
    button: "Open Reviewer Panel",
  },
  {
    title: "Admin",
    subtitle: "Manage clients, users, API keys, webhooks, and iframe configuration.",
    to: "/login",
    icon: "ri-shield-user-line",
    button: "Open Admin Panel",
  },
  {
    title: "Employee SSO",
    subtitle: "Authenticate employees and launch the Samsung LMS training player.",
    to: "/login",
    icon: "ri-user-star-line",
    button: "Open SSO Flow",
  },
];

const RoleLanding = () => {
  return (
    <>
      <div className="text-center mb-4">
        <span className="badge bg-primary-subtle text-primary-emphasis mb-3">Samsung LMS</span>
        <h1 className="mb-2">Role Panels</h1>
        <p className="text-muted mb-0">
          Trainer, reviewer, admin, and employee SSO now share the same reference admin theme.
        </p>
      </div>

      <div className="row justify-content-center">
        {cards.map((card) => (
          <div key={card.title} className="col-xl-3 col-md-6">
            <div className="card role-panel-card">
              <div className="card-body">
                <div className="avatar-md bg-primary rounded-circle d-inline-flex align-items-center justify-content-center text-white mb-3">
                  <i className={`${card.icon} fs-3`} />
                </div>
                <h4 className="mt-0">{card.title}</h4>
                <p className="text-muted">{card.subtitle}</p>
                <Link to={card.to} className="btn btn-primary">
                  {card.button}
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default RoleLanding;
