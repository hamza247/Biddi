import "leaflet/dist/leaflet.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplayCurrency, useFormatCurrency } from "@/lib/use-display-currency";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import {
  loadGoogleMaps,
  type GoogleMapsLoadResult,
} from "@/lib/google-maps-loader";

const MOROCCO_CENTER: [number, number] = [33.82, -7.18];
const MOROCCO_ZOOM = 9;
const LABEL_ZOOM_THRESHOLD = 10;

const CITIES: { name: string; coords: [number, number] }[] = [
  { name: "Rabat", coords: [34.0209, -6.8417] },
  { name: "Casablanca", coords: [33.5731, -7.5898] },
];

interface Cell {
  lat: number;
  lng: number;
  count: number;
}

interface CellRide {
  id: string;
  status: string;
  pickupLabel: string;
  dropoffLabel: string;
  finalAmount: number | null;
  finalAmountDisplay?: { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string } | null;
  createdAt: string;
  riderName: string;
  driverName: string | null;
}

function cellColor(count: number, maxCount: number): string {
  const ratio = maxCount > 1 ? count / maxCount : 1;
  if (ratio < 0.33) return "#FFAB40";
  if (ratio < 0.66) return "#FF6B3D";
  return "#C0392B";
}

function pickupColor(count: number, maxCount: number): string {
  const ratio = maxCount > 1 ? count / maxCount : 1;
  if (ratio < 0.33) return "#64B5F6";
  if (ratio < 0.66) return "#1E88E5";
  return "#0D47A1";
}

function dropoffColor(count: number, maxCount: number): string {
  const ratio = maxCount > 1 ? count / maxCount : 1;
  if (ratio < 0.33) return "#81C784";
  if (ratio < 0.66) return "#2E7D32";
  return "#1B5E20";
}

function cellRadius(count: number, maxCount: number): number {
  const BASE = 600;
  const MAX = 4000;
  if (maxCount <= 1) return BASE;
  const ratio = Math.log(count + 1) / Math.log(maxCount + 1);
  return BASE + ratio * (MAX - BASE);
}

function cellOpacity(count: number, maxCount: number): number {
  if (maxCount <= 1) return 0.55;
  const ratio = count / maxCount;
  return 0.35 + ratio * 0.4;
}

