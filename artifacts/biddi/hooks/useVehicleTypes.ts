import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { api, getBaseUrl } from "@/lib/api";

/**
 * Resolve a vehicle-type icon URL so it always points at the rider app's
 * configured API host.
 *
 * - Relative path (starts with "/"): prepend the rider API base directly.
 * - Absolute URL whose pathname begins with "/api/storage": the URL was saved
 *   with an old admin origin baked in — rewrite only the origin so the path
 *   is served from the rider's current API base (handles domain changes and
 *   cross-host deployments).
 * - Any other absolute URL (external CDN, custom host, etc.): returned as-is
 *   so intentionally external images are never broken.
 */
function resolveIconUrl(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null;
  if (iconUrl.startsWith("/")) return `${getBaseUrl()}${iconUrl}`;
  try {
    const parsed = new URL(iconUrl);
    if (parsed.pathname.startsWith("/api/storage")) {
      return `${getBaseUrl()}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Not a valid URL — fall through and return as-is
  }
  return iconUrl;
}

export interface RemoteVehicleType {
  id: string;
  name: string;
  description?: string | null;
  classKey: string | null;
  classLabel: string | null;
  classColorHex: string | null;
  iconUrl: string | null;
  active: boolean;
  displayOrder: number;
  vehicleCategory?: "car" | "moto";
  personCapacity?: number;
  poolEnabled?: boolean;
  wheelchairAccess?: boolean;
  petFriendly?: boolean;
  assistAvailable?: boolean;
  baseFare?: number;
  pricePerKm?: number;
  pricePerMin?: number;
  minimumFare?: number;
  serviceAreaIds?: string[];
  fareModelStrategy?: "incremental" | "fixed";
  peakSurchargeEnabled?: boolean;
  peakSurchargeWindows?: Array<{
    days: number[];
    startTime: string;
    endTime: string;
    multiplier: number;
  }> | null;
  nightChargeEnabled?: boolean;
  nightChargeStart?: string | null;
  nightChargeEnd?: string | null;
  nightChargeMultiplier?: number;
}

/** Returns all active vehicle types (cached, no location filter). */
export async function getActiveVehicleTypes(): Promise<RemoteVehicleType[]> {
  const { data } = await fetchVehicleTypes();
  return data;
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function inWindow(at: Date, start: number, end: number): boolean {
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (end <= start) return minutes >= start || minutes < end;
  return minutes >= start && minutes < end;
}

function peakMul(vt: RemoteVehicleType, at: Date): number {
  if (!vt.peakSurchargeEnabled) return 1;
  const day = at.getDay();
  for (const w of vt.peakSurchargeWindows ?? []) {
    if (!w.days.includes(day)) continue;
    const s = parseHHMM(w.startTime);
    const e = parseHHMM(w.endTime);
    if (s == null || e == null) continue;
    if (inWindow(at, s, e)) return Math.max(1, Number(w.multiplier) || 1);
  }
  return 1;
}

function nightMul(vt: RemoteVehicleType, at: Date): number {
  if (!vt.nightChargeEnabled) return 1;
  const s = parseHHMM(vt.nightChargeStart);
  const e = parseHHMM(vt.nightChargeEnd);
  if (s == null || e == null) return 1;
  return inWindow(at, s, e) ? Math.max(1, vt.nightChargeMultiplier || 1) : 1;
}

/** Mirrors the server's `computeFareBreakdown` for client-side estimates.
 * Uses safe defaults for any pricing field the type omits. */
export function estimateFare(
  vt: RemoteVehicleType,
  distanceKm: number,
  durationMin: number,
  at: Date = new Date(),
): number {
  const safeKm = Math.max(0, distanceKm);
  const safeMin = Math.max(0, durationMin);
  const base = vt.baseFare ?? 0;
  const distance = safeKm * (vt.pricePerKm ?? 0);
  const time = safeMin * (vt.pricePerMin ?? 0);
  const baseSubtotal = base + distance + time;
  const peak = peakMul(vt, at);
  const night = nightMul(vt, at);
  const peakSurcharge = baseSubtotal * (peak - 1);
  const nightSurcharge = baseSubtotal * (night - 1);
  let total = baseSubtotal + peakSurcharge + nightSurcharge;
  const minFare = vt.minimumFare ?? 0;
  if (total < minFare) total = minFare;
  return Math.round(total * 10) / 10;
}

type FetchResult = { data: RemoteVehicleType[]; fetchError: boolean };

// Cache buckets keyed by location string. Using a tiny per-cell grid keeps
// nearby lookups cheap (rounded to ~1km) while still re-fetching when the
// rider moves into a new region.
const _inFlight = new Map<string, Promise<FetchResult>>();

function cellKey(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "all";
  }
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/** Cache TTL: entries older than this are considered stale and re-fetched. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Sentinel value stored in the cache to represent a fetch that failed with a
 *  network/server error, so we don't retry on every render but can still
 *  distinguish "empty list" from "error". */
const FETCH_ERROR = Symbol("FETCH_ERROR");

type CacheEntry = { value: RemoteVehicleType[] | typeof FETCH_ERROR; at: number };
const _cache = new Map<string, CacheEntry>();

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.at < CACHE_TTL_MS;
}

/** Clear all cached vehicle-type results (e.g. on app foreground resume). */
export function clearVehicleTypeCache(): void {
  _cache.clear();
  _inFlight.clear();
}

// Refresh the cache whenever the app returns to the foreground so riders
// always see vehicle categories that an admin changed while the app was backgrounded.
// The flag prevents duplicate subscriptions during dev hot-reload.
const _appStateListenerKey = "__vehicleTypesCacheListener__";
if (!(globalThis as Record<string, unknown>)[_appStateListenerKey]) {
  (globalThis as Record<string, unknown>)[_appStateListenerKey] = true;
  AppState.addEventListener("change", (nextState) => {
    if (nextState === "active") {
      clearVehicleTypeCache();
    }
  });
}

async function fetchVehicleTypes(
  lat?: number | null,
  lng?: number | null,
): Promise<FetchResult> {
  const key = cellKey(lat, lng);
  const cached = _cache.get(key);
  if (cached !== undefined && isCacheValid(cached)) {
    if (cached.value === FETCH_ERROR) return { data: [], fetchError: true };
    return { data: cached.value, fetchError: false };
  }
  const inflight = _inFlight.get(key);
  if (inflight) return inflight;

  const url =
    key === "all"
      ? "/vehicle-types"
      : `/vehicle-types?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`;

  const p = api<{ vehicleTypes: RemoteVehicleType[] }>(url)
    .then((r) => {
      const list = r.vehicleTypes ?? [];
      // Don't cache empty geo-filtered results — the server may just not have
      // matched any service area for this cell yet, and caching the empty list
      // would force an unnecessary fallback fetch on every subsequent render
      // within the TTL window.
      if (list.length > 0 || key === "all") {
        _cache.set(key, { value: list, at: Date.now() });
      }
      _inFlight.delete(key);
      return { data: list, fetchError: false } satisfies FetchResult;
    })
    .catch(() => {
      _cache.set(key, { value: FETCH_ERROR, at: Date.now() });
      _inFlight.delete(key);
      return { data: [] as RemoteVehicleType[], fetchError: true } satisfies FetchResult;
    });
  _inFlight.set(key, p);
  return p;
}

/** Returns a map of classKey → iconUrl for the active vehicle types
 *  configured in the admin panel. Falls back gracefully if the API
 *  is unavailable or a type has no icon set. */
export function useVehicleTypeIcons(): Record<string, string | null> {
  const [icons, setIcons] = useState<Record<string, string | null>>({});

  useEffect(() => {
    fetchVehicleTypes().then(({ data }) => {
      const map: Record<string, string | null> = {};
      for (const t of data) {
        if (t.classKey) map[t.classKey] = resolveIconUrl(t.iconUrl);
      }
      setIcons(map);
    });
  }, []);

  return icons;
}

/** Full vehicle-type list, optionally filtered server-side by the rider's
 *  current location so categories not offered in their service area are
 *  hidden. Returns an empty list while loading.
 *
 *  If the geo-filtered request returns zero results (e.g. the rider's
 *  coordinates fall outside every configured service area polygon), the hook
 *  automatically retries without a location filter so admin-configured types
 *  are always surfaced. Only returns empty when both fetches return nothing.
 *
 *  `error` is true only when both fetches fail (network/server error), allowing
 *  callers to distinguish "API reachable but no types configured" from
 *  "API is unreachable". */
export function useAvailableVehicleTypes(
  lat?: number | null,
  lng?: number | null,
): { types: RemoteVehicleType[]; loading: boolean; error: boolean } {
  const [types, setTypes] = useState<RemoteVehicleType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const hasLocation = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
    fetchVehicleTypes(lat, lng).then(async ({ data, fetchError }) => {
      if (cancelled) return;
      if ((data.length === 0 && hasLocation) || fetchError) {
        // Location-filtered result was empty or errored — retry without
        // location so admin-configured types always appear even when service
        // area polygons don't cover the rider's current position.
        const { data: allData, fetchError: allError } = await fetchVehicleTypes();
        if (cancelled) return;
        setTypes(allData.map((t) => ({ ...t, iconUrl: resolveIconUrl(t.iconUrl) })));
        setError(allError && allData.length === 0);
      } else {
        setTypes(data.map((t) => ({ ...t, iconUrl: resolveIconUrl(t.iconUrl) })));
        setError(false);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return { types, loading, error };
}
