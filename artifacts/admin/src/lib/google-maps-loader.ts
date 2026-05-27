// Shared Google Maps JS API loader for the admin app.
//
// All admin map surfaces (Dashboard, Live Map, Heat View, Polygon editor,
// Circle editor) use this single helper so:
//   * the script tag uses the modern `loading=async` pattern (no console
//     warning from Google),
//   * concurrent loads share one promise (no duplicate <script> tags),
//   * a global `gm_authFailure` handler is installed before injection so
//     auth errors are surfaced instead of silently swallowed,
//   * a tiny `console.error` sniffer captures the specific Google error
//     code (InvalidKey / RefererNotAllowed / ApiNotActivated /
//     BillingNotEnabled) so the admin sees an actionable banner.

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
  scriptEl?: HTMLScriptElement;
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
      return "Google Maps key was rejected (InvalidKeyMapError). Double-check the key value in Settings → Maps.";
    case "RefererNotAllowed":
      return `Google Maps key was rejected (RefererNotAllowedMapError). Add ${typeof window !== "undefined" ? window.location.origin : "this admin domain"} to the key's HTTP referrer restrictions in Google Cloud Console.`;
    case "ApiNotActivated":
      return "Google Maps key was rejected (ApiNotActivatedMapError). Enable 'Maps JavaScript API' for the key in Google Cloud Console.";
    case "BillingNotEnabled":
      return "Google Maps key was rejected (BillingNotEnabledMapError). Enable billing on the Google Cloud project that owns this key.";
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
    return "No Google Maps web key configured (MissingKeyMapError) — showing a fallback basemap. Add a key in Settings → Maps to enable the standard Google Roadmap.";
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
          // gm_authFailure already fired before we knew the code; notify
          // late subscribers now with the refined reason.
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
  // Always (re)install our handler so it wins over any prior assignment.
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

  if (import.meta.env.DEV) {
    if (state.promise && state.lastKey === key) {
      console.debug("[Google Maps] using cached result");
    } else {
      console.debug(`[Google Maps] loader called – key present: ${Boolean(key)}`);
    }
  }

  patchConsole(state);
  installAuthFailureHandler(state);

  // If the admin updated the key in Settings, drop the cached result so
  // an in-session retry can pick up the corrected value without a full
  // page reload. The Google Maps JS API global itself can't be reloaded
  // cleanly once mounted, but for first-attempt-failed → fix-the-key
  // flows this lets the next call go through.
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
      // Wait a short grace period after the script's callback to give
      // gm_authFailure a chance to fire (it runs immediately after the
      // API decides the key is bad). If it fires, we surface the
      // specific reason; otherwise we report ready.
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
      // Allow a future retry to attempt loading again after a transient
      // network/CSP error.
      state.promise = undefined;
      state.scriptEl = undefined;
      resolve({
        status: "script-error",
        message:
          "Could not load the Google Maps JavaScript API script (network, CSP, or blocked request).",
      });
    };
    state.scriptEl = s;
    document.head.appendChild(s);
  });
  return state.promise;
}

// Reset the loader's cached promise and per-attempt flags so a subsequent
// `loadGoogleMaps` call performs a fresh attempt. Removes any prior
// injected script tag if the JS API hasn't fully booted yet — once
// `window.google.maps` exists, the global is sticky for the page session
// and only a full reload can swap it out.
export function resetGoogleMapsLoader(): void {
  if (typeof window === "undefined") return;
  const state = getState();
  state.promise = undefined;
  state.authFailureCalled = false;
  state.latestErrorCode = undefined;
  state.lastKey = undefined;
  const w = window as unknown as { google?: { maps?: unknown } };
  if (!w.google?.maps && state.scriptEl?.parentNode) {
    state.scriptEl.parentNode.removeChild(state.scriptEl);
  }
  state.scriptEl = undefined;
}

// One-off "test this key" entry point used by Settings → Maps. Resets the
// shared loader state so the cached failure/success from earlier in the
// session is bypassed, then attempts a fresh load with the supplied key.
//
// Caveat: the Google Maps JS API global (`window.google.maps`) is sticky
// once it has booted. If a successful load already happened with a
// different key in this tab, we cannot truly re-validate the new key
// without a full page reload, so we surface that explicitly instead of
// returning a misleading "ready".
export async function testGoogleMapsKey(
  key: string,
): Promise<GoogleMapsLoadResult> {
  if (typeof window === "undefined") {
    return {
      status: "script-error",
      message: "Window is not available.",
    };
  }
  const state = getState();
  const w = window as unknown as { google?: { maps?: unknown } };
  const mapsAlreadyLoaded = !!w.google?.maps && !state.authFailureCalled;
  const previousKey = state.lastKey;
  if (mapsAlreadyLoaded && previousKey !== undefined && previousKey !== key) {
    return {
      status: "script-error",
      message:
        "Google Maps is already loaded in this tab with a different key. Save the new key and reload the page to re-test.",
    };
  }
  resetGoogleMapsLoader();
  return loadGoogleMaps(key);
}
