const NotFound = () => {
  return (
    <div className="row">
      <div className="col-12">
        <div className="card">
          <div className="card-body p-5 text-center">
            <div className="admin-403-icon mx-auto mb-3">
              <i className="bi bi-signpost-split" />
            </div>
            <h1 className="h4 fw-semibold mb-2">Page not found</h1>
            <p className="mb-0 text-body-secondary">
              The route does not exist inside the Trainup admin shell.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
