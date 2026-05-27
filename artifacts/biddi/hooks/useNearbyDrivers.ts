import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fetchRoute } from "@/lib/maps";
import { connectSocket, getSocket } from "@/lib/socket";
import { useAuth } from "@/context/AppContext";

export interface NearbyDriver {
  id: string;
  vehicleCategory: "car" | "moto";
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
}

export type NearbySourceStatus = "loading" | "ready" | "empty" | "unavailable";

interface NearbyState {
  count: number;
  drivers: NearbyDriver[];
  loading: boolean;
  /**
   * High-level status of the nearby-driver pipeline:
   *  - "loading"      → initial data has not yet arrived
   *  - "ready"        → at least one driver is currently known
   *  - "empty"        → snapshot/fallback returned zero drivers
   *  - "unavailable"  → fallback fetch failed and the socket hasn't
   *                     produced any snapshot either, so we genuinely
   *                     don't know what's nearby
   */
  sourceStatus: NearbySourceStatus;
}

const NEARBY_RADIUS_KM = 5;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useNearbyDrivers(
  center?: { lat: number; lng: number } | null,
  active = true,
): NearbyState {
  const { user } = useAuth();
  const [state, setState] = useState<NearbyState>({
    count: 0,
    drivers: [],
    loading: false,
    sourceStatus: "loading",
  });
  const driversRef = useRef<Map<string, NearbyDriver>>(new Map());
  const centerRef = useRef(center);
  centerRef.current = center;
  const lastEmittedCenter = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!user || !active) return;

    // Clear stale markers immediately so the map is blank until the fresh
    // snapshot arrives, rather than briefly showing outdated driver positions.
    driversRef.current.clear();
    setState({ count: 0, drivers: [], loading: true, sourceStatus: "loading" });

    let cancelled = false;
    let joined = false;
    let firstDataReceived = false;
    let fallbackFailed = false;
    let socketSnapshotReceived = false;

    const computeSourceStatus = (driverCount: number): NearbySourceStatus => {
      if (!firstDataReceived) return "loading";
      if (driverCount > 0) return "ready";
      // No drivers known. If the only "data" we have is a failed fallback
      // and no socket snapshot has ever arrived, we genuinely don't know
      // what's nearby — surface that as unavailable instead of pretending
      // the area is empty.
      if (fallbackFailed && !socketSnapshotReceived) return "unavailable";
      return "empty";
    };

    // Only called once — clears the loading flag after the first real data
    // settle (snapshot or fallback fetch). Incremental update/offline events
    // do not touch loading so they cannot end the initial-load phase early.
    const markLoaded = () => {
      if (cancelled || firstDataReceived) return;
      firstDataReceived = true;
      setState((prev) => ({
        ...prev,
        loading: false,
        sourceStatus: computeSourceStatus(prev.drivers.length),
      }));
    };

    const updateDriversState = () => {
      if (cancelled) return;
      const drivers = Array.from(driversRef.current.values());
      setState((prev) => ({
        ...prev,
        count: drivers.length,
        drivers,
        sourceStatus: computeSourceStatus(drivers.length),
      }));
    };

    const handleSnapshot = (data: { drivers: NearbyDriver[] }) => {
      socketSnapshotReceived = true;
      driversRef.current.clear();
      for (const d of data.drivers ?? []) {
        driversRef.current.set(d.id, d);
      }
      markLoaded();
      updateDriversState();
    };

    const handleUpdate = (d: NearbyDriver) => {
      driversRef.current.set(d.id, d);
      updateDriversState();
    };

    const handleOffline = (data: { id: string }) => {
      driversRef.current.delete(data.id);
      updateDriversState();
    };

    const attachSocket = async () => {
      const sock = await connectSocket();
      if (!sock || cancelled) return;

      sock.on("nearby:snapshot", handleSnapshot);
      sock.on("nearby:driver_update", handleUpdate);
      sock.on("nearby:driver_offline", handleOffline);

      const c = centerRef.current;
      if (c) {
        sock.emit("nearby:join", { lat: c.lat, lng: c.lng, radiusKm: NEARBY_RADIUS_KM });
        lastEmittedCenter.current = { lat: c.lat, lng: c.lng };
      }
      // If center is null, skip emitting nearby:join entirely.
      // The center-watching effect will send nearby:join once the GPS fix arrives.
      joined = true;
    };

    const fetchFallback = async () => {
      try {
        const c = centerRef.current;
        const params = c
          ? `?lat=${c.lat}&lng=${c.lng}&radiusKm=${NEARBY_RADIUS_KM}`
          : "";
        const r = await api<{ count: number; drivers?: NearbyDriver[] }>(`/drivers/nearby${params}`);
        if (cancelled) return;
        const drivers = r.drivers ?? [];
        fallbackFailed = false;
        driversRef.current.clear();
        for (const d of drivers) driversRef.current.set(d.id, d);
        markLoaded();
        setState((prev) => ({
          ...prev,
          count: r.count ?? drivers.length,
          drivers,
          sourceStatus: computeSourceStatus(drivers.length),
        }));
      } catch {
        if (cancelled) return;
        // Fallback failed — record it so the consumer can show an
        // "unavailable" state when the socket also hasn't produced data,
        // and stop the loading indicator so the UI doesn't appear stuck.
        fallbackFailed = true;
        markLoaded();
        if (!socketSnapshotReceived) {
          setState((prev) => ({
            ...prev,
            sourceStatus: computeSourceStatus(prev.drivers.length),
          }));
        }
      }
    };

    fetchFallback();
    attachSocket();

    const refreshInterval = setInterval(fetchFallback, 30_000);

    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
      if (joined) {
        const sock = getSocket();
        if (sock) {
          sock.emit("nearby:leave");
          sock.off("nearby:snapshot", handleSnapshot);
          sock.off("nearby:driver_update", handleUpdate);
          sock.off("nearby:driver_offline", handleOffline);
        }
      }
      driversRef.current.clear();
      // Reset so the next activation treats the first center as a fresh join,
      // not an update_center (which would be a no-op on an unregistered socket).
      lastEmittedCenter.current = null;
    };
  }, [user, active]);

  // When the rider pans the map by more than 500m, update the socket
  // subscription so the server re-scopes which drivers are sent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    const lat = center?.lat;
    const lng = center?.lng;
    if (lat == null || lng == null) return;
    const last = lastEmittedCenter.current;
    if (last && haversineKm(last.lat, last.lng, lat, lng) < 0.5) return;
    lastEmittedCenter.current = { lat, lng };
    const sock = getSocket();
    if (sock?.connected) {
      if (!last) {
        // First real GPS fix after connecting with no center — nearby:join was
        // never sent, so the server has no subscription for this socket.
        // Send nearby:join now to register and receive the initial snapshot.
        sock.emit("nearby:join", { lat, lng, radiusKm: NEARBY_RADIUS_KM });
      } else {
        sock.emit("nearby:update_center", { lat, lng, radiusKm: NEARBY_RADIUS_KM });
      }
    }
  }, [center?.lat, center?.lng]);

  return state;
}

