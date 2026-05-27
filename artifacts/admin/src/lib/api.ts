const TOKEN_KEY = "biddi.admin.token";

export const API_BASE = `${window.location.origin}/api`;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  details?: { path: (string | number)[]; message: string }[];
  extra?: Record<string, unknown>;
  constructor(
    message: string,
    status: number,
    details?: { path: (string | number)[]; message: string }[],
    extra?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.details = details;
    this.extra = extra;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body:
      init.json !== undefined ? JSON.stringify(init.json) : (init.body as BodyInit | undefined),
  });
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    const { message: _m, error: _e, details: _d, ...extra } = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
    throw new ApiError(
      data?.message ?? data?.error ?? `HTTP ${res.status}`,
      res.status,
      data?.details,
      Object.keys(extra).length > 0 ? extra : undefined,
    );
  }
  return data as T;
}
