import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { Loader } from "../component/common/Loader";
import { applyBrandTheme, buildBrandTheme } from "../config/branding";
import type { AppSettings } from "../constant/interfaces";
import AxiosHelper from "../helper/AxiosHelper";
import { updateSettings } from "../redux/settingsSlice";

const ProviderCustom = ({ children }: { children: ReactNode }) => {
  const dispatch = useAppDispatch();
  const [ready, setReady] = useState(false);
  const adminId = useAppSelector((state) => state.admin._id);
  const theme = useAppSelector((state) => state.theme);
  const settings = useAppSelector((state) => state.settings);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-bs-theme", theme.bsTheme || "light");
    html.setAttribute("data-layout-mode", theme.layoutMode || "fluid");
    html.setAttribute("data-menu-color", theme.menuColor || "dark");
    html.setAttribute("data-topbar-color", theme.topbarColor || "light");
    html.setAttribute("data-layout-position", theme.layoutPosition || "fixed");
    html.setAttribute("data-sidenav-size", theme.sidenavSize || "default");
    html.setAttribute("class", theme.menuActive ? "menuitem-active sidebar-enable" : "menuitem-active");
    applyBrandTheme(buildBrandTheme(settings), theme.bsTheme || "light");
  }, [settings, theme]);

  useEffect(() => {
    document.title = settings.application_name || "Trainup";
    const title = document.querySelector('meta[name="title"]') as HTMLMetaElement | null;
    const description = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const faviconLinks = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    if (title) title.content = settings.application_name || "Trainup";
    if (description) description.content = settings.application_name || "Trainup";
    faviconLinks.forEach((link) => {
      link.href = settings.favicon;
    });
  }, [settings]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const response = await AxiosHelper.getData<AppSettings>("/settings");
        if (mounted && response.data.status) {
          dispatch(updateSettings(response.data.data));
        }
      } finally {
        if (mounted) {
          setReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [adminId, dispatch]);

  return ready ? children : <Loader />;
};

export default ProviderCustom;
