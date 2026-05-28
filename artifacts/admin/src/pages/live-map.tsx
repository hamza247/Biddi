import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Navigation, Users, Car, Crosshair, CheckCircle2, Clock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import { connectAdminSocket, disconnectAdminSocket } from "@/lib/socket";
import {
  loadGoogleMaps,
  type GoogleMapsLoadResult,
} from "@/lib/google-maps-loader";
import { toast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const DEFAULT_CENTER: [number, number] = [31.79, -7.09];
const DEFAULT_ZOOM = 6;

// Distance from a ride's pickup coordinates within which a `driver_arriving`
// driver is considered "arrived at pickup" instead of "way to pickup".
// Kept generous to absorb GPS noise in dense city centres.
const ARRIVED_RADIUS_M = 75;

interface ActiveRide {
  id: string;
  driverId: string | null;
  riderName: string;
  driverName: string | null;
  status: string;
  pickup: { lat: number | null; lng: number | null; label: string };
  dropoff: { lat: number | null; lng: number | null; label: string };
}

interface OfflineDriver {
  id: string;
  name: string;
  phone?: string | null;
  vehicle: string | null;
  plate?: string | null;
  // lat/lng are nullable: the backend keeps drivers without plottable
  // coordinates in this list (so the unified driver list still shows them
  // with a "location unavailable" badge) and only the marker layer filters
  // them out.
  lat: number | null;
  lng: number | null;
  lastSeenAt: number;
}

interface LiveMapData {
  counts: {
    totalDrivers: number;
    onlineDrivers: number;
    activeRides: number;
    availableDrivers?: number;
  };
  activeRides: ActiveRide[];
  offlineDrivers?: OfflineDriver[];
  // REST snapshot of currently-live drivers (same shape as socket
  // `drivers:snapshot` entries). Used as initial seed and as a polling
  // fallback when the admin socket is disconnected.
  liveDrivers?: LiveDriver[];
}

interface LiveDriver {
  id: string;
  name: string;
  phone?: string | null;
  vehicle: string | null;
  plate?: string | null;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  lastSeenAt: number;
  rideStatus?: string | null;
  rideId?: string | null;
}

// Strict coordinate gate shared by the count, list, and marker pipelines so
// they never diverge. Rejects null/undefined/NaN, non-finite numbers,
// out-of-range values, and the (0,0) sentinel that occasionally leaks in
// from un-initialised GPS state on the device.
function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  const a = typeof lat === "string" ? Number(lat) : lat;
  const b = typeof lng === "string" ? Number(lng) : lng;
  if (typeof a !== "number" || typeof b !== "number") return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a < -90 || a > 90 || b < -180 || b > 180) return false;
  if (a === 0 && b === 0) return false;
  return true;
}

// Single normalisation point for any driver record we might receive — REST
// `liveDrivers`, REST `offlineDrivers`, socket `drivers:snapshot`, or socket
// `driver:location`. Returns `null` when coords are not plottable so callers
// can use the same gate for "renderable on the map" everywhere.
interface NormalizedDriver {
  id: string;
  name: string;
  phone: string | null;
  vehicle: string | null;
  plate: string | null;
  // Nullable so rows from any source can flow through the same pipeline
  // even when coords are missing or invalid; the marker layer is the
  // only place that gates on coordinate validity.
  lat: number | null;
  lng: number | null;
  heading?: number;
  lastSeenAt: number;
  rideStatus: string | null;
  rideId: string | null;
  plottable: boolean;
}

// Maps any backend/socket variant of a driver's status (rideStatus,
// driverOnline, etc.) to one of the five explicit map states. Centralised
// so the marker layer, the side list, and the counts can never disagree.
// Falls back to `available` for any unknown value when the driver is live,
// and `not_available` when they are not.
function resolveDriverState(input: {
  isLive: boolean;
  rideStatus: string | null | undefined;
  proximityArrived: boolean;
  isStale?: boolean;
}): DriverState {
  if (!input.isLive) return "not_available";
  // Stale takes priority over any live status — admins need to know the
  // pin position is no longer being refreshed even if the driver is
  // mid-trip. The popup keeps the underlying ride status visible via the
  // "Last update Xm ago" line so dispatchers can see what was happening
  // before the stream went quiet.
  if (input.isStale) return "stale";
  const s = (input.rideStatus ?? "").toLowerCase();
  if (s === "in_progress" || s === "in-progress" || s === "trip_in_progress" || s === "on_trip" || s === "on-trip") {
    return "way_to_dropoff";
  }
  if (s === "driver_arriving" || s === "driver-arriving" || s === "arriving" || s === "accepted" || s === "en_route" || s === "en-route") {
    return input.proximityArrived ? "arrived_pickup" : "way_to_pickup";
  }
  if (s === "arrived_pickup" || s === "arrived" || s === "at_pickup" || s === "at-pickup") {
    return "arrived_pickup";
  }
  return "available";
}

interface RawDriverShape {
  // Accept string, number, or null — Drizzle UUID columns come back as
  // strings, but defensive handling of numeric IDs prevents silent row
  // drops when the serialisation differs between code paths.
  id?: string | number | null;
  name?: string;
  phone?: string | null;
  vehicle?: string | null;
  plate?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  // Defensive aliases — different parts of the system have used different
  // field names historically; we map them all to a single shape.
  latitude?: number | string | null;
  longitude?: number | string | null;
  lastKnownLat?: number | string | null;
  lastKnownLng?: number | string | null;
  heading?: number;
  lastSeenAt?: number | null;
  lastKnownAt?: number | null;
  rideStatus?: string | null;
  rideId?: string | null;
}

function normalizeDriverForMap(raw: RawDriverShape | null | undefined): NormalizedDriver | null {
  // Only an unknown id means we have nothing to do with this row.
  // Coords missing/invalid → still return the row but with null lat/lng
  // and `plottable: false` so the side list can show it as "Location
  // unavailable" while the marker layer skips it.
  // Coerce numeric ids (e.g. from Drizzle integer PKs) to string so we
  // never silently drop a driver row just because its id type doesn't
  // match the socket-side string convention.
  if (!raw) return null;
  const rawId = raw.id;
  if (rawId === null || rawId === undefined) return null;
  const id = String(rawId);
  if (id.length === 0) return null;
  const lat = raw.lat ?? raw.latitude ?? raw.lastKnownLat ?? null;
  const lng = raw.lng ?? raw.longitude ?? raw.lastKnownLng ?? null;
  const numLat = typeof lat === "string" ? Number(lat) : lat;
  const numLng = typeof lng === "string" ? Number(lng) : lng;
  const plottable = isValidCoordinate(numLat, numLng);
  return {
    id,
    name: raw.name && raw.name.length > 0 ? raw.name : "Driver",
    phone: raw.phone ?? null,
    vehicle: raw.vehicle ?? null,
    plate: raw.plate ?? null,
    lat: plottable ? (numLat as number) : null,
    lng: plottable ? (numLng as number) : null,
    plottable,
    heading: typeof raw.heading === "number" && Number.isFinite(raw.heading) ? raw.heading : undefined,
    lastSeenAt: typeof raw.lastSeenAt === "number" ? raw.lastSeenAt : (typeof raw.lastKnownAt === "number" ? raw.lastKnownAt : Date.now()),
    rideStatus: raw.rideStatus ?? null,
    rideId: raw.rideId ?? null,
  };
}

const STATUS_COLORS: Record<string, string> = {
  bidding: "bg-blue-100 text-blue-700",
  driver_arriving: "bg-yellow-100 text-yellow-700",
  in_progress: "bg-green-100 text-green-700",
};

const PULSE_SPEEDS = [
  { label: "Slow", value: "slow", duration: "3s" },
  { label: "Normal", value: "normal", duration: "2s" },
  { label: "Fast", value: "fast", duration: "1s" },
] as const;
type PulseSpeed = (typeof PULSE_SPEEDS)[number]["value"];

// Five visual states a driver marker can be in. Order matters for the
// cluster colour priority — earlier entries take precedence over later ones
// when summarising a cluster of mixed states.
type DriverState =
  | "stale"
  | "arrived_pickup"
  | "way_to_dropoff"
  | "way_to_pickup"
  | "available"
  | "not_available";

const DEFAULT_STALE_THRESHOLD_SECONDS = 90;

interface DriverStateStyle {
  label: string;
  body: string;
  border: string;
  glass: string;
  cluster: string;
  clusterBorder: string;
}

const DRIVER_STATE_STYLES: Record<DriverState, DriverStateStyle> = {
  stale: {
    label: "Stale location",
    body: "#dc2626",
    border: "#7f1d1d",
    glass: "#fecaca",
    cluster: "#dc2626",
    clusterBorder: "#7f1d1d",
  },
  arrived_pickup: {
    label: "Arrived at pickup",
    body: "#f97316",
    border: "#7c2d12",
    glass: "#fed7aa",
    cluster: "#f97316",
    clusterBorder: "#9a3412",
  },
  way_to_dropoff: {
    label: "Way to drop-off",
    body: "#16a34a",
    border: "#14532d",
    glass: "#bbf7d0",
    cluster: "#16a34a",
    clusterBorder: "#14532d",
  },
  way_to_pickup: {
    label: "Way to pickup",
    body: "#facc15",
    border: "#713f12",
    glass: "#fef3c7",
    cluster: "#facc15",
    clusterBorder: "#854d0e",
  },
  available: {
    label: "Available",
    body: "#2563eb",
    border: "#1e3a8a",
    glass: "#bfdbfe",
    cluster: "#2563eb",
    clusterBorder: "#1d4ed8",
  },
  not_available: {
    label: "Not available",
    body: "#9ca3af",
    border: "#4b5563",
    glass: "#e5e7eb",
    cluster: "#9ca3af",
    clusterBorder: "#4b5563",
  },
};

// Cluster colour priority — when a cluster contains multiple states, pick
// the most "urgent" one so the admin's eye lands on it first.
const CLUSTER_STATE_PRIORITY: DriverState[] = [
  "stale",
  "arrived_pickup",
  "way_to_dropoff",
  "way_to_pickup",
  "available",
  "not_available",
];

// Google Maps JS loader lives in `@/lib/google-maps-loader` and is shared
// across all admin map surfaces.

