import type { ReactNode } from "react";

type PageShellProps = {
  title?: string;
  description?: string;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

const PageShell = ({
  title,
  description,
  eyebrow,
  actions,
  children,
  className = "",
  contentClassName = "",
}: PageShellProps) => (
  <section className={`app-page-shell ${className}`.trim()}>
    {title || description || eyebrow || actions ? (
      <div className="admin-page-intro app-page-header">
        <div className="app-page-header-copy">
          {eyebrow ? <div className="app-page-eyebrow">{eyebrow}</div> : null}
          {title ? <h1>{title}</h1> : null}
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="admin-page-actions app-page-actions">{actions}</div> : null}
      </div>
    ) : null}

    <div className={`app-page-content ${contentClassName}`.trim()}>{children}</div>
  </section>
);

export default PageShell;
