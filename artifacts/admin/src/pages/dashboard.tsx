import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Users,
  Car,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Server,
  Eye,
  TrendingUp,
  Clock,
  Star,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Label,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { connectAdminSocket, disconnectAdminSocket } from "@/lib/socket";
import {
  loadGoogleMaps,
  type GoogleMapsLoadResult,
} from "@/lib/google-maps-loader";

interface DriverStatusCounts {
  available: number;
  notAvailable: number;
  wayToPickup: number;
  arrivedPickup: number;
  wayToDropoff: number;
}

interface TripPeriod {
  inProcess: number;
  completed: number;
  cancelled: number;
}

interface EarningsPeriod {
  totalEarnings: number;
  outstandingAmount: number;
  orgOutstandingAmount: number;
}

interface ChartPoint {
  date: string;
  totalEarnings: number;
  outstandingAmount: number;
  orgOutstandingAmount: number;
}

interface RecentRide {
  id: string;
  riderName: string;
  riderRating: string;
  riderPhoto: string | null;
  driverName: string | null;
  driverRating: string;
  driverPhoto: string | null;
  serviceType: string;
  status: string;
  finalAmount: number | null;
  createdAt: string;
}

interface DashStats {
  totalUsers: number;
  activeDrivers: number;
  inactiveDrivers: number;
  totalDrivers: number;
  activeRides: number;
  completedRides: number;
  cancelledRides: number;
  totalRevenue: number;
  driverStatusCounts?: DriverStatusCounts;
  tripStats: { today: TripPeriod; total: TripPeriod };
  earnings: { today: EarningsPeriod; total: EarningsPeriod; chartData: ChartPoint[]; todayChartData: ChartPoint[] };
  serverStats: { working: number; errors: number; alerts: number; lastUpdated: string };
  recentRides: RecentRide[];
}

interface LiveDriver {
  id: string;
  name: string;
  vehicle: string | null;
  lat: number;
  lng: number;
  heading?: number;
  rideStatus?: string | null;
  rideId?: string | null;
  lastSeenAt: number;
}

const MOROCCO_CENTER: [number, number] = [31.79, -7.09];
const MOROCCO_ZOOM = 6;

type GodViewTab = "available" | "notAvailable" | "wayToPickup" | "arrivedPickup" | "wayToDropoff";

const GOD_VIEW_TABS: { key: GodViewTab; label: string; color: string }[] = [
  { key: "available", label: "Available", color: "bg-green-500" },
  { key: "notAvailable", label: "Not Available", color: "bg-gray-400" },
  { key: "wayToPickup", label: "Way to Pickup", color: "bg-blue-500" },
  { key: "arrivedPickup", label: "Arrived / Reached Pickup", color: "bg-yellow-500" },
  { key: "wayToDropoff", label: "Way to Dropoff", color: "bg-orange-500" },
];

