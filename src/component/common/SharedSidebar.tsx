import type { ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { toggleSidebar } from "../../redux/themeSlice";
import Image from "./Image";

type SharedSidebarProps = {
  subtitle: string;
  children: ReactNode;
  className?: string;
  onBrandClick?: () => void;
  brandSlot?: ReactNode;
};

const SharedSidebar = ({ subtitle, children, className = "", onBrandClick, brandSlot }: SharedSidebarProps) => {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);

  const brandContent = brandSlot ?? (
    <>
      <span className="app-sidebar-logo-mark">
        <Image src={settings.favicon} alt={settings.application_name} height={34} />
      </span>
      <span className="app-sidebar-logo-copy">
        <strong>{settings.application_name}</strong>
        <small>{subtitle}</small>
      </span>
    </>
  );

  return (
    <aside className={`leftside-menu menuitem-active app-sidebar ${className}`.trim()}>
      <div className="app-sidebar-brand">
        {onBrandClick ? (
          <button type="button" className="app-sidebar-logo" onClick={onBrandClick} aria-label="Open dashboard">
            {brandContent}
          </button>
        ) : (
          brandContent
        )}

        <button
          type="button"
          className="app-sidebar-collapse"
          onClick={() => dispatch(toggleSidebar())}
          aria-label="Toggle navigation"
        >
          <i className="ri-arrow-left-s-line" />
        </button>
      </div>

      <div id="leftside-menu-container" className="app-sidebar-scroll">
        {children}
      </div>
    </aside>
  );
};

export default SharedSidebar;
