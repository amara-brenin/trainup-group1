import type { ApiEnvelope } from "../constant/interfaces";
import axios from "axios";
import { getAuthToken } from "./authSession";
import { mockRequest } from "./mockApi";
import { clientApiBaseUrl, getRequestUrl, isLocalApiBaseUrl, isServerApiEnabled } from "./runtimeApi";

type ApiResponse<T> = Promise<{ data: ApiEnvelope<T> }>;

const buildConfig = (params?: Record<string, unknown>) => {
  const token = getAuthToken();

  return {
    params,
    validateStatus: () => true,
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
  };
};

const withLocalMockFallback = async <T>(
  request: Promise<{ data: ApiEnvelope<T> }>,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  params?: Record<string, unknown>,
) => {
  try {
    return await request;
  } catch (error) {
    if (!isLocalApiBaseUrl) {
      throw error;
    }

    return mockRequest(method, url, payload, params) as ApiResponse<T>;
  }
};

const AxiosHelper = {
  getData: <T>(url: string, params?: Record<string, unknown>) =>
    isServerApiEnabled
      ? withLocalMockFallback<T>(
          axios.get<ApiEnvelope<T>>(getRequestUrl(url), buildConfig(params)) as ApiResponse<T>,
          "GET",
          url,
          undefined,
          params,
        )
      : (mockRequest("GET", url, undefined, params) as ApiResponse<T>),
  postData: <T, P = unknown>(url: string, payload: P, _multipart = false) =>
    isServerApiEnabled
      ? withLocalMockFallback<T>(
          axios.post<ApiEnvelope<T>>(getRequestUrl(url), payload, buildConfig()) as ApiResponse<T>,
          "POST",
          url,
          payload as Record<string, unknown>,
        )
      : (mockRequest("POST", url, payload as Record<string, unknown>) as ApiResponse<T>),
  putData: <T, P = unknown>(url: string, payload: P, _multipart = false) =>
    isServerApiEnabled
      ? withLocalMockFallback<T>(
          axios.put<ApiEnvelope<T>>(getRequestUrl(url), payload, buildConfig()) as ApiResponse<T>,
          "PUT",
          url,
          payload as Record<string, unknown>,
        )
      : (mockRequest("PUT", url, payload as Record<string, unknown>) as ApiResponse<T>),
  deleteData: <T>(url: string) =>
    isServerApiEnabled
      ? withLocalMockFallback<T>(
          axios.delete<ApiEnvelope<T>>(getRequestUrl(url), buildConfig()) as ApiResponse<T>,
          "DELETE",
          url,
        )
      : (mockRequest("DELETE", url) as ApiResponse<T>),
};

export { clientApiBaseUrl, isServerApiEnabled };
export default AxiosHelper;
