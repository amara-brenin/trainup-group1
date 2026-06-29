import { useCallback, useEffect, type ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { changeSidebarSize, toggleSidebar, toggleTheme } from "../../redux/themeSlice";
import NotificationMenu from "./NotificationMenu";

type SharedNavbarProps = {
  leftContent?: ReactNode;
  usedCredits: number;
  totalCredits: number;
  planExpired?: boolean;
  userSlot: ReactNode;
  showCredits?: boolean;
};

const SharedNavbar = ({ leftContent, usedCredits, totalCredits, planExpired = false, userSlot, showCredits = true }: SharedNavbarProps) => {
  const dispatch = useAppDispatch();
  const { bsTheme } = useAppSelector((state) => state.theme);

  const handleResize = useCallback(() => {
    const width = window.innerWidth;
    if (width <= 767) {
      dispatch(changeSidebarSize("full"));
      return;
    }
    if (width <= 1140) {
      dispatch(changeSidebarSize("condensed"));
      return;
    }
    dispatch(changeSidebarSize("default"));
  }, [dispatch]);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  const toggleFullscreen = () => {
    const doc = document as Document & {
      mozFullScreenElement?: Element;
      webkitFullscreenElement?: Element;
      mozCancelFullScreen?: () => Promise<void> | void;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const element = document.documentElement as HTMLElement & {
      mozRequestFullScreen?: () => Promise<void> | void;
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const isFullscreen =
      document.fullscreenElement || doc.mozFullScreenElement || doc.webkitFullscreenElement;

    if (isFullscreen) {
      document.body.classList.remove("fullscreen-enable");
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        void doc.mozCancelFullScreen();
      } else if (doc.webkitExitFullscreen) {
        void doc.webkitExitFullscreen();
      }
      return;
    }

    document.body.classList.add("fullscreen-enable");
    if (element.requestFullscreen) {
      void element.requestFullscreen();
    } else if (element.mozRequestFullScreen) {
      void element.mozRequestFullScreen();
    } else if (element.webkitRequestFullscreen) {
      void element.webkitRequestFullscreen();
    }
  };

  // The topbar meter reads "used / total": a fresh plan shows 0 / 40,000 and
  // climbs as credits are consumed (e.g. 500 / 40,000). An expired plan shows
  // 0 / 0 — the granted credits no longer apply until a new plan is purchased.
  const effectiveTotal = planExpired ? 0 : totalCredits;
  const effectiveUsed = planExpired ? 0 : Math.min(Math.max(usedCredits, 0), effectiveTotal);
  const effectiveAvailable = planExpired ? 0 : Math.max(totalCredits - usedCredits, 0);
  // Track depletes as credits are used (full when none used, empty when spent).
  const creditPercent = planExpired ? 0 : effectiveTotal > 0 ? Math.min(100, Math.round((effectiveAvailable / effectiveTotal) * 100)) : 0;

  return (
    <div className="navbar-custom">
      <div className="topbar container-fluid">
        <div className="d-flex align-items-center gap-lg-2 gap-1">
          <button
            type="button"
            className="button-toggle-menu d-lg-none"
            onClick={() => dispatch(toggleSidebar())}
            aria-label="Toggle menu"
          >
            <i className="ri-menu-2-line" />
          </button>
          {leftContent}
        </div>

        <ul className="topbar-menu d-flex align-items-center gap-1 gap-lg-2 mb-0">
          <NotificationMenu buttonClassName="app-topbar-icon-button dropdown-toggle arrow-none" />

          <li className="d-none d-md-inline-block">
            <button
              type="button"
              className="app-topbar-icon-button app-theme-toggle"
              onClick={() => dispatch(toggleTheme())}
              aria-label={`Switch to ${bsTheme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${bsTheme === "dark" ? "light" : "dark"} mode`}
            >
              <i className={bsTheme === "dark" ? "ri-sun-line" : "ri-moon-clear-line"} />
            </button>
          </li>

          <li className="d-none d-md-inline-block">
            <button
              type="button"
              className="app-topbar-icon-button"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
            >
              <i className="ri-fullscreen-line" />
            </button>
          </li>

          {showCredits ? (
            <li className="d-none d-md-inline-block">
              <div className="app-credit-meter" aria-label={`Credits used ${effectiveUsed} of ${effectiveTotal}`}>
                <div className="app-credit-icon">
                  <i className="ri-wallet-3-line" />
                </div>
                <div className="app-credit-copy">
                  <span>{planExpired ? "Credits (Expired)" : "Credits"}</span>
                  <strong className={planExpired ? "text-danger" : undefined}>
                    {effectiveUsed.toLocaleString()} / {effectiveTotal.toLocaleString()}
                  </strong>
                  <div className="app-credit-track">
                    <span style={{ width: `${creditPercent}%` }} />
                  </div>
                </div>
              </div>
            </li>
          ) : null}

          {userSlot}
        </ul>
      </div>
    </div>
  );
};

export default SharedNavbar;