function buildMarkerIcon(heading: number | undefined, color: string): L.DivIcon {
  const rot = typeof heading === "number" ? heading : 0;
  return L.divIcon({
    className: "",
    iconSize: [40, 52],
    iconAnchor: [20, 46],
    popupAnchor: [0, -50],
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;width:40px">
      <div style="width:40px;height:40px;transform:rotate(${rot}deg);transform-origin:center center">
        <img src="/admin/car-marker.png" width="40" height="40" style="object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))" />
      </div>
      <div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);flex-shrink:0"></div>
    </div>`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function driverTabColor(d: LiveDriver): GodViewTab {
  if (d.rideStatus === "driver_arriving") return "wayToPickup";
  if (d.rideStatus === "in_progress") return "wayToDropoff";
  return "available";
}

// Google Maps JS loader lives in `@/lib/google-maps-loader` and is shared
// across all admin map surfaces.

function GodViewMap({
  driverStatusCounts,
}: {
  driverStatusCounts?: DriverStatusCounts;
}) {
  const [activeTab, setActiveTab] = useState<GodViewTab>("available");
  const [drivers, setDrivers] = useState<Map<string, LiveDriver>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileRef = useRef<L.Layer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [gmapsKey, setGmapsKey] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [googleTilesFailed, setGoogleTilesFailed] = useState(false);
  const [googleTilesFailureMessage, setGoogleTilesFailureMessage] = useState<string | null>(null);
  const [googleTilesWarningDismissed, setGoogleTilesWarningDismissed] = useState(false);

  useEffect(() => {
    // Source the actual Google Maps web key from /config/public —
    // /admin/settings redacts secret-listed values (including the Google
    // key), so reading it from there would always be empty. This matches
    // what live-map.tsx does.
    interface PublicConfigResponse {
      googleMapsApiKeyWeb?: string | null;
    }
    api<PublicConfigResponse>("/config/public")
      .then((d) => {
        const key = d?.googleMapsApiKeyWeb || import.meta.env.VITE_GOOGLE_MAPS_API_KEY_WEB || "";
        setGmapsKey(key || null);
        setSettingsLoaded(true);
      })
      .catch(() => { setGmapsKey(null); setSettingsLoaded(true); });
  }, []);

  useEffect(() => {
    setGoogleTilesFailed(false);
    setGoogleTilesFailureMessage(null);
    setGoogleTilesWarningDismissed(false);
  }, [gmapsKey]);

  const hasGoogleKey = !!gmapsKey;

  useEffect(() => {
    const sock = connectAdminSocket();
    if (!sock) return;
    const onSnapshot = (payload: { drivers: LiveDriver[] }) => {
      const next = new Map<string, LiveDriver>();
      for (const d of payload.drivers ?? []) next.set(d.id, d);
      setDrivers(next);
    };
    const onLocation = (d: LiveDriver) => {
      setDrivers((prev) => {
        const next = new Map(prev);
        const existing = next.get(d.id);
        next.set(d.id, { ...existing, ...d, rideStatus: d.rideStatus ?? existing?.rideStatus ?? null });
        return next;
      });
    };
    const onOffline = (payload: { id: string }) => {
      setDrivers((prev) => {
        if (!prev.has(payload.id)) return prev;
        const next = new Map(prev);
        next.delete(payload.id);
        return next;
      });
    };
    sock.on("drivers:snapshot", onSnapshot);
    sock.on("driver:location", onLocation);
    sock.on("driver:offline", onOffline);
    return () => {
      sock.off("drivers:snapshot", onSnapshot);
      sock.off("driver:location", onLocation);
      sock.off("driver:offline", onOffline);
      disconnectAdminSocket();
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !settingsLoaded) return;

    const addBase = (map: L.Map, useGoogle: boolean) => {
      const googleReady =
        typeof window !== "undefined" &&
        !!(window as unknown as { google?: { maps?: unknown } }).google?.maps;
      if (useGoogle && googleReady) {
        const g = L.gridLayer.googleMutant({ type: "roadmap", maxZoom: 20 });
        (g as unknown as L.Layer).addTo(map);
        baseTileRef.current = g as unknown as L.Layer;
      } else {
        if (useGoogle && !googleReady) {
          setGoogleTilesFailed(true);
          setGoogleTilesFailureMessage((prev) =>
            prev ??
            "Google Maps loaded but the API global never became available — showing a fallback basemap.",
          );
        }
        // Google primary, raw OSM tile server fallback.
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
        baseTileRef.current = fallback;
      }
    };

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const doInit = async (useGoogle: boolean) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      (window as unknown as { L?: typeof L }).L = L;
      if (useGoogle) {
        await import("leaflet.gridlayer.googlemutant");
      }
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      const container = mapContainerRef.current as HTMLDivElement & {
        _leaflet_id?: number;
      };
      // Guard against React invoking the effect twice (e.g. StrictMode)
      // before our local `mapRef` is populated. Leaflet stamps
      // `_leaflet_id` on the container the first time `L.map()` runs;
      // calling it again throws "Map container is already initialized."
      // and leaves the user staring at a blank grey map. Mirrors the
      // guard in `live-map.tsx`.
      if (container._leaflet_id != null) return;
      const map = L.map(container, { center: MOROCCO_CENTER, zoom: MOROCCO_ZOOM, zoomControl: true });
      if (cancelled) {
        map.remove();
        return;
      }
      addBase(map, useGoogle);
      mapRef.current = map;
      // Force a size recompute once layout has settled so tiles paint into
      // the full container (Leaflet caches container size on init and can
      // otherwise show a blank grey map). Mirrors the guard in live-map.tsx.
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
      resizeObserver.observe(container);
      setMapReady(true);
    };

    if (gmapsKey) {
      loadGoogleMaps(gmapsKey)
        .then((result: GoogleMapsLoadResult) => {
          if (result.status === "ready") {
            doInit(true);
          } else {
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
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; baseTileRef.current = null; }
      setMapReady(false);
    };
  }, [settingsLoaded, gmapsKey]);

  const OFFLINE_TABS = new Set<GodViewTab>(["notAvailable", "arrivedPickup"]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const markers = markersRef.current;
    const TAB_COLORS: Record<GodViewTab, string> = {
      available: "#16a34a",
      notAvailable: "#9ca3af",
      wayToPickup: "#2563eb",
      arrivedPickup: "#eab308",
      wayToDropoff: "#f97316",
    };

    for (const [id, marker] of markers) {
      if (!drivers.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    const showAll = OFFLINE_TABS.has(activeTab);

    for (const [id, d] of drivers) {
      const tab = driverTabColor(d);
      const visible = showAll ? false : tab === activeTab;
      const color = TAB_COLORS[tab];
      const icon = buildMarkerIcon(d.heading, color);
      let marker = markers.get(id);
      if (!marker) {
        marker = L.marker([d.lat, d.lng], { icon }).addTo(map);
        marker.bindPopup(`<div style="font-family:system-ui;font-size:12px"><b>${escapeHtml(d.name)}</b><br/>${escapeHtml(d.vehicle ?? "")}</div>`);
        markers.set(id, marker);
      } else {
        marker.setLatLng([d.lat, d.lng]);
        marker.setIcon(icon);
      }
      if (visible) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        if (map.hasLayer(marker)) marker.remove();
      }
    }
  }, [drivers, mapReady, activeTab]);

  const tabCounts: Record<GodViewTab, number> = {
    available: driverStatusCounts?.available ?? 0,
    notAvailable: driverStatusCounts?.notAvailable ?? 0,
    wayToPickup: driverStatusCounts?.wayToPickup ?? 0,
    arrivedPickup: driverStatusCounts?.arrivedPickup ?? 0,
    wayToDropoff: driverStatusCounts?.wayToDropoff ?? 0,
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {GOD_VIEW_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
              activeTab === t.key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-card text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${t.color}`} />
            {t.label}
            <span className="ml-0.5 font-bold">{tabCounts[t.key]}</span>
          </button>
        ))}
      </div>
      <div className="relative w-full">
        <div ref={mapContainerRef} className="w-full rounded-lg overflow-hidden border border-border" style={{ height: 360 }} />
        {settingsLoaded && (!hasGoogleKey || googleTilesFailed) && !googleTilesWarningDismissed && (
          <div
            className="absolute top-3 left-3 z-[500] bg-amber-50/95 border border-amber-300 text-amber-900 rounded-md px-3 py-1.5 shadow text-[11px] font-medium max-w-[420px] flex items-start gap-2"
            data-testid="banner-google-tiles-failed"
            role="alert"
          >
            <span className="flex-1">
              {hasGoogleKey
                ? googleTilesFailureMessage ??
                  "Google Maps tiles unavailable — showing a fallback basemap. Check your Google Maps web key in Settings."
                : "No Google Maps web key configured — showing a fallback basemap. Add a key in Settings → Maps to enable the standard Google Roadmap."}
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
        {OFFLINE_TABS.has(activeTab) && (
          <div className="absolute inset-0 rounded-lg bg-background/70 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <div className="text-sm font-semibold text-muted-foreground">
              {activeTab === "notAvailable" ? "Offline drivers have no live GPS position" : "No distinct 'Arrived' status — see Way to Pickup markers"}
            </div>
            <div className="text-xs text-muted-foreground">
              {tabCounts[activeTab]} driver{tabCounts[activeTab] !== 1 ? "s" : ""} in this state · positions not broadcast
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  href,
}: {
  label: string;
  value: number | string;
  icon: typeof Users;
  iconBg: string;
  iconColor: string;
  href?: string;
}) {
  const inner = (
    <Card className={`${href ? "hover:shadow-md transition-shadow cursor-pointer" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight mb-1">{value}</div>
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const EMPTY_TRIP_PERIOD: TripPeriod = { inProcess: 0, completed: 0, cancelled: 0 };
const EMPTY_TRIP_STATS = { today: EMPTY_TRIP_PERIOD, total: EMPTY_TRIP_PERIOD };

function TripStatsCard({ tripStats }: { tripStats?: DashStats["tripStats"] }) {
  const [mode, setMode] = useState<"today" | "total">("today");
  const stats = tripStats ?? EMPTY_TRIP_STATS;
  const data = stats[mode];
  const total = data.inProcess + data.completed + data.cancelled;
  const pieData = [
    { name: "In Process", value: data.inProcess || 0, color: "#22c55e" },
    { name: "Completed", value: data.completed || 0, color: "#3b82f6" },
    { name: "Cancelled", value: data.cancelled || 0, color: "#ef4444" },
  ];
  const modeLabel = mode === "today" ? "Today" : "Total";
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Trip Statistics</CardTitle>
          <div className="flex rounded-lg border overflow-hidden">
            {(["today", "total"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  mode === m ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {m === "today" ? "Today" : "Total"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-2">
            <div className="group rounded-lg border-2 border-blue-500 p-3 bg-blue-50 dark:bg-blue-950/30 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🚗</span>
                <span className="text-xs font-medium text-muted-foreground">Total Trips</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{total}</span>
                <Link href="/trips" className="text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-md py-1 px-2 transition-colors opacity-0 group-hover:opacity-100 transition-opacity">
                  View All
                </Link>
              </div>
            </div>
            <div className="group rounded-lg border p-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🔄</span>
                <span className="text-xs font-medium text-muted-foreground">Inprocess Trips</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-green-500">{data.inProcess}</span>
                <Link href="/trips?status=inprocess" className="text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-md py-1 px-2 transition-colors opacity-0 group-hover:opacity-100 transition-opacity">
                  View All
                </Link>
              </div>
            </div>
            <div className="group rounded-lg border p-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">❌</span>
                <span className="text-xs font-medium text-muted-foreground">Cancelled Trips</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-amber-500">{data.cancelled}</span>
                <Link href="/trips?status=cancelled" className="text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-md py-1 px-2 transition-colors opacity-0 group-hover:opacity-100 transition-opacity">
                  View All
                </Link>
              </div>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center">
            <div className="w-full" style={{ height: 160 }}>
              {total === 0 ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <svg viewBox="0 0 80 80" width={80} height={80} aria-hidden="true">
                    <circle cx="40" cy="40" r="30" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted-foreground/20" strokeDasharray="4 4" />
                  </svg>
                  <span className="text-xs text-muted-foreground">No trips yet</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={72}
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                      <Label
                        content={({ viewBox }) => {
                          const vb = viewBox as { cx?: number; cy?: number };
                          const cx = vb?.cx ?? 0;
                          const cy = vb?.cy ?? 0;
                          return (
                            <g>
                              <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>
                                {modeLabel}
                              </text>
                              <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="middle" className="fill-foreground" style={{ fontSize: 18, fontWeight: 700 }}>
                                {total}
                              </text>
                            </g>
                          );
                        }}
                      />
                    </Pie>
                    <Tooltip formatter={(v) => [v, ""]} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              {pieData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-xs text-muted-foreground">{entry.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const SERVICE_ICONS: Record<string, string> = {
  moto: "🏍",
  comfort: "🚘",
  ride: "🚖",
  shared: "🚌",
  wheelchair: "♿",
};

function Avatar({ name, photo, bg }: { name: string; photo: string | null; bg: string }) {
  const initials = name.split(" ").map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className={`w-6 h-6 rounded-full object-cover flex-shrink-0 border border-border`}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-white ${bg}`}>
      {initials || "?"}
    </div>
  );
}

function RecentRidesCard({ rides }: { rides?: RecentRide[] }) {
  if (!rides) rides = [];
  const statusStyles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
    in_progress: "bg-blue-100 text-blue-700",
    driver_arriving: "bg-yellow-100 text-yellow-700",
    bidding: "bg-purple-100 text-purple-700",
  };
  const statusLabels: Record<string, string> = {
    completed: "Completed",
    cancelled: "Cancelled",
    in_progress: "In Progress",
    driver_arriving: "En Route",
    bidding: "Bidding",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Recent Rides</CardTitle>
          <Link href="/trips" className="text-xs text-primary hover:underline font-medium">
            View All
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rides.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">No rides yet</div>
        ) : (
          <div className="divide-y divide-border">
            {rides.map((ride) => {
              const svcIcon = SERVICE_ICONS[ride.serviceType?.toLowerCase() ?? ""] ?? "🚖";
              return (
                <div key={ride.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="text-lg flex-shrink-0" title={ride.serviceType}>{svcIcon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        #{ride.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${statusStyles[ride.status] ?? "bg-muted text-muted-foreground"}`}>
                        {statusLabels[ride.status] ?? ride.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <div className="flex items-center gap-1 min-w-0">
                        <Avatar name={ride.riderName} photo={ride.riderPhoto} bg="bg-blue-500" />
                        <span className="truncate font-medium max-w-[80px]">{ride.riderName}</span>
                        <span className="text-muted-foreground flex items-center gap-0.5 flex-shrink-0">
                          <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                          {parseFloat(ride.riderRating).toFixed(1)}
                        </span>
                      </div>
                      {ride.driverName && (
                        <div className="flex items-center gap-1 min-w-0">
                          <Avatar name={ride.driverName} photo={ride.driverPhoto} bg="bg-green-600" />
                          <span className="truncate font-medium max-w-[80px]">{ride.driverName}</span>
                          <span className="text-muted-foreground flex items-center gap-0.5 flex-shrink-0">
                            <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                            {parseFloat(ride.driverRating).toFixed(1)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(ride.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(ride.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type EarningsRange = 7 | 30 | 90;

interface EarningsRangeResponse {
  chartData: ChartPoint[];
  summary: { totalEarnings: number; outstandingAmount: number; orgOutstandingAmount: number };
}

const RANGE_LABELS: { value: EarningsRange; label: string }[] = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

function AdminEarningsCard({ earnings }: { earnings?: DashStats["earnings"] }) {
  const [mode, setMode] = useState<"today" | "range">("today");
  const [range, setRange] = useState<EarningsRange>(7);

  const { data: rangeData, isFetching: rangeFetching } = useQuery<EarningsRangeResponse>({
    queryKey: ["/admin/earnings", range],
    queryFn: () => api<EarningsRangeResponse>(`/admin/earnings?range=${range}`),
    enabled: mode === "range",
    staleTime: 30000,
  });

  const isToday = mode === "today";
  const chartData = isToday ? (earnings?.todayChartData ?? []) : (rangeData?.chartData ?? []);
  const summary = isToday ? earnings?.today : rangeData?.summary;
  const xTickFormatter = isToday ? (v: string) => v : (v: string) => v.slice(5);

  const formatMAD = (n: number) => `${n.toFixed(2)} MAD`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Admin Earnings</CardTitle>
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setMode("today")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                isToday ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              Today
            </button>
            {RANGE_LABELS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setMode("range"); setRange(value); }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  !isToday && range === value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-44 relative">
          {!isToday && rangeFetching && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded z-10">
              <span className="text-xs text-muted-foreground">Loading…</span>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradEarnings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOutstanding" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOrg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={xTickFormatter} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(2)} MAD`, ""]} labelFormatter={(l) => l} />
              <Area type="monotone" dataKey="totalEarnings" stroke="#3b82f6" fill="url(#gradEarnings)" strokeWidth={2} name="Total Earnings" />
              <Area type="monotone" dataKey="outstandingAmount" stroke="#f97316" fill="url(#gradOutstanding)" strokeWidth={2} name="Outstanding" />
              <Area type="monotone" dataKey="orgOutstandingAmount" stroke="#8b5cf6" fill="url(#gradOrg)" strokeWidth={2} name="Org Outstanding" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 space-y-2 border-t pt-3">
          {[
            { label: "Total Earnings", value: summary?.totalEarnings ?? 0, color: "bg-blue-500" },
            { label: "Outstanding Amount", value: summary?.outstandingAmount ?? 0, color: "bg-orange-500" },
            { label: "Org. Outstanding Amount", value: summary?.orgOutstandingAmount ?? 0, color: "bg-violet-500" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${row.color}`} />
                <span className="text-muted-foreground">{row.label}</span>
              </div>
              <span className="font-semibold">{formatMAD(row.value)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ServerStatsCard({ serverStats }: { serverStats?: DashStats["serverStats"] }) {
  const safe = serverStats ?? { working: 0, errors: 0, alerts: 0, lastUpdated: new Date().toISOString() };
  const total = safe.working + safe.errors + safe.alerts;
  const pieData = [
    { name: "Working", value: safe.working, color: "#22c55e" },
    { name: "Errors", value: safe.errors, color: "#ef4444" },
    { name: "Alerts", value: safe.alerts, color: "#f59e0b" },
  ];

  const lastUpdated = new Date(safe.lastUpdated).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Server Statistics</CardTitle>
          <Link href="/settings">
            <button className="text-xs px-3 py-1 rounded-lg border border-border hover:bg-muted transition-colors font-medium">
              View
            </button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-24 h-24 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={26} outerRadius={42} dataKey="value" startAngle={90} endAngle={-270}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">Working</span>
              <span className="ml-auto text-sm font-bold text-green-600">{safe.working}</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">Errors</span>
              <span className="ml-auto text-sm font-bold text-red-600">{safe.errors}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">Alerts</span>
              <span className="ml-auto text-sm font-bold text-yellow-600">{safe.alerts}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border-t pt-3">
          <Clock className="w-3 h-3" />
          Last Updated: {lastUpdated}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, refetch } = useQuery<DashStats>({
    queryKey: ["/admin/stats"],
    queryFn: () => api<DashStats>("/admin/stats"),
    refetchInterval: 10000,
    retry: 1,
  });

  const skeleton = <div className="text-muted-foreground text-sm">Loading…</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Live overview of the Biddi marketplace</p>
      </div>

      {isError && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400" />
          <div className="flex-1">
            <p className="font-semibold">Dashboard data unavailable</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
              The server could not be reached. Metrics shown below may be stale or unavailable. Check your connection or try again.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex-shrink-0 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading || !data ? (
        isError ? null : skeleton
      ) : (
        <div className="space-y-6">
          {/* Top metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Users"
              value={data.totalUsers}
              icon={Users}
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
              href="/users"
            />
            <MetricCard
              label="Active Drivers"
              value={data.activeDrivers}
              icon={TrendingUp}
              iconBg="bg-green-100"
              iconColor="text-green-600"
              href="/drivers?status=approved"
            />
            <MetricCard
              label="Inactive Drivers"
              value={data.inactiveDrivers}
              icon={Eye}
              iconBg="bg-yellow-100"
              iconColor="text-yellow-600"
              href="/drivers?status=approved"
            />
            <MetricCard
              label="Total Drivers"
              value={data.totalDrivers}
              icon={Car}
              iconBg="bg-red-100"
              iconColor="text-red-600"
              href="/drivers"
            />
          </div>

          {/* Main two-column: God's View left, stats right */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: God's View map */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />
                  God's View — Live Fleet Map
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GodViewMap driverStatusCounts={data.driverStatusCounts ?? { available: 0, notAvailable: 0, wayToPickup: 0, arrivedPickup: 0, wayToDropoff: 0 }} />
              </CardContent>
            </Card>

            {/* Right: Trip Stats + Server Stats */}
            <div className="space-y-6">
              <TripStatsCard tripStats={data.tripStats} />
              <ServerStatsCard serverStats={data.serverStats} />
            </div>
          </div>

          {/* Bottom two-column: Recent Rides + Admin Earnings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentRidesCard rides={data.recentRides} />
            <AdminEarningsCard earnings={data.earnings} />
          </div>
        </div>
      )}
    </div>
  );
}
