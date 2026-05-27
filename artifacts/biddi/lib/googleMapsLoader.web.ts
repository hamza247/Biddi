// Shared Google Maps JS API loader for the Biddi Expo *web* build.
//
// Mirrors `artifacts/admin/src/lib/google-maps-loader.ts` so the rider /
// driver web preview surfaces the same actionable reason banner as the
// admin maps when the configured Google Maps web key is broken (invalid,
// referrer not allowed, API not activated, billing not enabled, or a
// generic script-load error).
//
// Native (iOS/Android) builds never import this file — see the platform
// extension `.web.ts` resolution.

export type GoogleMapsAuthReason =
  | "InvalidKey"
  | "RefererNotAllowed"
  | "ApiNotActivated"
  | "BillingNotEnabled"
  | "Unknown";

export type GoogleMapsLoadResult =
  | { status: "ready" }
  | { status: "auth-failed"; reason: GoogleMapsAuthReason; message: string }
  | { status: "script-error"; message: string };

interface LoaderState {
  promise?: Promise<GoogleMapsLoadResult>;
  lastKey?: string;
  latestErrorCode?: GoogleMapsAuthReason;
  authFailureCalled: boolean;
  consolePatched: boolean;
  listeners: Set<(result: GoogleMapsLoadResult) => void>;
}

const STATE_KEY = "__biddiGmapsLoaderState";

function getState(): LoaderState {
  const w = window as unknown as Record<string, LoaderState | undefined>;
  let s = w[STATE_KEY];
  if (!s) {
    s = {
      authFailureCalled: false,
      consolePatched: false,
      listeners: new Set(),
    };
    w[STATE_KEY] = s;
  }
  return s;
}

export function describeAuthReason(reason: GoogleMapsAuthReason): string {
  switch (reason) {
    case "InvalidKey":
      return "Google Maps key was rejected (InvalidKey). Double-check the key value in admin Settings → Maps.";
    case "RefererNotAllowed":
      return `Google Maps key was rejected (RefererNotAllowed). Add ${typeof window !== "undefined" ? window.location.origin : "this web domain"} to the key's HTTP referrer restrictions in Google Cloud Console.`;
    case "ApiNotActivated":
      return "Google Maps key was rejected (ApiNotActivated). Enable 'Maps JavaScript API' for the key in Google Cloud Console.";
    case "BillingNotEnabled":
      return "Google Maps key was rejected (BillingNotEnabled). Enable billing on the Google Cloud project that owns this key.";
    case "Unknown":
    default:
      return "Google Maps key was rejected. Check the key configuration in Google Cloud Console (referrer restrictions, enabled APIs, billing).";
  }
}

export function describeLoadResult(
  result: GoogleMapsLoadResult,
  hasKey: boolean,
): string {
  if (result.status === "ready") return "";
  if (result.status === "script-error") {
    return "Could not load the Google Maps JavaScript API (network, CSP, or script error). Showing a fallback basemap.";
  }
  if (!hasKey) {
    return "No Google Maps web key configured — showing a fallback basemap.";
  }
  return result.message;
}

function patchConsole(state: LoaderState): void {
  if (state.consolePatched) return;
  state.consolePatched = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const text = args
        .map((a) => (typeof a === "string" ? a : ""))
        .join(" ");
      const m = text.match(/Google Maps JavaScript API (?:error|warning): (\w+)/);
      if (m) {
        const code = m[1];
        let reason: GoogleMapsAuthReason = "Unknown";
        if (code.startsWith("InvalidKey")) reason = "InvalidKey";
        else if (code.startsWith("RefererNotAllowed")) reason = "RefererNotAllowed";
        else if (code.startsWith("ApiNotActivated")) reason = "ApiNotActivated";
        else if (code.startsWith("BillingNotEnabled")) reason = "BillingNotEnabled";
        state.latestErrorCode = reason;
        if (state.authFailureCalled) {
          const r: GoogleMapsLoadResult = {
            status: "auth-failed",
            reason,
            message: describeAuthReason(reason),
          };
          state.listeners.forEach((fn) => {
            try {
              fn(r);
            } catch {
              // ignore listener errors
            }
          });
        }
      }
    } catch {
      // ignore sniffing errors
    }
    orig(...args);
  };
}

function installAuthFailureHandler(state: LoaderState): void {
  const w = window as unknown as { gm_authFailure?: () => void };
  w.gm_authFailure = () => {
    state.authFailureCalled = true;
    const reason = state.latestErrorCode ?? "Unknown";
    const r: GoogleMapsLoadResult = {
      status: "auth-failed",
      reason,
      message: describeAuthReason(reason),
    };
    state.listeners.forEach((fn) => {
      try {
        fn(r);
      } catch {
        // ignore listener errors
      }
    });
  };
}

export function subscribeAuthFailure(
  fn: (result: GoogleMapsLoadResult) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const state = getState();
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}

export function loadGoogleMaps(key: string): Promise<GoogleMapsLoadResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({
      status: "script-error",
      message: "Window is not available.",
    });
  }
  const state = getState();
  patchConsole(state);
  installAuthFailureHandler(state);

  if (state.lastKey !== undefined && state.lastKey !== key) {
    state.promise = undefined;
    state.authFailureCalled = false;
    state.latestErrorCode = undefined;
  }
  state.lastKey = key;

  const w = window as unknown as { google?: { maps?: unknown } };
  if (w.google?.maps && !state.authFailureCalled) {
    if (!state.promise) state.promise = Promise.resolve({ status: "ready" });
    return state.promise;
  }
  if (state.promise) return state.promise;

  state.promise = new Promise<GoogleMapsLoadResult>((resolve) => {
    const cb = `__biddiGmapsCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const wAny = window as unknown as Record<string, unknown>;
    wAny[cb] = () => {
      delete wAny[cb];
      window.setTimeout(() => {
        if (state.authFailureCalled) {
          const reason = state.latestErrorCode ?? "Unknown";
          resolve({
            status: "auth-failed",
            reason,
            message: describeAuthReason(reason),
          });
        } else {
          resolve({ status: "ready" });
        }
      }, 1500);
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=${cb}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      delete wAny[cb];
      state.promise = undefined;
      resolve({
        status: "script-error",
        message:
          "Could not load the Google Maps JavaScript API script (network, CSP, or blocked request).",
      });
    };
    document.head.appendChild(s);
  });
  return state.promise;
}