export function useNearbyDriverCount(): number {
  return useNearbyDrivers().count;
}

const CITY_SPEED_KMH = 30;

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Returns the estimated minutes to the closest nearby driver from `center`,
 * assuming an average city speed of 30 km/h.
 * Returns null when there is no valid center or no valid driver.
 * Drivers with non-finite or out-of-range coordinates are filtered out so
 * a single bad row from the server cannot poison the result.
 *
 * This is a synchronous straight-line estimate intended as a fallback for
 * `useClosestDriverEta`, which prefers real road-routing time when available.
 */
export function closestDriverEtaMinutes(
  center: { lat: number; lng: number } | null | undefined,
  drivers: NearbyDriver[],
): number | null {
  const closest = findClosestDriver(center, drivers);
  if (!closest) return null;
  const minutes = Math.round((closest.distanceKm / CITY_SPEED_KMH) * 60);
  if (!Number.isFinite(minutes)) return null;
  return Math.max(1, minutes);
}

function findClosestDriver(
  center: { lat: number; lng: number } | null | undefined,
  drivers: NearbyDriver[],
): { driver: NearbyDriver; distanceKm: number } | null {
  if (!center || !isValidCoordinate(center.lat, center.lng)) return null;
  let best: { driver: NearbyDriver; distanceKm: number } | null = null;
  for (const d of drivers) {
    if (!isValidCoordinate(d.lat, d.lng)) continue;
    const km = haversineKm(center.lat, center.lng, d.lat, d.lng);
    if (!Number.isFinite(km)) continue;
    if (!best || km < best.distanceKm) best = { driver: d, distanceKm: km };
  }
  return best;
}

// Re-route when the rider's pickup pin moves more than this many km.
const ETA_CENTER_RESYNC_KM = 0.15;
// Re-route when the closest driver moves more than this many km from the
// position last used to compute the route, even if their id is unchanged.
const ETA_DRIVER_RESYNC_KM = 0.2;
// Re-route at least this often so stale routes don't linger as the driver
// moves through traffic.
const ETA_MAX_AGE_MS = 25_000;

