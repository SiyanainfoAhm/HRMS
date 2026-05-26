const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

let _token: string | null = null;

export function setToken(token: string | null) {
  _token = token;
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem("hrms_token", token);
    } else {
      localStorage.removeItem("hrms_token");
    }
  }
}

export function getToken(): string | null {
  if (_token) return _token;
  if (typeof window !== "undefined") {
    _token = localStorage.getItem("hrms_token");
  }
  return _token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
  ) {
    super(typeof data?.error === "string" ? data.error : `API error ${status}`);
  }
}

export async function api<T = any>(
  path: string,
  options: RequestInit & { params?: Record<string, string> } = {},
): Promise<T> {
  const { params, ...fetchOpts } = options;
  let url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== ""),
    );
    if (qs.toString()) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (
    fetchOpts.body &&
    typeof fetchOpts.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { ...fetchOpts, headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, data);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export function get<T = any>(
  path: string,
  params?: Record<string, string>,
) {
  return api<T>(path, { method: "GET", params });
}

export function post<T = any>(
  path: string,
  body?: any,
) {
  return api<T>(path, {
    method: "POST",
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

export function put<T = any>(
  path: string,
  body?: any,
) {
  return api<T>(path, {
    method: "PUT",
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

export function del<T = any>(path: string) {
  return api<T>(path, { method: "DELETE" });
}

export function upload<T = any>(
  path: string,
  formData: FormData,
) {
  return api<T>(path, {
    method: "POST",
    body: formData as any,
  });
}
