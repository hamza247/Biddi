import * as SecureStore from "expo-secure-store";

const API_BASE_KEY = "biddi.apiBase";
const TOKEN_KEY = "biddi.authToken";

let _baseUrl = "";
let _token: string | null = null;

export function getBaseUrl(): string {
  return _baseUrl;
}
export function setBaseUrl(url: string) {
  _baseUrl = url.replace(/\/+$/, "");
}

export async function loadToken(): Promise<string | null> {
  if (_token) return _token;
  try {
    _token = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? null;
  } catch {
    _token = null;
  }
  return _token;
}
export async function setToken(token: string | null): Promise<void> {
  _token = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
export function getTokenSync(): string | null {
  return _token;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.json !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const token = await loadToken();
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);

  const url = path.startsWith("http") ? path : `${_baseUrl}${path}`;
  // Disable HTTP caching so we never receive a 304 with an empty body
  // (which would parse to `null` and confuse callers that expect a JSON
  // shape like `{ user: ... }`). The API responses are user-specific
  // anyway and should not be cached.
  if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    body:
      init.json !== undefined ? JSON.stringify(init.json) : (init.body as BodyInit | undefined),
  });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (typeof data === "object" && data && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`);
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export async function persistApiBase(url: string) {
  try {
    await SecureStore.setItemAsync(API_BASE_KEY, url);
  } catch {
    /* ignore */
  }
}
export async function loadPersistedApiBase(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(API_BASE_KEY)) ?? null;
  } catch {
    return null;
  }
}
export async function clearPersistedApiBase(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(API_BASE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Loads the persisted API base URL and validates it is reachable by probing
 * /api/config/public with a short timeout. Returns the validated URL on
 * success, or null if the URL is missing, unreachable, or times out — in
 * which case the stale entry is also removed from SecureStore.
 */
export async function loadAndValidatePersistedApiBase(): Promise<string | null> {
  const persisted = await loadPersistedApiBase();
  if (!persisted) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${persisted}/api/config/public`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      await clearPersistedApiBase();
      return null;
    }
    return persisted;
  } catch {
    await clearPersistedApiBase();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
