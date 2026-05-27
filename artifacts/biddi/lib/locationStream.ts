import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import * as Location from "expo-location";
import type { Socket } from "socket.io-client";

import { getSocket } from "./socket";
import { api } from "./api";

let subscription: Location.LocationSubscription | null = null;
let starting = false;
// Driver-side desire to stream. The OS-level subscription only runs while
// this is true AND the socket is connected AND the app is foregrounded
// (or has been backgrounded for less than the grace period). This way we
// don't keep waking the GPS / radio when nothing useful can come of it,
// but we resume automatically when conditions are met again.
let wantStreaming = false;

// Track which socket instance we've attached lifecycle listeners to so we
// don't double-bind across reconnects or auth changes. We also keep the
// concrete listener references so we can detach cleanly on stop.
let attachedSocket: Socket | null = null;
let attachedConnectHandler: (() => void) | null = null;
let attachedDisconnectHandler: (() => void) | null = null;
// If the socket isn't ready yet at the time we want to start, poll until
// it shows up so we don't miss the cold-start case (driver already online
// when the app launches and AppContext kicks off connectSocket() in
// parallel with our start request).
let attachWaitTimer: ReturnType<typeof setInterval> | null = null;

// AppState handling: if the app is backgrounded for longer than this, we
// shut down the GPS subscription. Foreground location is anyway unreliable
// once backgrounded, and continuing to watch wastes battery. The driver
// app does not currently request background location permission.
const BACKGROUND_GRACE_MS = 30_000;
let appStateSub: NativeEventSubscription | null = null;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let lastAppState: AppStateStatus = AppState.currentState;

// Throttle for the HTTP fallback — at most one REST call per 15 seconds
// so we don't flood the server when the socket is slow to connect.
const HTTP_FALLBACK_INTERVAL_MS = 15_000;
let lastHttpFallbackAt = 0;

async function sendLocationViaHttp(
  lat: number,
  lng: number,
  heading?: number,
): Promise<void> {
  const now = Date.now();
  if (now - lastHttpFallbackAt < HTTP_FALLBACK_INTERVAL_MS) return;
  lastHttpFallbackAt = now;
  try {
    await api("/driver/location", {
      method: "POST",
      json: { lat, lng, ...(heading !== undefined ? { heading } : {}) },
    });
  } catch {
    // Non-critical — the next GPS tick will retry after the throttle window.
  }
}

async function startWatching(): Promise<void> {
  if (subscription || starting) return;
  starting = true;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") return;
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 25,
      },
      (pos) => {
        const c = pos.coords;
        const lat = c.latitude;
        const lng = c.longitude;
        const heading =
          typeof c.heading === "number" && c.heading >= 0 ? c.heading : undefined;
        const sock = getSocket();
        if (sock && sock.connected) {
          sock.emit("driver:location", {
            lat,
            lng,
            heading,
            speed: typeof c.speed === "number" && c.speed >= 0 ? c.speed : undefined,
            accuracy: typeof c.accuracy === "number" && c.accuracy >= 0 ? c.accuracy : undefined,
          });
        } else {
          // Socket not connected yet — fall back to HTTP so the position is
          // not silently dropped during cold-start or brief network switches.
          void sendLocationViaHttp(lat, lng, heading);
        }
      },
    );
    subscription = sub;
  } catch {
    // expo-location may throw on web/permissions — silently ignore so the
    // driver flow keeps working without GPS streaming.
  } finally {
    starting = false;
  }
}

function stopWatching(): void {
  if (subscription) {
    try {
      subscription.remove();
    } catch {
      /* ignore */
    }
    subscription = null;
  }
}

function clearBackgroundTimer(): void {
  if (backgroundTimer) {
    clearTimeout(backgroundTimer);
    backgroundTimer = null;
  }
}

function clearAttachWaitTimer(): void {
  if (attachWaitTimer) {
    clearInterval(attachWaitTimer);
    attachWaitTimer = null;
  }
}

