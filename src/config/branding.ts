import Logo from "../assets/images/logo.png";
import LogoDark from "../assets/images/logo-dark.png";
import Favicon from "../assets/images/favicon.png";

export type BrandMode = "light" | "dark";
export type SidebarTheme = "graphite" | "light" | "brand";
export type RadiusScale = "compact" | "comfortable" | "rounded";

export type BrandThemeConfig = {
  name: string;
  primaryColor: string;
  primaryHoverColor: string;
  secondaryColor: string;
  accentColor: string;
  successColor: string;
  warningColor: string;
  dangerColor: string;
  gradientFrom: string;
  gradientTo: string;
  sidebarTheme: SidebarTheme;
  buttonRadius: string;
  cardRadius: string;
  inputRadius: string;
  fontFamily: string;
  logo: string;
  darkLogo: string;
  favicon: string;
};

export const defaultBrandTheme: BrandThemeConfig = {
  name: "Trainup",
  primaryColor: "#2563eb",
  primaryHoverColor: "#1d4ed8",
  secondaryColor: "#475569",
  accentColor: "#14b8a6",
  successColor: "#16a34a",
  warningColor: "#d97706",
  dangerColor: "#dc2626",
  gradientFrom: "#2563eb",
  gradientTo: "#14b8a6",
  sidebarTheme: "graphite",
  buttonRadius: "8px",
  cardRadius: "12px",
  inputRadius: "8px",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  logo: Logo,
  darkLogo: LogoDark,
  favicon: Favicon,
};

type BrandSettingsPayload = Partial<{
  application_name: string;
  applicationName: string;
  logo: string;
  dark_logo: string;
  darkLogoUrl: string;
  favicon: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  sidebarTheme: SidebarTheme;
  buttonRadius: string;
  cardRadius: string;
  inputRadius: string;
  fontFamily: string;
}>;

export const buildBrandTheme = (settings: BrandSettingsPayload): BrandThemeConfig => ({
  ...defaultBrandTheme,
  name: settings.application_name || settings.applicationName || defaultBrandTheme.name,
  logo: settings.logo || defaultBrandTheme.logo,
  darkLogo: settings.dark_logo || settings.darkLogoUrl || defaultBrandTheme.darkLogo,
  favicon: settings.favicon || settings.faviconUrl || defaultBrandTheme.favicon,
  primaryColor: settings.primaryColor || defaultBrandTheme.primaryColor,
  primaryHoverColor: settings.primaryColor || defaultBrandTheme.primaryHoverColor,
  secondaryColor: settings.secondaryColor || defaultBrandTheme.secondaryColor,
  accentColor: settings.accentColor || defaultBrandTheme.accentColor,
  gradientFrom: settings.gradientFrom || settings.primaryColor || defaultBrandTheme.gradientFrom,
  gradientTo: settings.gradientTo || settings.accentColor || defaultBrandTheme.gradientTo,
  sidebarTheme: settings.sidebarTheme || defaultBrandTheme.sidebarTheme,
  buttonRadius: settings.buttonRadius || defaultBrandTheme.buttonRadius,
  cardRadius: settings.cardRadius || defaultBrandTheme.cardRadius,
  inputRadius: settings.inputRadius || defaultBrandTheme.inputRadius,
  fontFamily: settings.fontFamily || defaultBrandTheme.fontFamily,
});

export const applyBrandTheme = (theme: BrandThemeConfig, mode: BrandMode) => {
  const root = document.documentElement;
  const surface = mode === "dark" ? "#111827" : "#ffffff";
  const surfaceMuted = mode === "dark" ? "#1f2937" : "#f8fafc";
  const pageBackground = mode === "dark" ? "#0f172a" : "#f5f7fb";
  const text = mode === "dark" ? "#e5e7eb" : "#0f172a";
  const muted = mode === "dark" ? "#94a3b8" : "#64748b";
  const border = mode === "dark" ? "rgba(148, 163, 184, 0.22)" : "rgba(15, 23, 42, 0.1)";

  const tokens: Record<string, string> = {
    "--brand-name": `"${theme.name}"`,
    "--brand-primary": theme.primaryColor,
    "--brand-primary-hover": theme.primaryHoverColor,
    "--brand-secondary": theme.secondaryColor,
    "--brand-accent": theme.accentColor,
    "--brand-success": theme.successColor,
    "--brand-warning": theme.warningColor,
    "--brand-danger": theme.dangerColor,
    "--brand-gradient-from": theme.gradientFrom,
    "--brand-gradient-to": theme.gradientTo,
    "--brand-font-family": theme.fontFamily,
    "--brand-button-radius": theme.buttonRadius,
    "--brand-card-radius": theme.cardRadius,
    "--brand-input-radius": theme.inputRadius,
    "--brand-surface": surface,
    "--brand-surface-muted": surfaceMuted,
    "--brand-page-background": pageBackground,
    "--brand-text": text,
    "--brand-muted": muted,
    "--brand-border": border,
    "--ct-primary": theme.primaryColor,
    "--bs-primary": theme.primaryColor,
    "--bs-btn-bg": theme.primaryColor,
    "--bs-btn-border-color": theme.primaryColor,
    "--bs-btn-hover-bg": theme.primaryHoverColor,
    "--bs-btn-hover-border-color": theme.primaryHoverColor,
    "--ct-link-hover-color": theme.primaryHoverColor,
    "--ct-body-bg": pageBackground,
    "--ct-secondary-bg": surface,
    "--ct-tertiary-bg": surfaceMuted,
    "--ct-body-color": muted,
    "--ct-tertiary-color": text,
    "--ct-border-color": border,
  };

  Object.entries(tokens).forEach(([key, value]) => root.style.setProperty(key, value));
  root.setAttribute("data-brand-sidebar", theme.sidebarTheme);
};
