const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
const defaultProductionApiBaseUrl = "https://trainup-gwni.onrender.com/api-v1";

export const clientApiBaseUrl = configuredApiBaseUrl || (import.meta.env.PROD ? defaultProductionApiBaseUrl : "");
export const isServerApiEnabled = Boolean(clientApiBaseUrl);
export const isLocalApiBaseUrl = /localhost|127\.0\.0\.1/i.test(clientApiBaseUrl);

export const normalizeApiUrl = (url: string) => (url.startsWith("/") ? url : `/${url}`);
export const getRequestUrl = (url: string) => `${clientApiBaseUrl}${normalizeApiUrl(url)}`;
