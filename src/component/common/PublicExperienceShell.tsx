import type { ReactNode } from "react";
import PageShell from "./PageShell";

type PublicExperienceShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeClassName?: string;
  icon: string;
  actions?: ReactNode;
  children: ReactNode;
};

const PublicExperienceShell = ({
  eyebrow,
  title,
  subtitle,
  badge,
  badgeClassName = "bg-primary-subtle text-primary-emphasis",
  icon,
  actions,
  children,
}: PublicExperienceShellProps) => {
  return (
    <PageShell
      title={title}
      description={subtitle}
      eyebrow={
        <>
          <span className="public-experience-icon">
            <i className={icon} />
          </span>
          <span className="badge bg-primary-subtle text-primary-emphasis">{eyebrow}</span>
          <span className={`badge ${badgeClassName}`}>{badge}</span>
        </>
      }
    >
      {actions ? (
        <div className="public-experience-actions d-flex flex-wrap gap-2 align-items-center justify-content-between">
          {actions}
        </div>
      ) : null}

      {children}
    </PageShell>
  );
};

export default PublicExperienceShell;