function maybeResume(): void {
  if (!wantStreaming) return;
  // Only resume if app is foregrounded (active). On RN web, AppState is
  // always "active", so this is a no-op there.
  // NOTE: we intentionally do NOT require the socket to be connected here.
  // The GPS watcher runs whenever streaming is desired and the app is active —
  // each location tick decides at emit time whether to use the socket (fast
  // path) or the HTTP fallback (when socket is not yet connected). This
  // ensures position updates flow during cold-start handshake delays and
  // brief network switches instead of being silently dropped.
  if (AppState.currentState !== "active") return;
  void startWatching();
}

function onAppStateChange(next: AppStateStatus): void {
  const wasActive = lastAppState === "active";
  const isActive = next === "active";
  lastAppState = next;
  if (!isActive && wasActive) {
    // App just left foreground — start a grace timer; if we're still
    // backgrounded after BACKGROUND_GRACE_MS, tear down GPS to save
    // battery. Anything shorter than the grace (quick app switch) leaves
    // the subscription alone for a smoother UX on return.
    clearBackgroundTimer();
    backgroundTimer = setTimeout(() => {
      if (AppState.currentState !== "active") {
        stopWatching();
      }
      backgroundTimer = null;
    }, BACKGROUND_GRACE_MS);
  } else if (isActive) {
    // Returned to foreground before / after the grace expired: cancel any
    // pending shutdown and restart the subscription if it was torn down.
    clearBackgroundTimer();
    maybeResume();
  }
}

function attachAppStateListener(): void {
  if (appStateSub) return;
  try {
    appStateSub = AppState.addEventListener("change", onAppStateChange);
  } catch {
    // AppState may not be available in some test environments — ignore.
  }
}

function detachAppStateListener(): void {
  if (appStateSub) {
    try {
      appStateSub.remove();
    } catch {
      /* ignore */
    }
    appStateSub = null;
  }
}

function detachSocketLifecycle(): void {
  if (attachedSocket) {
    try {
      if (attachedConnectHandler) attachedSocket.off("connect", attachedConnectHandler);
      if (attachedDisconnectHandler) attachedSocket.off("disconnect", attachedDisconnectHandler);
    } catch {
      /* ignore */
    }
  }
  attachedSocket = null;
  attachedConnectHandler = null;
  attachedDisconnectHandler = null;
}

function tryAttachSocketLifecycle(): boolean {
  const sock = getSocket();
  if (!sock) return false;
  if (sock === attachedSocket) return true;
  // The active socket changed (e.g. after logout/login). Detach old
  // listeners before re-binding to avoid leaks across sessions.
  if (attachedSocket) detachSocketLifecycle();
  attachedSocket = sock;
  attachedConnectHandler = () => {
    maybeResume();
  };
  attachedDisconnectHandler = () => {
    // Keep the GPS subscription running while disconnected — the location
    // callback will route ticks through the HTTP fallback (POST /driver/location)
    // at a throttled rate so position updates still reach the server during
    // brief reconnect gaps. Stopping here would leave the fallback with
    // nothing to call.
    // maybeResume() is called on the "connect" event above and will restart
    // the watcher if it ever gets torn down by the background-grace timer.
  };
  sock.on("connect", attachedConnectHandler);
  sock.on("disconnect", attachedDisconnectHandler);
  // If the socket is already connected by the time we attach (race during
  // cold start), kick off an immediate resume.
  if (sock.connected) maybeResume();
  return true;
}

export async function startLocationStream(): Promise<void> {
  wantStreaming = true;
  attachAppStateListener();
  // Attach to the current socket if there is one; otherwise poll until
  // AppContext's connectSocket() resolves and a socket appears, so the
  // cold-start case (driver online before the app launches) doesn't end
  // up with no listeners and a permanently-silent stream.
  if (!tryAttachSocketLifecycle()) {
    clearAttachWaitTimer();
    attachWaitTimer = setInterval(() => {
      if (!wantStreaming) {
        clearAttachWaitTimer();
        return;
      }
      if (tryAttachSocketLifecycle()) {
        clearAttachWaitTimer();
      }
    }, 500);
  }
  maybeResume();
}

export function stopLocationStream(): void {
  wantStreaming = false;
  clearBackgroundTimer();
  clearAttachWaitTimer();
  stopWatching();
  detachSocketLifecycle();
  detachAppStateListener();
  lastAppState = AppState.currentState;
}
