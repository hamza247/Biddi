import { useEffect, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as Location from "expo-location";

import { fetchReverseGeocode } from "./maps";
import type { Place } from "./types";

export interface CurrentLocation {
  lat: number;
  lng: number;
  address: string;
  primary: string;
}

const _envTtl = parseInt(
  process.env.EXPO_PUBLIC_LOCATION_CACHE_TTL_MS ?? "",
  10,
);
const CACHE_TTL_MS = Number.isFinite(_envTtl) && _envTtl > 0
  ? _envTtl
  : 5 * 60 * 1000;

const _envTimeout = parseInt(
  process.env.EXPO_PUBLIC_LOCATION_TIMEOUT_MS ?? "",
  10,
);
const LOCATION_TIMEOUT_MS = Number.isFinite(_envTimeout) && _envTimeout > 0
  ? _envTimeout
  : 20000;

export type LocationError = "timeout" | "permission" | "unknown" | null;

let cache: CurrentLocation | null = null;
let cacheTimestamp: number | null = null;
let inFlight: Promise<CurrentLocation | null> | null = null;
let lastError: LocationError = null;
const listeners = new Set<(loc: CurrentLocation | null) => void>();
const errorListeners = new Set<(err: LocationError) => void>();

function isCacheStale(): boolean {
  if (!cache || cacheTimestamp === null) return true;
  return Date.now() - cacheTimestamp > CACHE_TTL_MS;
}

function notifyLocation(loc: CurrentLocation | null) {
  cache = loc;
  if (loc) cacheTimestamp = Date.now();
  listeners.forEach((l) => l(loc));
}

function notifyError(err: LocationError) {
  lastError = err;
  errorListeners.forEach((l) => l(err));
}

async function buildLocation(
  coords: { latitude: number; longitude: number },
): Promise<CurrentLocation> {
  const { latitude: lat, longitude: lng } = coords;
  const rev = await fetchReverseGeocode(lat, lng);
  return {
    lat,
    lng,
    address: rev?.address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    primary: rev?.primary ?? "Current location",
  };
}

async function load(force = false): Promise<CurrentLocation | null> {
  if (cache && !force && !isCacheStale()) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        notifyError("permission");
        return null;
      }

      // ── Step 1: try last-known for an instant result on native ──────────
      // On iOS/Android, getLastKnownPositionAsync returns a cached fix
      // immediately (no GPS wait). On web it returns null.
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,   // accept positions up to 5 min old
          requiredAccuracy: 1000,  // up to 1 km accuracy is fine for display
        });
        if (last) {
          const loc = await buildLocation(last.coords);
          notifyLocation(loc);
          notifyError(null);
          // Don't return yet — continue to get a fresh fix in the background
        }
      } catch {
        // getLastKnownPositionAsync not available on this platform — ignore
      }

      // ── Step 2: get a fresh fix (lower accuracy = faster, less battery) ──
      // Accuracy.Low uses WiFi/cell towers — fast, works indoors.
      // Accuracy.Balanced is tried as a followup after Low succeeds.
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("location timeout")), LOCATION_TIMEOUT_MS),
        ),
      ]);

      const loc = await buildLocation(pos.coords);
      notifyLocation(loc);
      notifyError(null);
      return loc;
    } catch (err) {
      const isTimeout =
        err instanceof Error && err.message === "location timeout";
      // If we already pushed a last-known location, don't overwrite with an
      // error — just leave the cache as-is.
      if (!cache) {
        notifyError(isTimeout ? "timeout" : "unknown");
      }
      return cache;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let backgroundTimeoutId: ReturnType<typeof setTimeout> | null = null;
let hookRefCount = 0;
let appStateSubscription: { remove: () => void } | null = null;

function scheduleBackgroundRefresh(): void {
  if (backgroundTimeoutId !== null) return;
  const msUntilStale =
    cacheTimestamp !== null
      ? Math.max(0, CACHE_TTL_MS - (Date.now() - cacheTimestamp))
      : 0;
  backgroundTimeoutId = setTimeout(async () => {
    backgroundTimeoutId = null;
    if (!inFlight) {
      await load();
    }
    if (hookRefCount > 0 && AppState.currentState === "active") {
      scheduleBackgroundRefresh();
    }
  }, msUntilStale);
}

function cancelBackgroundRefresh(): void {
  if (backgroundTimeoutId !== null) {
    clearTimeout(backgroundTimeoutId);
    backgroundTimeoutId = null;
  }
}

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === "active") {
    if (isCacheStale() && !inFlight) {
      load().then(() => {
        if (hookRefCount > 0) scheduleBackgroundRefresh();
      });
    } else {
      scheduleBackgroundRefresh();
    }
  } else {
    cancelBackgroundRefresh();
  }
}

function startBackgroundManager(): void {
  hookRefCount += 1;
  if (hookRefCount > 1) return;
  if (AppState.currentState === "active") {
    scheduleBackgroundRefresh();
  }
  appStateSubscription = AppState.addEventListener(
    "change",
    handleAppStateChange,
  );
}

function stopBackgroundManager(): void {
  hookRefCount -= 1;
  if (hookRefCount > 0) return;
  cancelBackgroundRefresh();
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

export function useCurrentLocation(): {
  location: CurrentLocation | null;
  loading: boolean;
  error: LocationError;
  refresh: () => Promise<void>;
} {
  const [location, setLocation] = useState<CurrentLocation | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache || isCacheStale());
  const [error, setError] = useState<LocationError>(lastError);

  useEffect(() => {
    listeners.add(setLocation);
    errorListeners.add(setError);
    startBackgroundManager();

    if (!cache || isCacheStale()) {
      setLoading(true);
      load().finally(() => setLoading(false));
    } else {
      setLocation(cache);
    }

    return () => {
      listeners.delete(setLocation);
      errorListeners.delete(setError);
      stopBackgroundManager();
    };
  }, []);

  return {
    location,
    loading,
    error,
    refresh: async () => {
      setLoading(true);
      await load(true);
      setLoading(false);
    },
  };
}

export function locationToPickup(loc: CurrentLocation): Place {
  return {
    label: loc.primary || "Current location",
    address: loc.address,
    lat: loc.lat,
    lng: loc.lng,
  };
}