// Haversine distance in metres. Used to decide whether a `driver_arriving`
// driver is close enough to the pickup point to be flagged "arrived".
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Build a cluster marker icon. Colour is driven by the dominant /
// most-urgent driver state in the cluster (priority order above), so
// admins immediately spot trip-critical clusters even when zoomed out.
// The "X on trip" sub-label still appears whenever any clustered driver
// is on a trip (way_to_pickup / arrived_pickup / way_to_dropoff).
function buildClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const markers = cluster.getAllChildMarkers() as Array<L.Marker & { __state?: DriverState }>;
  const total = markers.length;
  const stateCounts: Record<DriverState, number> = {
    stale: 0,
    arrived_pickup: 0,
    way_to_dropoff: 0,
    way_to_pickup: 0,
    available: 0,
    not_available: 0,
  };
  for (const m of markers) {
    const s = (m.__state ?? "available") as DriverState;
    stateCounts[s] = (stateCounts[s] ?? 0) + 1;
  }
  const onTripCount =
    stateCounts.arrived_pickup + stateCounts.way_to_dropoff + stateCounts.way_to_pickup;
  const dominant: DriverState =
    CLUSTER_STATE_PRIORITY.find((s) => stateCounts[s] > 0) ?? "available";
  const style = DRIVER_STATE_STYLES[dominant];

  const subLabel = onTripCount > 0
    ? `<div style="font-size:9px;font-weight:500;color:rgba(255,255,255,0.9);margin-top:1px">${onTripCount} on trip</div>`
    : "";

  const size = total < 10 ? 38 : total < 100 ? 44 : 50;
  const half = size / 2;

  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${style.cluster};border:2.5px solid ${style.clusterBorder};
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,0.35);
      font-family:system-ui,-apple-system,sans-serif;
      color:#fff;
    ">
      <div style="font-size:13px;font-weight:700;line-height:1">${total}</div>
      ${subLabel}
    </div>`,
    className: "biddi-cluster-icon",
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

const DEFAULT_DRIVER_ICON_SIZE = 40;

function buildDriverIcon(
  heading: number | undefined,
  state: DriverState,
  iconSize = DEFAULT_DRIVER_ICON_SIZE,
): L.DivIcon {
  const rot = typeof heading === "number" ? heading : 0;
  const style = DRIVER_STATE_STYLES[state];

  // The "available" state reuses the existing PNG marker so its richer
  // styling and pulse halo match what admins are used to.
  if (state === "available") {
    const sz = iconSize;
    const half = sz / 2;
    return L.divIcon({
      className: "biddi-live-driver-marker",
      iconSize: [sz, sz],
      iconAnchor: [half, half],
      html: `<div style="
        position:relative;
        width:${sz}px;height:${sz}px;
        overflow:visible;
      ">
        <div class="biddi-driver-pulse-ring"></div>
        <div style="
          width:${sz}px;height:${sz}px;
          transform:rotate(${rot}deg);
          transition:transform 600ms ease;
          filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));
        ">
          <img src="/admin/available-driver-marker.png" width="${sz}" height="${sz}" style="display:block;width:${sz}px;height:${sz}px;" />
        </div>
      </div>`,
    });
  }

  const isOffline = state === "not_available";
  const isStale = state === "stale";
  // Offline markers don't rotate (heading is stale) and are slightly smaller
  // and faded so they blend into the background but stay scannable.
  // Stale markers also freeze rotation (the heading hasn't been refreshed
  // either) and gain a soft pulsing red halo so they catch the eye even
  // among on-trip pins.
  const muted = isOffline ? "opacity:0.55;" : "";
  const haloHtml = isStale
    ? `<div class="biddi-driver-stale-halo" aria-hidden="true"></div>`
    : "";

  return L.divIcon({
    className: "biddi-live-driver-marker",
    iconSize: [22, 36],
    iconAnchor: [11, 18],
    html: `<div style="
      position:relative;
      width:22px;height:36px;
      transform:rotate(${isOffline || isStale ? 0 : rot}deg);
      transition:transform 600ms ease;
      filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));
      ${muted}
    ">${haloHtml}
      <svg viewBox="0 0 22 36" width="22" height="36" xmlns="http://www.w3.org/2000/svg">
        <rect x="0"  y="24" width="4" height="8" rx="1.5" fill="#374151"/>
        <rect x="18" y="24" width="4" height="8" rx="1.5" fill="#374151"/>
        <rect x="0"  y="4"  width="4" height="8" rx="1.5" fill="#374151"/>
        <rect x="18" y="4"  width="4" height="8" rx="1.5" fill="#374151"/>
        <rect x="3" y="1" width="16" height="34" rx="5" fill="${style.body}" stroke="${style.border}" stroke-width="1.5"/>
        <rect x="5" y="4"  width="12" height="7" rx="2" fill="${style.glass}"/>
        <rect x="5" y="25" width="12" height="6" rx="2" fill="${style.glass}"/>
        <rect x="5" y="13" width="12" height="10" rx="1" fill="${style.body}" stroke="${style.border}" stroke-width="0.8"/>
      </svg>
    </div>`,
  });
}

function formatAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function popupHtml(
  d: {
    id: string;
    name: string;
    phone?: string | null;
    vehicle: string | null;
    plate?: string | null;
    lastSeenAt: number;
    rideId?: string | null;
  },
  state: DriverState,
  trailShown = false,
): string {
  const ago = formatAgo(d.lastSeenAt);
  const styleLabel = DRIVER_STATE_STYLES[state].label;
  const stateLine =
    state === "not_available"
      ? `Not available — last seen ${ago}`
      : state === "stale"
        ? `Stale location — no GPS update for ${ago}`
        : styleLabel;
  const stateColor = DRIVER_STATE_STYLES[state].cluster;
  const vehicleLine = d.vehicle
    ? (d.plate ? `${d.vehicle} · ${d.plate}` : d.vehicle)
    : (d.plate ? `Plate ${d.plate}` : "Vehicle unknown");
  const phoneLine = d.phone
    ? `<div style="margin-top:2px;font-size:11px;color:#555"><a href="tel:${escapeHtml(d.phone)}" style="color:#2563eb;text-decoration:none">${escapeHtml(d.phone)}</a></div>`
    : "";
  // Action buttons. We render <a> tags so right-click → "open in new tab"
  // still works, but a delegated click handler on the map container
  // intercepts left clicks for client-side (wouter) navigation, avoiding a
  // full page reload. The "View ride" link only appears when this driver is
  // currently on a ride.
  const driverHref = `/drivers?open=${encodeURIComponent(d.id)}`;
  const rideHref = d.rideId ? `/rides?open=${encodeURIComponent(d.rideId)}` : null;
  const buttonStyle =
    "display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;line-height:1;cursor:pointer;border:none;";
  const primaryBtn = `background:#2563eb;color:#fff;border:1px solid #1d4ed8;${buttonStyle}`;
  const secondaryBtn = `background:#fff;color:#1f2937;border:1px solid #d1d5db;${buttonStyle}`;
  const trailBtnStyle = trailShown
    ? `background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;${buttonStyle}`
    : `background:#fff;color:#1f2937;border:1px solid #d1d5db;${buttonStyle}`;
  const rideBtn = rideHref
    ? `<a href="${escapeHtml(rideHref)}" data-biddi-nav="${escapeHtml(rideHref)}" style="${secondaryBtn}">View ride</a>`
    : "";
  const trailBtn = d.rideId
    ? `<button type="button" data-biddi-trail="${escapeHtml(d.id)}" style="${trailBtnStyle}">${trailShown ? "Hide trail" : "Show trail"}</button>`
    : "";
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;min-width:200px">
      <div style="font-weight:700;font-size:13px;color:#111">${escapeHtml(d.name)}</div>
      <div style="margin-top:2px;font-size:11px;color:#555">${escapeHtml(vehicleLine)}</div>
      ${phoneLine}
      <div style="margin-top:4px;font-size:11px;color:#777">Last update ${ago}</div>
      <div style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#111">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stateColor}"></span>
        ${escapeHtml(stateLine)}
      </div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
        <a href="${escapeHtml(driverHref)}" data-biddi-nav="${escapeHtml(driverHref)}" style="${primaryBtn}">View driver</a>
        ${rideBtn}
        ${trailBtn}
      </div>
    </div>
  `;
}

// Persistent label shown next to each marker so admins can see name and
// vehicle at a glance without clicking through to the popup. Includes a
// concise state line so the colour meaning is reinforced on hover.
function tooltipHtml(
  d: { name: string; vehicle: string | null; plate?: string | null; lastSeenAt: number },
  state: DriverState,
): string {
  const vehicleStr = d.vehicle
    ? (d.plate ? `${d.vehicle} · ${d.plate}` : d.vehicle)
    : (d.plate ? `Plate ${d.plate}` : "Vehicle unknown");
  const vehicle = escapeHtml(vehicleStr);
  const stateLabel =
    state === "not_available"
      ? `Not available · ${formatAgo(d.lastSeenAt)}`
      : state === "stale"
        ? `Stale · ${formatAgo(d.lastSeenAt)}`
        : DRIVER_STATE_STYLES[state].label;
  const stateColor = DRIVER_STATE_STYLES[state].cluster;
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;line-height:1.2">
    <div style="font-weight:600;color:#111">${escapeHtml(d.name)}</div>
    <div style="color:#555">${vehicle}</div>
    <div style="margin-top:2px;display:inline-flex;align-items:center;gap:4px;color:#333">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${stateColor}"></span>
      ${escapeHtml(stateLabel)}
    </div>
  </div>`;
}

