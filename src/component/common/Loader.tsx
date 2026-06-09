export const Loader = () => {
  return (
    <div className="admin-loader-screen" role="status" aria-live="polite">
      <div className="admin-loader-shell">
        <div className="admin-loader-header">
          <span className="admin-loader-spinner" aria-hidden="true" />
          <div>
            <p className="admin-loader-title">Loading workspace</p>
            <p className="admin-loader-text">Fetching the latest panel data and layout.</p>
          </div>
        </div>
        <div className="admin-loader-preview" aria-hidden="true">
          <div className="admin-loader-sidebar ds-skeleton" />
          <div className="admin-loader-content">
            <div className="admin-loader-toolbar">
              <span className="ds-skeleton admin-loader-line admin-loader-line-lg" />
              <span className="ds-skeleton admin-loader-chip" />
            </div>
            <div className="admin-loader-grid">
              <span className="ds-skeleton admin-loader-card" />
              <span className="ds-skeleton admin-loader-card" />
              <span className="ds-skeleton admin-loader-card" />
            </div>
            <div className="ds-skeleton admin-loader-table" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Loader;
