import { useEffect, type PropsWithChildren } from "react";
import { useAppSelector } from "../../app/hooks";

export const ThemeSettingsProvider = ({ children }: PropsWithChildren) => {
  const {
    bsTheme,
    layoutMode,
    menuColor,
    topbarColor,
    layoutPosition,
    sidenavSize,
    menuActive,
    modalCount,
  } = useAppSelector((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-bs-theme", bsTheme);
    root.setAttribute("data-layout-mode", layoutMode);
    root.setAttribute("data-menu-color", menuColor);
    root.setAttribute("data-topbar-color", topbarColor);
    root.setAttribute("data-layout-position", layoutPosition);
    root.setAttribute("data-sidenav-size", sidenavSize);
    root.classList.toggle("sidebar-active", menuActive);
    document.body.classList.toggle("modal-open-by-redux", modalCount > 0);
  }, [
    bsTheme,
    layoutMode,
    layoutPosition,
    menuActive,
    menuColor,
    modalCount,
    sidenavSize,
    topbarColor,
  ]);

  return <>{children}</>;
};