// Animate a marker from its current position to the target over `duration` ms
// using requestAnimationFrame, instead of snapping. Cancels any in-flight
// slide for the same marker so back-to-back updates stay smooth.
type SlideMarker = L.Marker & { __slideRaf?: number };
function slideMarkerTo(
  marker: SlideMarker,
  target: [number, number],
  duration = 900,
): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") {
    marker.setLatLng(target);
    return;
  }
  if (marker.__slideRaf != null) {
    cancelAnimationFrame(marker.__slideRaf);
    marker.__slideRaf = undefined;
  }
  const startLatLng = marker.getLatLng();
  const fromLat = startLatLng.lat;
  const fromLng = startLatLng.lng;
  const dLat = target[0] - fromLat;
  const dLng = target[1] - fromLng;
  if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) {
    marker.setLatLng(target);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    marker.setLatLng([fromLat + dLat * e, fromLng + dLng * e]);
    if (t < 1) {
      marker.__slideRaf = requestAnimationFrame(step);
    } else {
      marker.__slideRaf = undefined;
    }
  };
  marker.__slideRaf = requestAnimationFrame(step);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function LiveMapPage() {
  const [, setLocation] = useLocation();
  // Highlighted driver row — set when admin clicks a map marker, cleared
  // on map click outside any marker. Used to scroll the panel row into
  // view and apply the active-row highlight style.
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const selectedDriverIdRef = useRef<string | null>(null);
  selectedDriverIdRef.current = selectedDriverId;
  // Panel list container ref — used to programmatically scroll a highlighted
  // row into view when the admin clicks a marker on the map.
  const listPanelRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "live-map"],
    queryFn: () => api<LiveMapData>("/admin/live-map"),
    refetchInterval: 10000,
  });

  const counts = data?.counts;
  const rides = useMemo(() => data?.activeRides ?? [], [data]);
  // Normalize REST-returned offline drivers through the same gate the rest
  // of the pipeline uses, so anything with bad coords is dropped before
  // count or marker logic runs. Keeps the count == markers invariant.
  const offlineDriversList = useMemo<NormalizedDriver[]>(() => {
    const raw = data?.offlineDrivers ?? [];
    const out: NormalizedDriver[] = [];
    for (const d of raw) {
      const n = normalizeDriverForMap(d);
      if (n) out.push(n);
    }
    return out;
  }, [data]);
  // Same for the REST-returned live driver snapshot. Used to seed the
  // socket-driven `drivers` map and as a polling fallback when the socket
  // is disconnected.
  const liveDriversFromRest = useMemo<NormalizedDriver[]>(() => {
    const raw = data?.liveDrivers ?? [];
    const out: NormalizedDriver[] = [];
    for (const d of raw) {
      const n = normalizeDriverForMap(d);
      if (n) out.push(n);
    }
    return out;
  }, [data]);

  // Index active rides by driverId so we can compute pickup proximity per
  // driver and reuse the richer rider/pickup labels in popups.
  const ridesByDriver = useMemo(() => {
    const m = new Map<string, ActiveRide>();
    for (const r of rides) if (r.driverId) m.set(r.driverId, r);
    return m;
  }, [rides]);

  // ---- map + tile settings ----
  // The base layer is standardized to Google Roadmap everywhere. We still
  // need TWO sources of truth for whether/how to load Google Maps:
  //   1. /admin/settings  — admin-only, returns `_hasSecrets` flags telling
  //      us whether a Google Maps web key is configured. The actual key
  //      VALUES are redacted server-side because they are listed in
  //      SECRET_KEYS.
  //   2. /config/public   — unauthenticated, returns the actual web Google
  //      Maps key (so client-rendered map surfaces can use it). Reading the
  //      key from /config/public avoids the redaction problem and matches
  //      what the rest of the app does (see biddi/lib/config.ts).
  interface LiveMapSettingsResponse {
    settings?: {
      driverIconSize?: number | null;
      driverStaleLocationThresholdSeconds?: number | null;
      liveMapDefaultLat?: number | null;
      liveMapDefaultLng?: number | null;
      liveMapDefaultZoom?: number | null;
      _hasSecrets?: Record<string, boolean>;
    };
  }
  interface PublicConfigResponse {
    googleMapsApiKeyWeb?: string | null;
  }
  const { data: settingsData, isError: settingsError } = useQuery<LiveMapSettingsResponse>({
    queryKey: ["/admin/settings"],
    queryFn: () => api<LiveMapSettingsResponse>("/admin/settings"),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: 1,
  });
  const { data: publicCfgData } = useQuery<PublicConfigResponse>({
    queryKey: ["/config/public"],
    queryFn: () => api<PublicConfigResponse>("/config/public"),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const settingsLoaded = settingsData !== undefined || settingsError;
  // The actual web key used to load Google Maps tiles, sourced from
  // /config/public (the admin settings endpoint redacts the value).
  // The fallback warning banner is keyed off this same value so the
  // condition always matches what the map actually did.
  const gmapsKey = useMemo(() => {
    const k = publicCfgData?.googleMapsApiKeyWeb || import.meta.env.VITE_GOOGLE_MAPS_API_KEY_WEB;
    return k ? k : null;
  }, [publicCfgData]);
  const hasGoogleKey = !!gmapsKey;

  const driverIconSize = useMemo(() => {
    const sz = settingsData?.settings?.driverIconSize;
    return typeof sz === "number" && sz >= 16 && sz <= 120 ? sz : DEFAULT_DRIVER_ICON_SIZE;
  }, [settingsData]);

  // Configurable threshold (seconds) — drivers whose lastSeenAt is older
  // than this get the "stale" warning state on the map and trigger a toast
  // for admins. Falls back to the default when the setting is missing or
  // out of bounds so admins can never accidentally disable the alarm.
  const staleThresholdMs = useMemo(() => {
    const raw = settingsData?.settings?.driverStaleLocationThresholdSeconds;
    const seconds =
      typeof raw === "number" && raw >= 30 && raw <= 110
        ? raw
        : DEFAULT_STALE_THRESHOLD_SECONDS;
    return seconds * 1000;
  }, [settingsData]);

  // Configured default map centre/zoom. Falls back to the Morocco defaults
  // when the admin has not set a value yet (matches the old hard-coded constant).
  const defaultMapCenter = useMemo<[number, number]>(() => {
    const lat = settingsData?.settings?.liveMapDefaultLat;
    const lng = settingsData?.settings?.liveMapDefaultLng;
    if (
      typeof lat === "number" && lat >= -90 && lat <= 90 &&
      typeof lng === "number" && lng >= -180 && lng <= 180
    ) {
      return [lat, lng];
    }
    return DEFAULT_CENTER;
  }, [settingsData]);

  const defaultMapZoom = useMemo(() => {
    const z = settingsData?.settings?.liveMapDefaultZoom;
    return typeof z === "number" && z >= 1 && z <= 18 ? z : DEFAULT_ZOOM;
  }, [settingsData]);

  // ---- live driver state (socket-driven, source of truth for the map) ----
  // Always holds NormalizedDriver records — every write goes through
  // `normalizeDriverForMap` so coords are pre-validated and field names are
  // homogenised. The list, counts, popup, and marker layer all consume this
  // single source.
  const [drivers, setDrivers] = useState<Map<string, NormalizedDriver>>(new Map());
  const driversRef = useRef(drivers);
  driversRef.current = drivers;
  // Tracks whether the admin socket is currently connected. When it is not,
  // the REST poller becomes the authoritative source — a `useEffect` below
  // re-seeds `drivers` from `liveDriversFromRest` on every poll. Once the
  // socket reconnects, the server auto-sends a fresh `drivers:snapshot` so
  // we hand control back to the realtime feed.
  const [socketConnected, setSocketConnected] = useState(false);
  // Timestamp of the most recent socket event or REST refresh. Surfaced as
  // a "Last updated …" hint so admins can tell at a glance whether the feed
  // is fresh.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // tick state used to:
  //  1. refresh all "X ago" relative-time labels (list panel "Last seen",
  //     map popup timestamps, status bar) without triggering a data re-fetch
  //  2. re-evaluate arrival proximity (way_to_pickup ↔ arrived_pickup)
  //     between socket location events
  // Any component that calls formatAgo() will produce a fresh value on every
  // render, and this state change re-renders the component every 5 s.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((v) => v + 1), 5000);
    return () => clearInterval(t);
  }, []);
  // Reactive snapshot of the current time, refreshed every tick.
  // Passing this into formatAgo() creates an explicit data dependency so
  // the list panel's "Last seen" labels update live without a data re-fetch.
  const now = useMemo(() => Date.now(), [nowTick]);

  // ---- offline driver toggle (default off to keep the map uncluttered) ----
  // The admin's preference is remembered across sessions in localStorage so
  // dispatchers who routinely want last-known pins don't have to re-enable
  // it after every refresh.
  const SHOW_OFFLINE_STORAGE_KEY = "biddi.liveMap.showOffline";
  const AUTO_ENABLED_OFFLINE_SESSION_KEY = "biddi.liveMap.autoEnabledOffline";
  const [showOffline, setShowOffline] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SHOW_OFFLINE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const persistShowOffline = useCallback((next: boolean) => {
    setShowOffline(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SHOW_OFFLINE_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // localStorage can throw in private mode / quota exhaustion — the
      // toggle still works for the current session, we just won't remember
      // the preference next time.
    }
  }, []);
  // Search box for the unified driver pipeline. The same query is applied
  // to the marker layer, the list panel, and the counts/footer so all
  // three views stay in lockstep. The online/offline split is driven by
  // the existing `Show offline drivers` toggle below — we deliberately do
  // not introduce additional filter chips here to stay within scope.
  const [driverListSearch, setDriverListSearch] = useState("");
  // Status filter chip for the side list. "all" keeps the existing behaviour
  // (everything that survives the showOffline + search filters); any other
  // value restricts the list, the markers, and the counts to that single
  // driver state so dispatchers can scope down to e.g. "way_to_pickup".
  const [driverListStatus, setDriverListStatus] = useState<DriverState | "all">("all");

  // ---- pickup-radius circle toggle (default on so admins can see why a
  // driver_arriving driver is or isn't flagged as "arrived"). ----
  const [showPickupCircles, setShowPickupCircles] = useState(true);

  // ---- google tiles failure tracking ----
  // Set to true when a Google Maps web key is configured but the JS API
  // failed to load OR `window.google.maps` was missing at addBase time, so
  // we ended up on the Carto Light fallback basemap. Drives a dismissible
  // banner telling admins their key is broken.
  const [googleTilesFailed, setGoogleTilesFailed] = useState(false);
  const [googleTilesFailureMessage, setGoogleTilesFailureMessage] = useState<string | null>(null);
  const [googleTilesWarningDismissed, setGoogleTilesWarningDismissed] = useState(false);
  // Reset the dismissed state whenever the key changes — a fresh attempt
  // deserves a fresh warning.
  useEffect(() => {
    setGoogleTilesFailed(false);
    setGoogleTilesFailureMessage(null);
    setGoogleTilesWarningDismissed(false);
  }, [gmapsKey]);

  // ---- map setup ----
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.Layer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  // One faint circle per active `driver_arriving` ride, keyed by ride id.
  // Lives on the base map (not in the cluster group) so it stays anchored
  // to its pickup point regardless of zoom / clustering behaviour.
  const pickupCirclesRef = useRef<Map<string, L.Circle>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  // ---- driver location trail ----
  // Keyed by driverId; polylines live directly on the base map (not in
  // the cluster group) so they stay anchored while the fleet moves.
  const trailPolylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  // React state mirrors the ref so dependent UI (panel row buttons, popup
  // trail toggle) re-renders when a trail is shown or cleared.
  const [trailDriverIds, setTrailDriverIds] = useState<Set<string>>(new Set());
  // Ref copy kept in sync so socket handlers can read current trail
  // membership without capturing a stale closure.
  const trailDriverIdsRef = useRef<Set<string>>(new Set());
  trailDriverIdsRef.current = trailDriverIds;

  const clearTrailForDriver = useCallback((driverId: string) => {
    const polyline = trailPolylinesRef.current.get(driverId);
    if (polyline) {
      polyline.remove();
      trailPolylinesRef.current.delete(driverId);
    }
    setTrailDriverIds((prev) => {
      if (!prev.has(driverId)) return prev;
      const next = new Set(prev);
      next.delete(driverId);
      return next;
    });
  }, []);

  const clearAllTrails = useCallback(() => {
    for (const polyline of trailPolylinesRef.current.values()) {
      polyline.remove();
    }
    trailPolylinesRef.current.clear();
    setTrailDriverIds(new Set());
  }, []);

  // Ref-wrapped version so socket-lifecycle closures can call it without
  // becoming stale.
  const clearTrailForDriverRef = useRef(clearTrailForDriver);
  clearTrailForDriverRef.current = clearTrailForDriver;

  const fetchAndShowTrail = useCallback(
    async (driverId: string) => {
      if (trailDriverIdsRef.current.has(driverId)) {
        clearTrailForDriver(driverId);
        return;
      }
      const map = mapRef.current;
      if (!map) return;
      try {
        const data = await api<{ points: Array<{ lat: number; lng: number; ts: number }>; rideId: string | null }>(
          `/admin/drivers/${encodeURIComponent(driverId)}/trail`,
        );
        const pts = (data.points ?? []).filter((p) => isValidCoordinate(p.lat, p.lng));
        if (pts.length < 2) {
          toast({
            title: "Trail not available",
            description: pts.length === 0
              ? "No GPS fixes have been recorded for this trip yet."
              : "Only one GPS fix recorded — need at least two points to draw a trail.",
          });
          return;
        }
        const latlngs = pts.map((p) => [p.lat, p.lng] as [number, number]);
        const polyline = L.polyline(latlngs, {
          color: "#2563eb",
          weight: 3,
          opacity: 0.7,
        });
        polyline.addTo(map);
        trailPolylinesRef.current.set(driverId, polyline);
        setTrailDriverIds((prev) => new Set([...prev, driverId]));
      } catch {
        toast({
          variant: "destructive",
          title: "Trail unavailable",
          description: "Could not load location history for this driver.",
        });
      }
    },
    [clearTrailForDriver, toast],
  );

  // Ref-wrapped so the delegated click handler and socket handlers can
  // call it without becoming stale.
  const fetchAndShowTrailRef = useRef(fetchAndShowTrail);
  fetchAndShowTrailRef.current = fetchAndShowTrail;

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !settingsLoaded) return;

    const currentKey = gmapsKey;
    const currentCenter = defaultMapCenter;
    const currentZoom = defaultMapZoom;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let transitionEndTarget: HTMLElement | null = null;
    let onTransitionEnd: ((e: Event) => void) | null = null;

    const addBase = (map: L.Map, useGoogle: boolean) => {
      // Defensive double-check: googleMutant silently produces an empty
      // gray grid if `window.google.maps` isn't loaded. Verify the global
      // is actually present before committing to the Google Roadmap layer;
      // otherwise fall back to the raw OSM tile server so the admin always
      // sees real tiles instead of a blank page. (MapTiler + CARTO were
      // intentionally removed from the maps stack.)
      const googleReady =
        typeof window !== "undefined" &&
        !!(window as unknown as { google?: { maps?: unknown } }).google?.maps;
      let googleAttached = false;
      if (useGoogle && googleReady) {
        try {
          const g = L.gridLayer.googleMutant({ type: "roadmap", maxZoom: 20 });
          (g as unknown as L.Layer).addTo(map);
          baseTileLayerRef.current = g as unknown as L.Layer;
          googleAttached = true;
        } catch (err) {
          setGoogleTilesFailed(true);
          setGoogleTilesFailureMessage((prev) =>
            prev ??
            `Google Maps tile layer failed to initialise (${(err as Error).message}) — showing a fallback basemap.`,
          );
        }
      }
      if (!googleAttached) {
        if (useGoogle && !googleReady) {
          setGoogleTilesFailed(true);
          setGoogleTilesFailureMessage((prev) =>
            prev ??
            "Google Maps loaded but the API global never became available — showing a fallback basemap.",
          );
        }
        const fallback = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            subdomains: "abc",
            maxZoom: 19,
          },
        );
        fallback.addTo(map);
        baseTileLayerRef.current = fallback;
      }
    };

    const doInit = async (useGoogle: boolean) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      (window as unknown as { L?: typeof L }).L = L;
      if (useGoogle) {
        const mod = await import("leaflet.gridlayer.googlemutant");
        // v0.16.0 ESM source registers the factory but forgets to attach the
        // class to L.GridLayer.GoogleMutant — do it ourselves so the factory
        // `L.gridLayer.googleMutant(...)` actually finds a constructor.
        (L.GridLayer as unknown as { GoogleMutant?: unknown }).GoogleMutant =
          mod.default;
      }
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      const container = mapContainerRef.current as HTMLDivElement & {
        _leaflet_id?: number;
      };
      // Guard against React invoking the effect twice (e.g. StrictMode) before
      // our local `mapRef` is populated. Leaflet stamps `_leaflet_id` on the
      // container the first time `L.map()` runs; calling it again throws
      // "Map container is already initialized." and leaves the user staring
      // at a blank grey map.
      if (container._leaflet_id != null) return;
      const map = L.map(container, {
        center: currentCenter,
        zoom: currentZoom,
        zoomControl: true,
      });
      if (cancelled) {
        map.remove();
        return;
      }
      addBase(map, useGoogle);
      const cg = L.markerClusterGroup({
        iconCreateFunction: buildClusterIcon,
        showCoverageOnHover: false,
        maxClusterRadius: 60,
        animate: true,
        zoomToBoundsOnClick: true,
      });
      cg.addTo(map);
      clusterGroupRef.current = cg;
      mapRef.current = map;
      // Force a size recompute once layout has settled so tiles paint into
      // the full 480px container (Leaflet caches container size on init and
      // can otherwise show a half-rendered grid).
      requestAnimationFrame(() => {
        if (!cancelled && mapRef.current === map) {
          map.invalidateSize();
        }
      });
      // Keep tiles filling the container whenever the browser window or any
      // surrounding panel is resized — Leaflet won't detect DOM size changes
      // on its own after the initial render.
      resizeObserver = new ResizeObserver(() => {
        if (mapRef.current === map) {
          map.invalidateSize();
        }
      });
      resizeObserver.observe(mapContainerRef.current!);
      // Call invalidateSize once more after any CSS transition finishes so
      // grey tile gaps don't appear on the trailing edge when a sliding
      // panel (ride detail, driver detail, cell panel) completes its
      // open/close animation. ResizeObserver fires during the transition
      // but Leaflet may mis-size if the settled dimensions differ from the
      // mid-animation snapshot it last read. Listening at the grid-wrapper
      // level (two levels up) catches transitionend events that bubble up
      // from both the map card and any sibling panel card.
      const gridWrapperEl =
        mapContainerRef.current!.parentElement?.parentElement ?? null;
      if (gridWrapperEl) {
        transitionEndTarget = gridWrapperEl as HTMLElement;
        onTransitionEnd = (e: Event) => {
          // Only re-measure for transitions that actually change geometry.
          // Colour/opacity/shadow transitions (the majority of hover effects
          // in the side panel) are cheap and don't affect tile layout, so
          // skipping them avoids unnecessary Leaflet churn.
          const prop = (e as TransitionEvent).propertyName ?? "";
          const geometryProps = ["width", "height", "max-width", "max-height",
            "min-width", "min-height", "flex", "flex-basis", "flex-grow",
            "flex-shrink", "grid-template-columns", "grid-template-rows",
            "padding", "margin", "transform", "left", "right", "top", "bottom"];
          if (!geometryProps.some((p) => prop === p || prop.startsWith(p + "-"))) return;
          if (mapRef.current === map) {
            map.invalidateSize({ animate: false });
          }
        };
        transitionEndTarget.addEventListener("transitionend", onTransitionEnd);
      }
      setMapReady(true);
    };

    if (currentKey) {
      loadGoogleMaps(currentKey)
        .then((result: GoogleMapsLoadResult) => {
          if (result.status === "ready") {
            doInit(true);
          } else {
            // Either auth failed (key rejected, referrer not allowed,
            // API not enabled, billing off) or the script itself failed
            // (network/CSP). Surface the specific reason so the admin
            // can self-serve the fix.
            setGoogleTilesFailed(true);
            setGoogleTilesFailureMessage(result.message);
            doInit(false);
          }
        })
        .catch(() => {
          setGoogleTilesFailed(true);
          setGoogleTilesFailureMessage(
            "Could not load the Google Maps JavaScript API.",
          );
          doInit(false);
        });
    } else {
      doInit(false);
    }

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (transitionEndTarget && onTransitionEnd) {
        transitionEndTarget.removeEventListener("transitionend", onTransitionEnd);
        transitionEndTarget = null;
        onTransitionEnd = null;
      }
      if (clusterGroupRef.current) {
        clusterGroupRef.current.clearLayers();
        clusterGroupRef.current = null;
      }
      markersRef.current.clear();
      // Tear down pickup-radius circles too — they live on the base map and
      // would otherwise leak when the map instance is recreated.
      for (const circle of pickupCirclesRef.current.values()) {
        circle.remove();
      }
      pickupCirclesRef.current.clear();
      // Tear down trail polylines — they also live on the base map.
      for (const polyline of trailPolylinesRef.current.values()) {
        polyline.remove();
      }
      trailPolylinesRef.current.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        baseTileLayerRef.current = null;
      }
      setMapReady(false);
    };
  }, [settingsLoaded, gmapsKey]);

  // ---- socket lifecycle ----
  // Listeners are registered exactly once per mount and cleaned up on
  // unmount so route changes / hot reloads can't accumulate duplicates.
  useEffect(() => {
    const sock = connectAdminSocket();
    if (!sock) return;

    setSocketConnected(sock.connected);

    const onSnapshot = (payload: { drivers: RawDriverShape[] }) => {
      const next = new Map<string, NormalizedDriver>();
      for (const raw of payload.drivers ?? []) {
        const n = normalizeDriverForMap(raw);
        if (n) next.set(n.id, n);
      }
      setDrivers(next);
      setLastUpdatedAt(Date.now());
    };
    const onLocation = (raw: RawDriverShape) => {
      const n = normalizeDriverForMap(raw);
      if (!n) return;
      setDrivers((prev) => {
        const next = new Map(prev);
        const existing = next.get(n.id);
        next.set(n.id, {
          ...existing,
          ...n,
          // Use the server's authoritative values for ride context.
          // entryToBroadcast always includes rideId/rideStatus (null when no
          // active ride), so no coalescing to the existing value — that
          // pattern would prevent auto-clear when a ride ends.
          rideStatus: n.rideStatus,
          rideId: n.rideId,
        });
        return next;
      });
      // Append new GPS fix to any active trail for this driver so the
      // polyline grows in real-time without additional fetches.
      if (n.lat != null && n.lng != null && trailDriverIdsRef.current.has(n.id)) {
        const polyline = trailPolylinesRef.current.get(n.id);
        if (polyline) {
          polyline.addLatLng([n.lat, n.lng]);
        }
      }
      setLastUpdatedAt(Date.now());
    };
    const onOffline = (payload: { id: string }) => {
      setDrivers((prev) => {
        if (!prev.has(payload.id)) return prev;
        const next = new Map(prev);
        next.delete(payload.id);
        return next;
      });
      // Clear trail when driver goes offline.
      clearTrailForDriverRef.current(payload.id);
      setLastUpdatedAt(Date.now());
    };
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onPushFailed = (payload: { rideId: string; driverId: string; errorCode: string }) => {
      toast({
        variant: "destructive",
        title: "Push notification failed",
        description: `Driver did not receive ride notification (${payload.errorCode}). Ride: ${payload.rideId.slice(0, 8)}… — manual intervention may be needed.`,
      });
    };

    sock.on("drivers:snapshot", onSnapshot);
    sock.on("driver:location", onLocation);
    sock.on("driver:offline", onOffline);
    sock.on("push:notification_failed", onPushFailed);
    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);

    return () => {
      sock.off("drivers:snapshot", onSnapshot);
      sock.off("driver:location", onLocation);
      sock.off("driver:offline", onOffline);
      sock.off("push:notification_failed", onPushFailed);
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
      disconnectAdminSocket();
    };
  }, [toast]);

  // ---- REST seed + polling fallback ----
  // The REST `/admin/live-map` payload includes a `liveDrivers` snapshot
  // built from the same in-memory `livePositions` the socket broadcasts
  // from. We use it as the authoritative source while the admin socket is
  // disconnected (so the map keeps refreshing every 10s instead of going
  // blank), and as the initial seed before the socket's snapshot arrives.
  // Once the socket reconnects, its `drivers:snapshot` event takes over and
  // this effect becomes a no-op for as long as that is true.
  useEffect(() => {
    if (!data) return;
    if (socketConnected && drivers.size > 0) return;
    setDrivers((prev) => {
      const next = new Map<string, NormalizedDriver>();
      for (const n of liveDriversFromRest) {
        // Prefer the most recent record per id — if the socket already
        // pushed something fresher, don't clobber it with a stale REST
        // payload. (Belt and suspenders: above guard already exits when
        // the socket is connected and has data.)
        const existing = prev.get(n.id);
        if (existing && existing.lastSeenAt > n.lastSeenAt) {
          next.set(n.id, existing);
        } else {
          next.set(n.id, n);
        }
      }
      return next;
    });
    setLastUpdatedAt(Date.now());
  }, [data, liveDriversFromRest, socketConnected, drivers.size]);

  // ---- resolve five-state visual model per driver ----
  // For live socket drivers: state derives from the ride status plus pickup
  // proximity. For offline DB drivers: always `not_available`.
  // Recomputed on every drivers / rides / nowTick / toggle change so that
  // proximity transitions (way_to_pickup ↔ arrived_pickup) appear without
  // waiting for the next location event.
  // ---- unified driver pipeline (single source of truth) ----
  // Step 1: `unifiedRows` — every driver we know about (live + offline,
  //         plottable or not) with a resolved 5-state value. Built from the
  //         socket-fed `drivers` Map for live entries and from the REST
  //         `offlineDrivers` payload for not-available entries.
  // Step 2: `filteredUnifiedRows` — applies the user's search query and
  //         status filter, plus the showOffline toggle.
  // Step 3: `markerEntries` — `filteredUnifiedRows` further restricted to
  //         rows with plottable coordinates (for the actual map layer).
  // Step 4: counts and the side list both read from `filteredUnifiedRows`
  //         directly, so the badge, the count card, the footer, the list,
  //         and the markers can never disagree.
  interface UnifiedDriverRow {
    id: string;
    name: string;
    phone: string | null;
    vehicle: string | null;
    plate: string | null;
    lat: number | null;
    lng: number | null;
    heading?: number;
    lastSeenAt: number;
    state: DriverState;
    rideId: string | null;
    plottable: boolean;
  }
  const unifiedRows = useMemo<UnifiedDriverRow[]>(() => {
    const rows: UnifiedDriverRow[] = [];
    const now = Date.now();
    for (const [id, d] of drivers) {
      // proximityArrived requires the driver to be plottable AND have a
      // pickup coord on the active ride; otherwise we leave the
      // way_to_pickup → arrived_pickup flip to wait for the next event.
      let proximityArrived = false;
      if (d.lat != null && d.lng != null && d.rideStatus === "driver_arriving") {
        const ride = ridesByDriver.get(id);
        if (ride && ride.pickup.lat != null && ride.pickup.lng != null) {
          const dist = distanceMeters(d.lat, d.lng, ride.pickup.lat, ride.pickup.lng);
          if (dist <= ARRIVED_RADIUS_M) proximityArrived = true;
        }
      }
      const isStale = now - d.lastSeenAt > staleThresholdMs;
      const state = resolveDriverState({
        isLive: true,
        rideStatus: d.rideStatus,
        proximityArrived,
        isStale,
      });
      rows.push({
        id,
        name: d.name,
        phone: d.phone,
        vehicle: d.vehicle,
        plate: d.plate,
        lat: d.lat,
        lng: d.lng,
        heading: d.heading,
        lastSeenAt: d.lastSeenAt,
        state,
        rideId: d.rideId ?? ridesByDriver.get(id)?.id ?? null,
        plottable: d.plottable,
      });
    }
    // Offline rows from the REST payload — kept in the list even when
    // coords are null (rendered with a "Location unavailable" badge).
    const live = new Set(drivers.keys());
    for (const o of data?.offlineDrivers ?? []) {
      if (live.has(o.id)) continue;
      const plottable = isValidCoordinate(o.lat, o.lng);
      rows.push({
        id: o.id,
        name: o.name,
        phone: o.phone ?? null,
        vehicle: o.vehicle,
        plate: o.plate ?? null,
        lat: plottable ? (o.lat as number) : null,
        lng: plottable ? (o.lng as number) : null,
        lastSeenAt: o.lastSeenAt,
        state: resolveDriverState({ isLive: false, rideStatus: null, proximityArrived: false }),
        rideId: null,
        plottable,
      });
    }
    rows.sort((a, b) => {
      const ao = a.state === "not_available" ? 1 : 0;
      const bo = b.state === "not_available" ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return b.lastSeenAt - a.lastSeenAt;
    });
    return rows;
  }, [drivers, ridesByDriver, data, nowTick, staleThresholdMs]);

  const filteredUnifiedRows = useMemo<UnifiedDriverRow[]>(() => {
    const q = driverListSearch.trim().toLowerCase();
    return unifiedRows.filter((d) => {
      // showOffline toggle hides not_available rows from EVERY surface
      // (markers, list, counts) so the toggle's behaviour is consistent.
      if (!showOffline && d.state === "not_available") return false;
      if (driverListStatus !== "all" && d.state !== driverListStatus) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.plate ?? "").toLowerCase().includes(q) ||
        (d.phone ?? "").toLowerCase().includes(q) ||
        (d.vehicle ?? "").toLowerCase().includes(q)
      );
    });
  }, [unifiedRows, driverListSearch, showOffline, driverListStatus]);

  // The marker layer consumes the same filtered list as the side panel,
  // restricted to rows we can actually plot. This is the only place in the
  // pipeline that gates on coordinate validity.
  interface MarkerEntry extends UnifiedDriverRow {
    lat: number;
    lng: number;
  }
  const markerEntries = useMemo<MarkerEntry[]>(() => {
    const out: MarkerEntry[] = [];
    for (const r of filteredUnifiedRows) {
      if (!r.plottable || r.lat == null || r.lng == null) continue;
      out.push({ ...r, lat: r.lat, lng: r.lng });
    }
    return out;
  }, [filteredUnifiedRows]);

  // ---- stale-driver alerting ----
  // Track which drivers are currently in the stale state so we only toast
  // on the leading edge (clean → stale). Using a ref keeps the effect
  // idempotent across re-renders without adding the set to React state
  // and risking infinite re-render loops.
  const staleDriverIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prev = staleDriverIdsRef.current;
    const next = new Set<string>();
    const justBecameStale: UnifiedDriverRow[] = [];
    for (const r of unifiedRows) {
      if (r.state === "stale") {
        next.add(r.id);
        if (!prev.has(r.id)) justBecameStale.push(r);
      }
    }
    if (justBecameStale.length > 0) {
      const thresholdSec = Math.round(staleThresholdMs / 1000);
      for (const r of justBecameStale) {
        const ago = formatAgo(r.lastSeenAt);
        toast({
          variant: "destructive",
          title: "Driver location not updating",
          description: `${r.name} — last GPS ping ${ago} (threshold ${thresholdSec}s). Pin position may be stale.`,
        });
      }
    }
    staleDriverIdsRef.current = next;
  }, [unifiedRows, staleThresholdMs]);

  // ---- auto-clear trails when a driver's active ride ends ----
  // Runs whenever the drivers map updates. If a driver with an active
  // trail no longer has a rideId (ride completed or cancelled), the trail
  // is removed automatically so stale paths don't persist on the map.
  useEffect(() => {
    for (const driverId of trailDriverIdsRef.current) {
      const driver = drivers.get(driverId);
      if (!driver || !driver.rideId) {
        clearTrailForDriverRef.current(driverId);
      }
    }
  }, [drivers]);

  // ---- pulse animation speed ----
  const [pulseSpeed, setPulseSpeed] = useState<PulseSpeed>("normal");

  useEffect(() => {
    const duration = PULSE_SPEEDS.find((s) => s.value === pulseSpeed)?.duration ?? "2s";
    document.documentElement.style.setProperty("--biddi-pulse-duration", duration);
  }, [pulseSpeed]);

  // ---- reconcile markers with the resolved entry list ----
  useEffect(() => {
    if (!mapReady) return;
    const cg = clusterGroupRef.current;
    if (!cg) return;

    type StatefulMarker = SlideMarker & { __state?: DriverState };
    const markers = markersRef.current as Map<string, StatefulMarker>;
    const wantedIds = new Set(markerEntries.map((e) => e.id));

    // Remove markers for drivers no longer in the resolved set (offline
    // toggle off, driver disconnected, etc).
    for (const [id, marker] of markers) {
      if (!wantedIds.has(id)) {
        cg.removeLayer(marker);
        markers.delete(id);
      }
    }

    for (const e of markerEntries) {
      const icon = buildDriverIcon(e.heading, e.state, driverIconSize);
      const popup = popupHtml(e, e.state, trailDriverIds.has(e.id));
      const tooltip = tooltipHtml(e, e.state);
      let marker = markers.get(e.id);
      if (!marker) {
        marker = L.marker([e.lat, e.lng], { icon }) as StatefulMarker;
        marker.__state = e.state;
        marker.bindPopup(popup);
        marker.bindTooltip(tooltip, {
          permanent: true,
          direction: "top",
          offset: [0, -16],
          className: "biddi-live-driver-label",
          opacity: 0.95,
        });
        // Clicking the marker selects the corresponding panel row so admins
        // can jump to the driver's detail without scrolling manually.
        marker.on("click", () => { setSelectedDriverId(e.id); });
        cg.addLayer(marker);
        markers.set(e.id, marker);
      } else {
        marker.__state = e.state;
        slideMarkerTo(marker, [e.lat, e.lng]);
        marker.setIcon(icon);
        const pop = marker.getPopup();
        if (pop) pop.setContent(popup);
        const tt = marker.getTooltip();
        if (tt) tt.setContent(tooltip);
      }
    }

    cg.refreshClusters();
  }, [markerEntries, mapReady, driverIconSize, trailDriverIds]);

  // ---- auto-fit viewport to the fleet ----
  // The map is initialised on a country-wide Morocco view so first paint
  // always renders something sensible, but that view leaves drivers as
  // unreadable specks (or off-screen entirely when the fleet is concentrated
  // in one city — see the original screenshot showing 2 drivers but a fully
  // empty Morocco-wide map). To keep available drivers always visible, we:
  //   1. Compute bounds from ONLINE drivers only (state !== "not_available")
  //      so stale offline markers can't pull the viewport outward when the
  //      "Show offline drivers" toggle is on.
  //   2. Auto-fit whenever any online driver is outside the current viewport
  //      (newly online, moved out of frame, or first batch arriving) — but
  //      only until the admin manually pans / zooms / scrolls inside the
  //      map. After that we stop auto-fitting so we don't yank them away
  //      from a city they're investigating.
  //   3. Reset the "user interacted" flag on every map (re)creation —
  //      e.g. tile-provider switch — and on explicit Recenter clicks, so
  //      auto-tracking resumes naturally.

  // Online-driver bounds. Recomputed any time the fleet positions or
  // composition change. Returns null when no online drivers exist so we
  // don't fit to an empty/invalid bounds.
  const onlineDriverBounds = useMemo<L.LatLngBounds | null>(() => {
    const pts: [number, number][] = [];
    for (const e of markerEntries) {
      if (e.state !== "not_available") pts.push([e.lat, e.lng]);
    }
    if (pts.length === 0) return null;
    const b = L.latLngBounds(pts);
    return b.isValid() ? b : null;
  }, [markerEntries]);

  // Tracks whether the admin has manually engaged with the map. Listens for
  // pointerdown / wheel / keydown on the Leaflet container so we capture
  // dragging, zoom-button clicks, scroll-wheel zoom, and keyboard nav. Our
  // own programmatic fitBounds calls do not trigger any of these events, so
  // no extra "is this our move?" flag is required.
  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (!mapReady) return;
    // Fresh map instance → reset the interaction flag so auto-fit resumes.
    userInteractedRef.current = false;
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    const markInteracted = () => {
      userInteractedRef.current = true;
    };
    container.addEventListener("pointerdown", markInteracted);
    container.addEventListener("wheel", markInteracted, { passive: true });
    container.addEventListener("keydown", markInteracted);
    return () => {
      container.removeEventListener("pointerdown", markInteracted);
      container.removeEventListener("wheel", markInteracted);
      container.removeEventListener("keydown", markInteracted);
    };
  }, [mapReady]);

  // Auto-fit when the online fleet has any driver outside the current
  // viewport. We compare against `map.getBounds()` so we only re-fit when
  // strictly necessary — small position deltas inside the viewport keep
  // the existing zoom / center for a stable, jank-free experience.
  useEffect(() => {
    if (!mapReady) return;
    if (userInteractedRef.current) return;
    const map = mapRef.current;
    if (!map || !onlineDriverBounds) return;
    if (map.getBounds().contains(onlineDriverBounds)) return;
    map.fitBounds(onlineDriverBounds, {
      padding: [60, 60],
      maxZoom: 14,
      animate: false,
    });
  }, [onlineDriverBounds, mapReady]);

  // Manual recenter — re-fits to the online fleet on demand. Excludes
  // offline drivers for the same reason auto-fit does (the priority target
  // is available / on-trip drivers). Resets the interaction flag so the
  // auto-fit effect resumes tracking the fleet afterwards. Falls back to
  // the country-wide default when no driver is online so the button is
  // always meaningful.
  const recenterOnFleet = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    userInteractedRef.current = false;
    if (!onlineDriverBounds) {
      map.setView(defaultMapCenter, defaultMapZoom);
      return;
    }
    map.fitBounds(onlineDriverBounds, { padding: [60, 60], maxZoom: 14 });
  }, [onlineDriverBounds, defaultMapCenter, defaultMapZoom]);

  // ---- reconcile pickup-radius circles for active driver_arriving rides ----
  // Renders one translucent circle per ride sized to ARRIVED_RADIUS_M so
  // admins can visually verify why a driver is (or isn't) flagged "arrived".
  // Circles disappear automatically once the ride leaves driver_arriving
  // (e.g. transitions to in_progress or completes), or when the toggle is
  // turned off.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const circles = pickupCirclesRef.current;

    const wantedIds = new Set<string>();
    if (showPickupCircles) {
      for (const r of rides) {
        if (
          r.status === "driver_arriving" &&
          r.pickup.lat != null &&
          r.pickup.lng != null
        ) {
          wantedIds.add(r.id);
        }
      }
    }

    // Drop any circles for rides that are no longer active in driver_arriving
    // state (or all of them when the toggle is off).
    for (const [id, circle] of circles) {
      if (!wantedIds.has(id)) {
        circle.remove();
        circles.delete(id);
      }
    }

    if (!showPickupCircles) return;

    for (const r of rides) {
      if (
        r.status !== "driver_arriving" ||
        r.pickup.lat == null ||
        r.pickup.lng == null
      ) {
        continue;
      }
      const center: [number, number] = [r.pickup.lat, r.pickup.lng];
      const existing = circles.get(r.id);
      if (existing) {
        // Pickup coordinates rarely change for a given ride, but reposition
        // defensively in case the dispatcher edits the pickup mid-flight.
        const ll = existing.getLatLng();
        if (ll.lat !== center[0] || ll.lng !== center[1]) {
          existing.setLatLng(center);
        }
        if (existing.getRadius() !== ARRIVED_RADIUS_M) {
          existing.setRadius(ARRIVED_RADIUS_M);
        }
      } else {
        const circle = L.circle(center, {
          radius: ARRIVED_RADIUS_M,
          color: DRIVER_STATE_STYLES.arrived_pickup.body,
          weight: 1.5,
          opacity: 0.7,
          fillColor: DRIVER_STATE_STYLES.arrived_pickup.body,
          fillOpacity: 0.12,
          interactive: false,
        });
        circle.addTo(map);
        circles.set(r.id, circle);
      }
    }
  }, [rides, mapReady, showPickupCircles]);

  // Delegate clicks on the in-popup "View driver" / "View ride" links to
  // wouter so navigation stays client-side (no full page reload). Anchors
  // are still rendered with real `href`s so the browser's "open in new
  // tab" / middle-click flow keeps working. Listening on `document` (in
  // capture phase) is the simplest way to catch clicks inside Leaflet
  // popup panes, which are mounted outside the map container.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      // Let modifier-clicks and non-primary buttons fall through to the
      // browser so users can open links in a new tab/window normally.
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) {
        return;
      }
      const target = ev.target as Element | null;
      if (!target) return;
      // Handle "Show trail" / "Hide trail" buttons in marker popups.
      const trailEl = target.closest("[data-biddi-trail]") as HTMLElement | null;
      if (trailEl) {
        const driverId = trailEl.getAttribute("data-biddi-trail");
        if (driverId) {
          ev.preventDefault();
          ev.stopPropagation();
          void fetchAndShowTrailRef.current(driverId);
          return;
        }
      }
      const navEl = target.closest("[data-biddi-nav]") as HTMLElement | null;
      if (!navEl) return;
      const href = navEl.getAttribute("data-biddi-nav");
      if (!href) return;
      ev.preventDefault();
      setLocation(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [setLocation]);

  // The map count is the source of truth; if it differs from the API stat,
  // prefer the live count. Derived from `markerEntries` so the badge,
  // stat card, and rendered markers can never disagree — they all flow
  // from the same normalized → coord-validated pipeline.
  // All counts come from the same filtered pipeline as the markers and
  // the side list, so the stat card / footer / list / markers can never
  // disagree under the current search and showOffline toggle.
  //   - `onlineDriversDisplay`: live (non-offline) drivers in the
  //     filtered list, regardless of plottability — used by the "Online
  //     Drivers" stat card.
  //   - `onMapCount`: number of markers actually rendered on the map —
  //     used by the bottom-left footer so it ALWAYS matches what the
  //     admin can see (including offline markers when the toggle is on).
  //   - `unplottableCount`: live drivers in the filtered list whose
  //     coords are missing/invalid; rendered as a "(N no coords)" hint
  //     in the footer.
  const onlineDriversDisplay = useMemo(
    () => filteredUnifiedRows.filter((r) => r.state !== "not_available").length,
    [filteredUnifiedRows],
  );
  const onMapCount = markerEntries.length;
  const unplottableCount = useMemo(
    () => filteredUnifiedRows.filter((r) => r.state !== "not_available" && !r.plottable).length,
    [filteredUnifiedRows],
  );
  // When the API reports approved drivers but our normalized pipeline
  // produced zero plottable LIVE rows (regardless of filters), surface
  // the gap explicitly so admins know the difference between "really
  // empty fleet" and "drivers exist but none are streaming a usable
  // live location right now". We deliberately exclude offline rows
  // (state === "not_available") from this check — otherwise the hint
  // (and its "Show last-known positions" CTA) would disappear in the
  // exact case it is meant to address: live feed empty, last-known
  // pins available. We gate on the unfiltered `unifiedRows` to avoid
  // firing when the admin merely filtered everything out via the
  // status chip or search box.
  const anyLivePlottable = useMemo(
    () => unifiedRows.some((r) => r.plottable && r.state !== "not_available"),
    [unifiedRows],
  );
  // Offline-driver bounds — only computed when there are no live plottable
  // drivers, so the fallback auto-fit can pan to last-known positions without
  // competing with the live-driver auto-fit effect. Declared after
  // `anyLivePlottable` so the dependency is always in scope.
  const offlineDriverBounds = useMemo<L.LatLngBounds | null>(() => {
    if (anyLivePlottable) return null; // live auto-fit takes precedence
    const pts: [number, number][] = [];
    for (const d of offlineDriversList) {
      if (d.plottable && d.lat != null && d.lng != null) {
        pts.push([d.lat, d.lng]);
      }
    }
    if (pts.length === 0) return null;
    const b = L.latLngBounds(pts);
    return b.isValid() ? b : null;
  }, [offlineDriversList, anyLivePlottable]);

  // Fallback auto-fit for offline (last-known) markers. Fires when:
  //   - no live plottable drivers exist (online auto-fit would no-op), AND
  //   - the admin has showOffline enabled (auto-enabled or manually), AND
  //   - the offline markers' bounding box is not already visible.
  // This ensures that when the auto-enable fires (or the admin manually
  // reveals last-known positions) the viewport immediately pans to the
  // driver cluster instead of staying on the country-wide default.
  // Placed after `offlineDriverBounds` declaration to satisfy TS ordering.
  useEffect(() => {
    if (!mapReady) return;
    if (userInteractedRef.current) return;
    if (!showOffline) return;
    const map = mapRef.current;
    if (!map || !offlineDriverBounds) return;
    if (map.getBounds().contains(offlineDriverBounds)) return;
    map.fitBounds(offlineDriverBounds, {
      padding: [60, 60],
      maxZoom: 14,
      animate: false,
    });
  }, [offlineDriverBounds, mapReady, showOffline]);

  // Number of offline drivers that DO have a valid last-known coordinate.
  // Drives the inline "Show last-known positions" action, the one-time
  // auto-enable below, AND the noLiveLocationHint suppression — all three
  // only make sense when there's something for the offline toggle to reveal.
  const offlinePlottableCount = useMemo(
    () => offlineDriversList.filter((d) => d.plottable).length,
    [offlineDriversList],
  );
  const noLiveLocationHint = useMemo(() => {
    if (anyLivePlottable) return null;
    // When offline drivers have valid last-known coordinates the admin map
    // already shows those pins (or can with one toggle click). Suppress the
    // "none sharing live location" banner — show the dedicated offline
    // banner instead so the CTA is more actionable.
    if (offlinePlottableCount > 0) return null;
    const total = counts?.totalDrivers ?? 0;
    const online = counts?.onlineDrivers ?? 0;
    if (total === 0) return null;
    if (online > 0) {
      return `${online} driver${online === 1 ? "" : "s"} online — no valid GPS coordinates received yet. The driver app may not have sent a first position.`;
    }
    // Total drivers exist but none are online and none have last-known coords.
    return `${total} approved driver${total === 1 ? "" : "s"} found, but none are currently online or have shared a location.`;
  }, [anyLivePlottable, offlinePlottableCount, counts]);
  // Auto-enable `showOffline` exactly once per browser session when the
  // map is empty of live drivers but offline last-known pins are
  // available. We gate on sessionStorage so we don't override the admin
  // if they later turn it back off — they'll still see the inline action
  // button to re-enable it on demand.
  // NOTE: this intentionally does NOT depend on `noLiveLocationHint` — that
  // value is suppressed when offlinePlottableCount > 0 (so the banner stays
  // quiet), but the auto-enable should still fire in exactly that case.
  const shouldAutoEnableOffline = !anyLivePlottable && offlinePlottableCount > 0;
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!shouldAutoEnableOffline) return;
    if (showOffline) return;
    try {
      if (window.sessionStorage.getItem(AUTO_ENABLED_OFFLINE_SESSION_KEY) === "1") return;
      window.sessionStorage.setItem(AUTO_ENABLED_OFFLINE_SESSION_KEY, "1");
    } catch {
      // sessionStorage unavailable — skip auto-enable to avoid an
      // infinite re-enable loop if the admin toggles it off.
      return;
    }
    // Auto-enable for this session only — we deliberately do NOT
    // persist this to localStorage. Only an explicit user toggle
    // (checkbox, status filter, or the "Show last-known positions"
    // button) should change their saved preference.
    setShowOffline(true);
  }, [shouldAutoEnableOffline, showOffline]);
  const lastUpdatedLabel = lastUpdatedAt
    ? `Last updated ${formatAgo(lastUpdatedAt)}`
    : "Waiting for first update…";

  // Scroll the highlighted side-panel row into view whenever selectedDriverId
  // changes. Uses a small delay so React finishes the render cycle first
  // (the row needs its new data-driver-selected attribute before scrollIntoView
  // can target it).
  useEffect(() => {
    if (!selectedDriverId) return;
    const frame = requestAnimationFrame(() => {
      const row = listPanelRef.current?.querySelector(`[data-driver-id="${CSS.escape(selectedDriverId)}"]`);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedDriverId]);

  // Map click (outside any marker) clears the side-panel highlight so the
  // admin doesn't have a "ghost" selection when they pan away from a driver.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const clearSelection = () => {
      if (selectedDriverIdRef.current !== null) setSelectedDriverId(null);
    };
    map.on("click", clearSelection);
    return () => {
      map.off("click", clearSelection);
    };
  }, [mapReady]);

  // Pan/zoom the map to a row and open its popup. Used by the list panel.
  const focusDriverOnMap = useCallback((row: UnifiedDriverRow) => {
    if (!row.plottable || row.lat == null || row.lng == null) return;
    const map = mapRef.current;
    if (!map) return;
    map.setView([row.lat, row.lng], Math.max(map.getZoom(), 15));
    const marker = markersRef.current.get(row.id);
    if (marker) {
      const cg = clusterGroupRef.current;
      // markercluster zoomToShowLayer ensures the marker is unfolded out
      // of any cluster before we try to open its popup.
      if (cg && (cg as unknown as { zoomToShowLayer?: (l: L.Layer, cb: () => void) => void }).zoomToShowLayer) {
        (cg as unknown as { zoomToShowLayer: (l: L.Layer, cb: () => void) => void }).zoomToShowLayer(
          marker,
          () => marker.openPopup(),
        );
      } else {
        marker.openPopup();
      }
    }
  }, []);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">God's View</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time fleet and ride overview — driver positions stream live, stats refresh every 10 s
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 mt-1">
          <Clock className="w-3.5 h-3.5" />
          <span>{lastUpdatedLabel}</span>
        </div>
      </div>

      {/* Stats row — 4 cards (2×2 on mobile, 4×1 on lg+) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: "Total Drivers",
            value: counts?.totalDrivers,
            icon: Users,
            iconColor: "text-blue-600",
            iconBg: "bg-blue-50",
            live: false,
          },
          {
            label: "Online Drivers",
            value: onlineDriversDisplay,
            icon: Navigation,
            iconColor: "text-green-600",
            iconBg: "bg-green-50",
            live: true,
          },
          {
            label: "Available Drivers",
            value: counts?.availableDrivers,
            icon: CheckCircle2,
            iconColor: "text-emerald-600",
            iconBg: "bg-emerald-50",
            live: false,
            tooltip: "Approved + online + no active ride",
          },
          {
            label: "Active Rides",
            value: counts?.activeRides,
            icon: Car,
            iconColor: "text-purple-600",
            iconBg: "bg-purple-50",
            live: false,
          },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${c.iconBg}`}>
              <c.icon className={`w-4 h-4 ${c.iconColor}`} />
            </div>
            <p className="text-xs text-muted-foreground leading-snug" title={"tooltip" in c && c.tooltip ? c.tooltip : undefined}>
              {c.label}
            </p>
            {isLoading && !c.live ? (
              <Skeleton className="h-8 w-12 mt-1" />
            ) : (
              <p className="text-3xl font-bold mt-1 tabular-nums">{c.value ?? 0}</p>
            )}
          </div>
        ))}
      </div>

      {/* Live map + driver side panel.
          On large screens the searchable driver list sits beside the map at
          matching height so dispatchers can scan the fleet and click through
          to a marker without scrolling. On smaller screens it stacks below
          the map. */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4 mb-6">
      <div className="rounded-lg border bg-card overflow-hidden relative">
        {!settingsLoaded && (
          <div className="absolute inset-0 z-10 bg-background/60 flex items-center justify-center">
            <Skeleton className="h-8 w-32" />
          </div>
        )}
        <div ref={mapContainerRef} style={{ height: "calc(max(560px, min(100vh - 320px, 720px)))", width: "100%" }} />

        {/* Legend + offline toggle. Offset down from the top-left corner so
            it clears Leaflet's default zoom (+/−) control, which sits in the
            same corner. */}
        <div className="absolute top-3 left-[54px] z-[500] bg-white/95 rounded-md shadow px-3 py-2 max-w-[210px]">
          <div className="text-[11px] font-semibold text-gray-700 mb-1.5">Driver state</div>
          <ul className="space-y-1 mb-2">
            {(
              [
                "available",
                "way_to_pickup",
                "arrived_pickup",
                "way_to_dropoff",
                "stale",
                "not_available",
              ] as DriverState[]
            ).map((s) => (
              <li key={s} className="flex items-center gap-2 text-[11px] text-gray-700">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: DRIVER_STATE_STYLES[s].cluster }}
                />
                <span>{DRIVER_STATE_STYLES[s].label}</span>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOffline}
              onChange={(e) => persistShowOffline(e.target.checked)}
              className="h-3 w-3"
              data-testid="checkbox-show-offline-drivers"
            />
            <span>
              Show offline drivers
              {offlineDriversList.length > 0 && (
                <span className="text-gray-500"> ({offlineDriversList.length})</span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none mt-1">
            <input
              type="checkbox"
              checked={showPickupCircles}
              onChange={(e) => setShowPickupCircles(e.target.checked)}
              className="h-3 w-3"
              data-testid="checkbox-show-pickup-circles"
            />
            <span>
              Show pickup radius
              <span className="text-gray-500"> ({ARRIVED_RADIUS_M}m)</span>
            </span>
          </label>
        </div>

        <div className="absolute bottom-3 left-3 z-[500] flex flex-col gap-2 items-start">
          <div className="flex items-center gap-2">
          <div className="bg-white/95 rounded-md px-3 py-1.5 shadow text-xs font-medium text-gray-700 flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${socketConnected ? "bg-green-500" : "bg-amber-500"}`}
              title={socketConnected ? "Realtime connected" : "Realtime disconnected — polling fallback active"}
            />
            <span data-testid="text-on-map-count">
              {onMapCount} {onMapCount === 1 ? "driver" : "drivers"} on the map
              {unplottableCount > 0 ? ` (${unplottableCount} no coords)` : ""}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500" data-testid="text-last-updated">{lastUpdatedLabel}</span>
          </div>
          <button
            type="button"
            onClick={recenterOnFleet}
            className="bg-white/95 rounded-md px-2.5 py-1.5 shadow text-xs font-medium text-gray-700 hover:bg-white inline-flex items-center gap-1.5 transition-colors"
            data-testid="button-recenter-on-fleet"
            title="Recenter the map on all visible drivers"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Recenter
          </button>
          {trailDriverIds.size > 0 && (
            <button
              type="button"
              onClick={clearAllTrails}
              className="bg-blue-600 text-white rounded-md px-2.5 py-1.5 shadow text-xs font-medium hover:bg-blue-700 inline-flex items-center gap-1.5 transition-colors"
              data-testid="button-clear-all-trails"
              title="Remove all GPS trail overlays from the map"
            >
              Clear all trails ({trailDriverIds.size})
            </button>
          )}
          </div>
          {/* Offline auto-enabled banner — shown when we auto-revealed
              last-known positions because no live GPS streams are active.
              Separate from noLiveLocationHint so both can coexist cleanly. */}
          {!anyLivePlottable && offlinePlottableCount > 0 && showOffline && (
            <div
              className="bg-amber-50/95 border border-amber-200 text-amber-800 rounded-md px-3 py-1.5 shadow text-[11px] font-medium max-w-[420px]"
              data-testid="banner-offline-auto-enabled"
            >
              No live GPS streams — showing last-known positions from the past {Math.round((Date.now() - (offlineDriversList[0]?.lastSeenAt ?? Date.now())) / 3_600_000) < 1 ? "hour" : "few hours"} ({offlinePlottableCount} pinned). Markers will update as drivers come online.
            </div>
          )}
          {noLiveLocationHint && (
            <div
              className="bg-amber-50/95 border border-amber-200 text-amber-800 rounded-md px-3 py-1.5 shadow text-[11px] font-medium max-w-[420px] flex items-center gap-2 flex-wrap"
              data-testid="text-no-live-location-hint"
            >
              <span>{noLiveLocationHint}</span>
              {offlinePlottableCount > 0 && !showOffline && (
                <button
                  type="button"
                  onClick={() => persistShowOffline(true)}
                  className="inline-flex items-center rounded-md border border-amber-300 bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-white transition-colors"
                  data-testid="button-show-last-known-positions"
                  title="Reveal each approved driver's last-known DB pin and recency badge"
                >
                  Show last-known positions ({offlinePlottableCount})
                </button>
              )}
            </div>
          )}
          {/* Google Maps base-layer warning. Shown when no Google Maps web
              key is configured (admin sees the Carto Light fallback) or
              when a key is configured but the JS API failed to load. The
              base map is standardized to Google Roadmap; the fallback is
              only there so the page never blanks. */}
          {(!hasGoogleKey || googleTilesFailed) && !googleTilesWarningDismissed && (
            <div
              className="bg-amber-50/95 border border-amber-300 text-amber-900 rounded-md px-3 py-1.5 shadow text-[11px] font-medium max-w-[420px] flex items-start gap-2"
              data-testid="banner-google-tiles-failed"
              role="alert"
            >
              <span className="flex-1">
                {hasGoogleKey ? (
                  <>
                    Google Maps failed to load. Check API key restrictions, billing, and domain referrer.{" "}
                    {googleTilesFailureMessage ?? "Showing a fallback basemap. Check your Google Maps web key in Settings → Maps."}
                  </>
                ) : (
                  "No Google Maps web key configured (MissingKeyMapError) — showing a fallback basemap. Add a key in Settings → Maps to enable the standard Google Roadmap."
                )}
              </span>
              <button
                type="button"
                onClick={() => setGoogleTilesWarningDismissed(true)}
                className="text-amber-700 hover:text-amber-900 font-bold leading-none px-1"
                aria-label="Dismiss warning"
                data-testid="button-dismiss-google-tiles-warning"
              >
                ×
              </button>
            </div>
          )}
        </div>
        <div className="absolute top-3 right-3 z-[500] bg-white/95 rounded-md shadow flex items-center gap-1 px-2 py-1">
          <span className="text-xs text-gray-500 pr-1">Pulse:</span>
          {PULSE_SPEEDS.map((s) => (
            <button
              key={s.value}
              onClick={() => setPulseSpeed(s.value)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                pulseSpeed === s.value
                  ? "bg-green-600 text-white font-semibold"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Unified driver list — single source of truth panel mirroring the
          markers/counts above, with search + status filter. Clicking a row
          with valid coordinates focuses the map on that driver. Drivers
          without a usable location appear here with a "Location
          unavailable" badge so dispatchers can still see them. Sits beside
          the map on lg+ screens (see the wrapper grid above). */}
      <div className="rounded-lg border bg-card overflow-hidden flex flex-col lg:h-[560px]">
        <div className="px-3 py-2 border-b flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm">
              Drivers ({filteredUnifiedRows.length}
              {filteredUnifiedRows.length !== unifiedRows.length ? ` / ${unifiedRows.length}` : ""})
            </span>
          </div>
          <Input
            type="search"
            placeholder="Search name, plate, phone…"
            value={driverListSearch}
            onChange={(e) => setDriverListSearch(e.target.value)}
            className="h-8"
            data-testid="input-driver-search"
          />
          <Select
            value={driverListStatus}
            onValueChange={(v) => {
              const next = v as DriverState | "all";
              setDriverListStatus(next);
              // When the admin explicitly filters to "Not available",
              // auto-enable the offline toggle so the list isn't
              // mysteriously empty just because offline drivers were
              // hidden by the existing toggle.
              if (next === "not_available" && !showOffline) {
                persistShowOffline(true);
              }
            }}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="select-driver-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(
                [
                  "available",
                  "way_to_pickup",
                  "arrived_pickup",
                  "way_to_dropoff",
                  "not_available",
                ] as DriverState[]
              ).map((s) => (
                <SelectItem key={s} value={s}>
                  {DRIVER_STATE_STYLES[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isLoading && unifiedRows.length === 0 ? (
          <div className="divide-y flex-1 overflow-y-auto">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3 space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            ))}
          </div>
        ) : filteredUnifiedRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground flex-1 flex flex-col items-center justify-center">
            <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm">No drivers match the current filter</p>
          </div>
        ) : (
          <div ref={listPanelRef} className="divide-y flex-1 overflow-y-auto">
            {filteredUnifiedRows.map((d) => {
              const style = DRIVER_STATE_STYLES[d.state];
              const isSelected = d.id === selectedDriverId;
              const trailActive = trailDriverIds.has(d.id);
              return (
                <div
                  key={d.id}
                  data-driver-id={d.id}
                  className={`border-l-2 transition-colors ${isSelected ? "border-l-blue-500 bg-blue-50/60 dark:bg-blue-950/30" : "border-l-transparent"}`}
                >
                <button
                  type="button"
                  onClick={() => { focusDriverOnMap(d); setSelectedDriverId(d.id); }}
                  disabled={!d.plottable}
                  className={`w-full text-left px-4 py-3 transition-colors ${d.plottable ? "hover:bg-muted/50 cursor-pointer" : "opacity-70 cursor-not-allowed"}`}
                  data-testid={`row-driver-${d.id}`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: style.cluster }}
                      />
                      <span className="font-medium text-sm truncate">{d.name}</span>
                      {d.plate && (
                        <span className="text-xs text-muted-foreground truncate">· {d.plate}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                      {style.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">
                      {d.vehicle ?? "Vehicle unknown"}
                      {d.phone ? ` · ${d.phone}` : ""}
                    </span>
                    <span className="whitespace-nowrap">
                      {d.plottable ? formatAgo(d.lastSeenAt, now) : "Location unavailable"}
                    </span>
                  </div>
                  {d.state === "not_available" && d.plottable && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      Last seen {formatAgo(d.lastSeenAt, now)}
                    </p>
                  )}
                </button>
                {d.rideId && d.plottable && (
                  <div className="px-4 pb-2 -mt-1">
                    <button
                      type="button"
                      onClick={() => void fetchAndShowTrail(d.id)}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded border transition-colors ${
                        trailActive
                          ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-transparent dark:border-gray-600 dark:text-gray-400"
                      }`}
                      data-testid={`button-trail-${d.id}`}
                    >
                      {trailActive ? "Hide trail" : "Show trail"}
                    </button>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>

      {/* Active rides list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="font-semibold text-sm">Active Rides ({rides.length})</span>
          <span className="text-xs text-muted-foreground">Updates every 10s</span>
        </div>
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3 space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            ))}
          </div>
        ) : !rides.length ? (
          <div className="px-4 py-12 text-center text-muted-foreground">
            <Car className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm">No active rides right now</p>
          </div>
        ) : (
          <div className="divide-y">
            {rides.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{r.riderName}</span>
                    {r.driverName && (
                      <>
                        <span className="text-muted-foreground text-xs">→</span>
                        <span className="text-sm text-muted-foreground">{r.driverName}</span>
                      </>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {r.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.pickup.label} → {r.dropoff.label}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
