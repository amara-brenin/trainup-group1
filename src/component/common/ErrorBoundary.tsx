import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError() {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Application error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="d-flex min-vh-100 align-items-center justify-content-center bg-body-tertiary px-3">
          <div className="card admin-error-card shadow-sm">
            <div className="card-body p-4 p-lg-5 text-center">
              <div className="admin-error-icon mb-3">
                <i className="bi bi-exclamation-octagon" />
              </div>
              <h1 className="h4 fw-semibold mb-2">Something went wrong.</h1>
              <p className="text-body-secondary mb-4">
                The admin panel hit an unexpected error. Reload the page to recover.
              </p>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