/**
 * Returns the ETA in minutes from the closest valid driver to `center`,
 * preferring real road-routing time from the maps service. Falls back to the
 * straight-line haversine estimate (`closestDriverEtaMinutes`) when:
 *   - no route has been fetched yet, or
 *   - the routing call fails / is unavailable.
 *
 * Routing requests are throttled: a new fetch is issued only when the closest
 * driver changes, the rider's center moves materially, the closest driver's
 * own position drifts materially, or the cached route ages past
 * `ETA_MAX_AGE_MS`.
 */
export function useClosestDriverEta(
  center: { lat: number; lng: number } | null | undefined,
  drivers: NearbyDriver[],
): number | null {
  const fallback = closestDriverEtaMinutes(center, drivers);
  const closest = findClosestDriver(center, drivers);
  const [routeMinutes, setRouteMinutes] = useState<{
    driverId: string;
    driverLat: number;
    driverLng: number;
    centerLat: number;
    centerLng: number;
    minutes: number;
    fetchedAt: number;
  } | null>(null);
  const inflightRef = useRef<{
    driverId: string;
    centerLat: number;
    centerLng: number;
  } | null>(null);

  useEffect(() => {
    if (!closest || !center || !isValidCoordinate(center.lat, center.lng)) {
      return;
    }
    const driver = closest.driver;
    const now = Date.now();

    // Decide whether the cached route is still good enough to keep.
    if (routeMinutes && routeMinutes.driverId === driver.id) {
      const centerDrift = haversineKm(
        routeMinutes.centerLat,
        routeMinutes.centerLng,
        center.lat,
        center.lng,
      );
      const driverDrift = haversineKm(
        routeMinutes.driverLat,
        routeMinutes.driverLng,
        driver.lat,
        driver.lng,
      );
      const fresh = now - routeMinutes.fetchedAt < ETA_MAX_AGE_MS;
      if (
        fresh &&
        centerDrift < ETA_CENTER_RESYNC_KM &&
        driverDrift < ETA_DRIVER_RESYNC_KM
      ) {
        return;
      }
    }

    // Avoid issuing duplicate requests for the same driver+center while one
    // is already in flight.
    const inflight = inflightRef.current;
    if (
      inflight &&
      inflight.driverId === driver.id &&
      Math.abs(inflight.centerLat - center.lat) < 1e-5 &&
      Math.abs(inflight.centerLng - center.lng) < 1e-5
    ) {
      return;
    }

    let cancelled = false;
    const driverLat = driver.lat;
    const driverLng = driver.lng;
    const centerLat = center.lat;
    const centerLng = center.lng;
    inflightRef.current = { driverId: driver.id, centerLat, centerLng };

    // Drop any previously-cached route for this driver as soon as routing
    // fails (or returns no route) so the UI falls back to the haversine
    // estimate instead of pinning a stale road-routed minute count during
    // an outage / missing-key scenario.
    const invalidateCacheForThisDriver = () => {
      if (cancelled) return;
      setRouteMinutes((prev) => (prev && prev.driverId === driver.id ? null : prev));
    };

    fetchRoute(
      { lat: driverLat, lng: driverLng },
      { lat: centerLat, lng: centerLng },
    )
      .then((route) => {
        if (cancelled) return;
        if (!route || !Number.isFinite(route.durationMin)) {
          invalidateCacheForThisDriver();
          return;
        }
        setRouteMinutes({
          driverId: driver.id,
          driverLat,
          driverLng,
          centerLat,
          centerLng,
          minutes: Math.max(1, Math.round(route.durationMin)),
          fetchedAt: Date.now(),
        });
      })
      .catch(() => {
        invalidateCacheForThisDriver();
      })
      .finally(() => {
        if (
          inflightRef.current &&
          inflightRef.current.driverId === driver.id &&
          inflightRef.current.centerLat === centerLat &&
          inflightRef.current.centerLng === centerLng
        ) {
          inflightRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    closest?.driver.id,
    closest?.driver.lat,
    closest?.driver.lng,
    center?.lat,
    center?.lng,
    routeMinutes,
  ]);

  // Drop a cached route the moment the closest driver changes so we don't
  // briefly show a stale ETA pinned to the previous driver.
  if (
    routeMinutes &&
    (!closest || routeMinutes.driverId !== closest.driver.id)
  ) {
    return fallback;
  }

  return routeMinutes?.minutes ?? fallback;
}