function buildLegendHTML(showDensity: boolean, showPickups: boolean, showDropoffs: boolean, showRouteHeat: boolean): string {
  let html = "";

  if (showDensity) {
    html += `
      <div style="font-weight:700;margin-bottom:4px;color:#333">Ride Requests</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#FFAB40"></span>
        <span style="color:#555">Low</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#FF6B3D"></span>
        <span style="color:#555">Medium</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#C0392B"></span>
        <span style="color:#555">High</span>
      </div>
    `;
  }

  if (showPickups) {
    if (html) html += `<div style="border-top:1px solid #eee;margin:6px 0"></div>`;
    html += `
      <div style="font-weight:700;margin-bottom:4px;color:#333">Pickup Hotspots</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#64B5F6"></span>
        <span style="color:#555">Low</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#1E88E5"></span>
        <span style="color:#555">Medium</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#0D47A1"></span>
        <span style="color:#555">High</span>
      </div>
    `;
  }

  if (showDropoffs) {
    if (html) html += `<div style="border-top:1px solid #eee;margin:6px 0"></div>`;
    html += `
      <div style="font-weight:700;margin-bottom:4px;color:#333">Dropoff Hotspots</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#81C784"></span>
        <span style="color:#555">Low</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#2E7D32"></span>
        <span style="color:#555">Medium</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#1B5E20"></span>
        <span style="color:#555">High</span>
      </div>
    `;
  }

  if (showRouteHeat) {
    if (html) html += `<div style="border-top:1px solid #eee;margin:6px 0"></div>`;
    html += `
      <div style="font-weight:700;margin-bottom:4px;color:#333">Route Heat Zones</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:64px;height:8px;border-radius:4px;background:linear-gradient(to right,#0000ff88,#00ff0088,#ff000088)"></span>
      </div>
      <div style="display:flex;justify-content:space-between;color:#555;font-size:10px;margin-top:2px">
        <span>Low</span><span>High</span>
      </div>
    `;
  }

  if (!html) {
    html = `<div style="color:#888;font-size:11px">No layers active</div>`;
  }

  return html;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  in_progress: "bg-blue-100 text-blue-700",
  driver_arriving: "bg-yellow-100 text-yellow-700",
  bidding: "bg-gray-100 text-gray-600",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

// Google Maps JS loader lives in `@/lib/google-maps-loader` and is shared
// across all admin map surfaces.

export default function HeatViewPage() {
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const [range, setRange] = useState("today");
  const [type, setType] = useState("ride_requests");
  const [selectedCell, setSelectedCell] = useState<{ lat: number; lng: number; count: number } | null>(null);
  const [showDensity, setShowDensity] = useState(true);
  const [showPickups, setShowPickups] = useState(false);
  const [showDropoffs, setShowDropoffs] = useState(false);
  const [showRouteHeat, setShowRouteHeat] = useState(false);
  const [gmapsKey, setGmapsKey] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // True when no Google Maps web key is configured OR the JS API failed to
  // load, so we ended up on the Carto Light fallback basemap. Drives a
  // dismissible banner telling admins to add / fix their key.
  const [googleTilesFailed, setGoogleTilesFailed] = useState(false);
  const [googleTilesFailureMessage, setGoogleTilesFailureMessage] = useState<string | null>(null);
  const [googleTilesWarningDismissed, setGoogleTilesWarningDismissed] = useState(false);

  const queryClient = useQueryClient();

  const handleClearSeedData = useCallback(async () => {
    setClearing(true);
    setClearResult(null);
    try {
      const res = await api<{ deleted: number; message: string }>("/admin/seed-data", {
        method: "DELETE",
      });
      setClearResult(res.deleted > 0 ? `Cleared ${res.deleted} seed ride(s).` : "No seed data found.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "heat-view"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "heat-view-pickups"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "heat-view-dropoffs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "heat-view-routes"] });
    } catch {
      setClearResult("Failed to clear seed data. Please try again.");
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }, [queryClient]);

  // Read the Google Maps web key from /config/public — the admin
  // settings endpoint redacts secret values, so we'd never see the real
  // key from there.
  useEffect(() => {
    api("/config/public")
      .then((data: any) => {
        const key = data?.googleMapsApiKeyWeb || import.meta.env.VITE_GOOGLE_MAPS_API_KEY_WEB || "";
        setGmapsKey(key || null);
        setSettingsLoaded(true);
      })
      .catch(() => {
        setGmapsKey(null);
        setSettingsLoaded(true);
      });
  }, []);

  // Reset failure / dismissed state whenever the key changes — a fresh
  // attempt deserves a fresh warning.
  useEffect(() => {
    setGoogleTilesFailed(false);
    setGoogleTilesFailureMessage(null);
    setGoogleTilesWarningDismissed(false);
  }, [gmapsKey]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "heat-view", range, type],
    queryFn: () =>
      api<{ cells: Cell[] }>(
        `/admin/heat-view?range=${range}&type=${type}`,
      ),
  });

  const { data: pickupData } = useQuery({
    queryKey: ["admin", "heat-view-pickups", range, type],
    queryFn: () =>
      api<{ cells: Cell[] }>(
        `/admin/heat-view/pickups?range=${range}&type=${type}`,
      ),
    enabled: showPickups,
  });

  const { data: dropoffData } = useQuery({
    queryKey: ["admin", "heat-view-dropoffs", range, type],
    queryFn: () =>
      api<{ cells: Cell[] }>(
        `/admin/heat-view/dropoffs?range=${range}&type=${type}`,
      ),
    enabled: showDropoffs,
  });

  const { data: routeData } = useQuery({
    queryKey: ["admin", "heat-view-routes", range, type],
    queryFn: () =>
      api<{ points: [number, number, number][] }>(
        `/admin/heat-view/routes?range=${range}&type=${type}`,
      ),
    enabled: showRouteHeat,
  });

  const { data: cellData, isLoading: cellLoading } = useQuery({
    queryKey: ["admin", "heat-view-cell", selectedCell?.lat, selectedCell?.lng, range, type],
    queryFn: () =>
      api<{ rides: CellRide[] }>(
        `/admin/heat-view/cell?lat=${selectedCell!.lat}&lng=${selectedCell!.lng}&range=${range}&type=${type}`,
      ),
    enabled: selectedCell !== null,
  });

  const cells = data?.cells ?? [];
  const totalRides = cells.reduce((s, c) => s + c.count, 0);
  const activeCells = cells.length;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.Layer | null>(null);
  const heatLayerRef = useRef<L.LayerGroup | null>(null);
  const labelLayerRef = useRef<L.LayerGroup | null>(null);
  const pickupLayerRef = useRef<L.LayerGroup | null>(null);
  const dropoffLayerRef = useRef<L.LayerGroup | null>(null);
  const routeHeatLayerRef = useRef<L.HeatLayer | null>(null);
  const circlesRef = useRef<Map<string, { circle: L.Circle; fillColor: string; fillOpacity: number }>>(new Map());
  const hasAnimatedRef = useRef(false);
  const legendDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !settingsLoaded) return;

    const currentKey = gmapsKey;

    const addBaseTileLayer = (map: L.Map) => {
      // googleMutant silently produces a blank gray grid if the Google Maps
      // JS API global isn't loaded — verify before committing to it, and
      // fall back to the raw OSM tile server so the admin always sees real
      // tiles. (MapTiler + CARTO were intentionally removed from the stack.)
      const googleReady =
        typeof window !== "undefined" &&
        !!(window as unknown as { google?: { maps?: unknown } }).google?.maps;
      let googleAttached = false;
      if (currentKey && googleReady) {
        try {
          const googleLayer = L.gridLayer.googleMutant({ type: "roadmap", maxZoom: 20 });
          (googleLayer as unknown as L.Layer).addTo(map);
          baseTileLayerRef.current = googleLayer as unknown as L.Layer;
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
        if (currentKey && !googleReady) {
          setGoogleTilesFailed(true);
          setGoogleTilesFailureMessage((prev) =>
            prev ??
            "Google Maps loaded but the API global never became available — showing a fallback basemap.",
          );
        }
        if (!currentKey) setGoogleTilesFailed(true);
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

    const initMap = (container: HTMLDivElement) => {
      const map = L.map(container, {
        center: MOROCCO_CENTER,
        zoom: MOROCCO_ZOOM,
        zoomControl: true,
      });
      addBaseTileLayer(map);
      return map;
    };

    const doInit = async () => {
      if (!mapContainerRef.current || mapRef.current) return;
      // Make L available globally so the UMD plugins can attach to it
      (window as any).L = L;
      await import("leaflet.heat");
      if (currentKey) {
        const mod = await import("leaflet.gridlayer.googlemutant");
        // v0.16.0 ESM source registers the factory but forgets to attach the
        // class to L.GridLayer.GoogleMutant — do it ourselves so the factory
        // `L.gridLayer.googleMutant(...)` actually finds a constructor.
        (L.GridLayer as unknown as { GoogleMutant?: unknown }).GoogleMutant =
          mod.default;
      }
      if (!mapContainerRef.current || mapRef.current) return;
      const map = initMap(mapContainerRef.current);

      CITIES.forEach(({ name, coords }) => {
        L.marker(coords, {
          icon: L.divIcon({
            className: "",
            html: `<div style="
              background:rgba(56,25,166,0.9);
              color:#fff;
              font-size:11px;
              font-weight:600;
              padding:3px 8px;
              border-radius:10px;
              white-space:nowrap;
              box-shadow:0 1px 4px rgba(0,0,0,.3);
            ">${name}</div>`,
            iconAnchor: [30, 10],
          }),
        }).addTo(map);
      });

      const heatLayer = L.layerGroup().addTo(map);
      heatLayerRef.current = heatLayer;

      const labelLayer = L.layerGroup();
      labelLayerRef.current = labelLayer;
      if (map.getZoom() >= LABEL_ZOOM_THRESHOLD) {
        labelLayer.addTo(map);
      }

      const pickupLayer = L.layerGroup();
      pickupLayerRef.current = pickupLayer;

      const dropoffLayer = L.layerGroup();
      dropoffLayerRef.current = dropoffLayer;

      map.on("zoomend", () => {
        if (map.getZoom() >= LABEL_ZOOM_THRESHOLD) {
          if (!map.hasLayer(labelLayer)) labelLayer.addTo(map);
        } else {
          if (map.hasLayer(labelLayer)) map.removeLayer(labelLayer);
        }
      });

      mapRef.current = map;

      const Legend = L.Control.extend({
        onAdd() {
          const div = L.DomUtil.create("div") as HTMLDivElement;
          div.style.cssText = `
            background: rgba(255,255,255,0.92);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 11px;
            font-family: sans-serif;
            box-shadow: 0 1px 5px rgba(0,0,0,0.3);
            line-height: 1.8;
            min-width: 130px;
          `;
          legendDivRef.current = div;
          div.innerHTML = buildLegendHTML(true, false, false, false);
          return div;
        },
      });
      new Legend({ position: "bottomright" }).addTo(map);
    };

    if (currentKey) {
      loadGoogleMaps(currentKey)
        .then((result: GoogleMapsLoadResult) => {
          if (result.status === "ready") {
            doInit();
          } else {
            // Auth failed (key rejected, referrer not allowed, API not
            // enabled, billing off) or the script itself failed
            // (network/CSP). Surface the specific reason and fall back
            // to Carto Light via `addBaseTileLayer`.
            setGoogleTilesFailed(true);
            setGoogleTilesFailureMessage(result.message);
            doInit();
          }
        })
        .catch(() => {
          setGoogleTilesFailed(true);
          setGoogleTilesFailureMessage(
            "Could not load the Google Maps JavaScript API.",
          );
          doInit();
        });
    } else {
      doInit();
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        baseTileLayerRef.current = null;
        heatLayerRef.current = null;
        labelLayerRef.current = null;
        pickupLayerRef.current = null;
        dropoffLayerRef.current = null;
        routeHeatLayerRef.current = null;
        legendDivRef.current = null;
      }
    };
  }, [settingsLoaded, gmapsKey]);

  useEffect(() => {
    const heatLayer = heatLayerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!heatLayer || !labelLayer) return;

    heatLayer.clearLayers();
    labelLayer.clearLayers();
    circlesRef.current.clear();

    if (cells.length === 0) return;

    const shouldAnimate = !hasAnimatedRef.current;
    if (shouldAnimate) hasAnimatedRef.current = true;

    const maxCount = Math.max(...cells.map((c) => c.count));
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    cells.forEach(({ lat, lng, count }, index) => {
      const color = cellColor(count, maxCount);
      const radius = cellRadius(count, maxCount);
      const opacity = cellOpacity(count, maxCount);

      const circle = L.circle([lat, lng], {
        radius,
        color: "transparent",
        weight: 0,
        fillColor: color,
        fillOpacity: shouldAnimate ? 0 : opacity,
        interactive: true,
      });

      circle.on("click", () => {
        setSelectedCell({ lat, lng, count });
      });

      circle.bindTooltip(`${count} ride${count !== 1 ? "s" : ""} — click for details`, {
        sticky: true,
        direction: "top",
        offset: [0, -8],
      });

      circle.addTo(heatLayer);
      const el = circle.getElement() as SVGElement | null;
      if (el) {
        if (shouldAnimate) {
          el.style.fillOpacity = "0";
          const tid = setTimeout(() => {
            requestAnimationFrame(() => {
              el.style.transition =
                "fill-opacity 350ms ease, stroke 200ms ease, stroke-width 200ms ease, stroke-opacity 200ms ease";
              el.style.fillOpacity = String(opacity);
            });
          }, index * 25);
          timeouts.push(tid);
        } else {
          el.style.transition =
            "fill-opacity 200ms ease, stroke 200ms ease, stroke-width 200ms ease, stroke-opacity 200ms ease";
        }
      }
      circlesRef.current.set(`${lat},${lng}`, { circle, fillColor: color, fillOpacity: opacity });

      const fontSize = Math.max(9, Math.min(14, 9 + Math.floor(radius / 800)));
      const labelMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="
            color:#fff;
            font-size:${fontSize}px;
            font-weight:700;
            text-shadow:0 0 3px rgba(0,0,0,0.8);
            text-align:center;
            white-space:nowrap;
            transform:translate(-50%,-50%);
            position:relative;
            cursor:pointer;
          ">${count}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: true,
        zIndexOffset: 10,
      });

      labelMarker.on("click", () => {
        setSelectedCell({ lat, lng, count });
      });

      labelMarker.addTo(labelLayer);
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [cells]);

  useEffect(() => {
    const circles = circlesRef.current;
    if (circles.size === 0) return;

    const selectedKey = selectedCell ? `${selectedCell.lat},${selectedCell.lng}` : null;

    circles.forEach(({ circle, fillColor, fillOpacity }, key) => {
      if (selectedKey === null) {
        circle.setStyle({
          color: "transparent",
          weight: 0,
          fillColor,
          fillOpacity,
        });
      } else if (key === selectedKey) {
        circle.setStyle({
          color: "#ffffff",
          weight: 3,
          fillColor,
          fillOpacity: Math.min(fillOpacity + 0.2, 1),
        });
      } else {
        circle.setStyle({
          color: "transparent",
          weight: 0,
          fillColor,
          fillOpacity: fillOpacity * 0.4,
        });
      }
    });
  }, [selectedCell, cells]);

  useEffect(() => {
    const map = mapRef.current;
    const pickupLayer = pickupLayerRef.current;
    if (!map || !pickupLayer) return;

    pickupLayer.clearLayers();

    if (!showPickups) {
      if (map.hasLayer(pickupLayer)) map.removeLayer(pickupLayer);
      return;
    }

    if (!map.hasLayer(pickupLayer)) pickupLayer.addTo(map);

    const pickupCells = pickupData?.cells ?? [];
    if (pickupCells.length === 0) return;

    const maxCount = Math.max(...pickupCells.map((c) => c.count));

    pickupCells.forEach(({ lat, lng, count }) => {
      const color = pickupColor(count, maxCount);
      const radius = cellRadius(count, maxCount);
      const opacity = cellOpacity(count, maxCount);

      const circle = L.circle([lat, lng], {
        radius,
        color: "transparent",
        weight: 0,
        fillColor: color,
        fillOpacity: opacity,
        interactive: true,
      });

      circle.bindTooltip(`${count} pickup${count !== 1 ? "s" : ""} in this area`, {
        sticky: true,
        direction: "top",
        offset: [0, -8],
      });

      circle.addTo(pickupLayer);
    });
  }, [showPickups, pickupData]);

  useEffect(() => {
    const map = mapRef.current;
    const dropoffLayer = dropoffLayerRef.current;
    if (!map || !dropoffLayer) return;

    dropoffLayer.clearLayers();

    if (!showDropoffs) {
      if (map.hasLayer(dropoffLayer)) map.removeLayer(dropoffLayer);
      return;
    }

    if (!map.hasLayer(dropoffLayer)) dropoffLayer.addTo(map);

    const dropoffCells = dropoffData?.cells ?? [];
    if (dropoffCells.length === 0) return;

    const maxCount = Math.max(...dropoffCells.map((c) => c.count));

    dropoffCells.forEach(({ lat, lng, count }) => {
      const color = dropoffColor(count, maxCount);
      const radius = cellRadius(count, maxCount);
      const opacity = cellOpacity(count, maxCount);

      const circle = L.circle([lat, lng], {
        radius,
        color: "transparent",
        weight: 0,
        fillColor: color,
        fillOpacity: opacity,
        interactive: true,
      });

      circle.bindTooltip(`${count} dropoff${count !== 1 ? "s" : ""} in this area`, {
        sticky: true,
        direction: "top",
        offset: [0, -8],
      });

      circle.addTo(dropoffLayer);
    });
  }, [showDropoffs, dropoffData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routeHeatLayerRef.current) {
      if (map.hasLayer(routeHeatLayerRef.current)) {
        map.removeLayer(routeHeatLayerRef.current);
      }
      routeHeatLayerRef.current = null;
    }

    if (!showRouteHeat) return;

    const points = routeData?.points ?? [];
    if (points.length === 0) return;

    const heatLayer = L.heatLayer(points, {
      radius: 18,
      blur: 22,
      maxZoom: 14,
      gradient: { 0.3: "#0000ff", 0.6: "#00ff00", 0.9: "#ff0000" },
    });

    heatLayer.addTo(map);
    routeHeatLayerRef.current = heatLayer;
  }, [showRouteHeat, routeData]);

  useEffect(() => {
    const map = mapRef.current;
    const heatLayer = heatLayerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!map || !heatLayer || !labelLayer) return;

    if (showDensity) {
      if (!map.hasLayer(heatLayer)) heatLayer.addTo(map);
    } else {
      if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      if (map.hasLayer(labelLayer)) map.removeLayer(labelLayer);
    }
  }, [showDensity]);

  useEffect(() => {
    if (!legendDivRef.current) return;
    legendDivRef.current.innerHTML = buildLegendHTML(showDensity, showPickups, showDropoffs, showRouteHeat);
  }, [showDensity, showPickups, showDropoffs, showRouteHeat]);

  const isEmpty = !isLoading && cells.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Heat View</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Ride demand density map for Morocco
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { value: "today", label: "Today" },
            { value: "7d", label: "7 Days" },
            { value: "30d", label: "30 Days" },
          ].map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {r.label}
            </button>
          ))}

          <div className="w-px h-5 bg-border mx-1" />

          {!confirmClear ? (
            <button
              onClick={() => { setConfirmClear(true); setClearResult(null); }}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
            >
              Clear seed data
            </button>
          ) : (
            <div className="flex items-center gap-1.5 border border-red-300 rounded-md px-2 py-1 bg-red-50">
              <span className="text-xs text-red-700 font-medium">Delete all seed rides?</span>
              <button
                onClick={handleClearSeedData}
                disabled={clearing}
                className="px-2 py-0.5 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {clearing ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
                className="px-2 py-0.5 rounded text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {clearResult && (
        <div className={`mb-4 px-4 py-2.5 rounded-md text-sm font-medium flex items-center justify-between ${
          clearResult.startsWith("Failed")
            ? "bg-red-50 text-red-700 border border-red-200"
            : "bg-green-50 text-green-700 border border-green-200"
        }`}>
          <span>{clearResult}</span>
          <button
            onClick={() => setClearResult(null)}
            className="text-current opacity-60 hover:opacity-100 text-lg leading-none ml-4"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { value: "ride_requests", label: "All" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              type === t.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}

        <div className="w-px bg-border mx-1" />

        <button
          onClick={() => setShowDensity((v) => !v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showDensity
              ? "border-orange-500 bg-orange-50 text-orange-700"
              : "border-border text-muted-foreground hover:border-muted-foreground"
          }`}
        >
          Ride Density
        </button>

        <button
          onClick={() => setShowPickups((v) => !v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showPickups
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-border text-muted-foreground hover:border-muted-foreground"
          }`}
        >
          Pickup Hotspots
        </button>

        <button
          onClick={() => setShowDropoffs((v) => !v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showDropoffs
              ? "border-emerald-600 bg-emerald-50 text-emerald-700"
              : "border-border text-muted-foreground hover:border-muted-foreground"
          }`}
        >
          Dropoff Hotspots
        </button>

        <button
          onClick={() => setShowRouteHeat((v) => !v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showRouteHeat
              ? "border-green-500 bg-green-50 text-green-700"
              : "border-border text-muted-foreground hover:border-muted-foreground"
          }`}
        >
          Route Heat
        </button>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          <div className="rounded-lg border bg-card overflow-hidden mb-6 relative">
            {isLoading && (
              <div className="absolute inset-0 z-10 bg-background/60 flex items-center justify-center rounded-lg">
                <Skeleton className="h-8 w-32" />
              </div>
            )}
            {isEmpty && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
                style={{ zIndex: 500 }}
              >
                <div className="bg-white/90 rounded-xl px-6 py-4 shadow text-center">
                  <p className="text-base font-semibold text-gray-700">No ride data for this period</p>
                  <p className="text-xs text-gray-400 mt-1">Try a different time range or type</p>
                </div>
              </div>
            )}
            {googleTilesFailed && !googleTilesWarningDismissed && (
              <div
                className="absolute top-3 left-3 right-3 z-[600] bg-amber-50/95 border border-amber-300 text-amber-900 rounded-md px-3 py-1.5 shadow text-[11px] font-medium flex items-start gap-2"
                data-testid="banner-google-tiles-failed"
                role="alert"
              >
                <span className="flex-1">
                  {gmapsKey
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
            <div ref={mapContainerRef} style={{ height: 420, width: "100%" }} />
          </div>

          <div className="rounded-lg border bg-card p-4">
            <p className="font-semibold text-sm mb-3">Summary</p>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="flex gap-8">
                <div>
                  <p className="text-3xl font-bold text-orange-600">{totalRides.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total rides ({range === "today" ? "today" : range === "7d" ? "last 7 days" : "last 30 days"})
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-blue-600">{activeCells.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-1">Active grid cells</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedCell && (
          <div className="w-80 shrink-0 rounded-lg border bg-card shadow-md flex flex-col" style={{ maxHeight: 500 }}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <p className="font-semibold text-sm">Cell Rides</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedCell.count} ride{selectedCell.count !== 1 ? "s" : ""} near ({selectedCell.lat.toFixed(2)}, {selectedCell.lng.toFixed(2)})
                </p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                aria-label="Close panel"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-3 py-2 space-y-2">
              {cellLoading && (
                <div className="space-y-2 pt-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              )}
              {!cellLoading && (cellData?.rides ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No rides found in this cell.</p>
              )}
              {(cellData?.rides ?? []).map((ride) => (
                <div key={ride.id} className="rounded-md border p-2.5 text-xs space-y-1.5 bg-background">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground truncate">
                      #{ride.id.slice(0, 8)}
                    </span>
                    <StatusBadge status={ride.status} />
                  </div>
                  <div className="text-[11px] text-foreground/80 truncate" title={ride.pickupLabel}>
                    <span className="text-muted-foreground">From:</span> {ride.pickupLabel}
                  </div>
                  <div className="text-[11px] text-foreground/80 truncate" title={ride.dropoffLabel}>
                    <span className="text-muted-foreground">To:</span> {ride.dropoffLabel}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>Rider: <span className="text-foreground">{ride.riderName}</span></span>
                    {ride.driverName && (
                      <span>Driver: <span className="text-foreground">{ride.driverName}</span></span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{formatTime(ride.createdAt)}</span>
                    {ride.finalAmount != null && (
                      <span className="font-semibold text-green-700">{ride.finalAmountDisplay
                        ? formatAmount(
                            ride.finalAmountDisplay.displayAmount,
                            ride.finalAmountDisplay.displayCurrency,
                          )
                        : formatAmount(ride.finalAmount, displayCurrency.code)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
