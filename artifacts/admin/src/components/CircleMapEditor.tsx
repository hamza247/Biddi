import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  loadGoogleMaps,
  type GoogleMapsLoadResult,
} from "@/lib/google-maps-loader";

const MOROCCO_CENTER: [number, number] = [33.82, -7.18];
const MOROCCO_ZOOM = 6;

export interface CircleValue {
  centerLat: number;
  centerLng: number;
  radiusM: number;
}

export interface CircleMapEditorProps {
  value: CircleValue | null;
  onChange: (value: CircleValue | null) => void;
}

interface GoogleMapsWindow {
  google?: { maps?: unknown };
  L?: typeof L;
}

interface GoogleMutantNamespace {
  googleMutant: (opts: { type: string; maxZoom?: number }) => L.Layer;
}

interface MapSettings {
  gmapsKey: string | null;
}

function valuesEqual(a: CircleValue | null, b: CircleValue | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.centerLat - b.centerLat) < 1e-9 &&
    Math.abs(a.centerLng - b.centerLng) < 1e-9 &&
    Math.abs(a.radiusM - b.radiusM) < 1e-3
  );
}

export function CircleMapEditor({
  value,
  onChange,
  settings,
}: CircleMapEditorProps & { settings: MapSettings }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef<CircleValue | null>(value);
  const lastSyncedRef = useRef<CircleValue | null>(value);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  useEffect(() => {
    setFallbackActive(false);
    setFallbackReason(null);
    setWarningDismissed(false);
  }, [settings.gmapsKey]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const renderValueOnLayer = (v: CircleValue | null) => {
    const drawnItems = drawnItemsRef.current;
    const map = mapRef.current;
    if (!drawnItems || !map) return;
    drawnItems.clearLayers();
    if (!v) return;
    const circle = L.circle([v.centerLat, v.centerLng], {
      radius: v.radiusM,
      color: "#3819A6",
      weight: 2,
    });
    drawnItems.addLayer(circle);
    const bounds = circle.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  };

  // Sync incoming `value` into the map layer when it changes externally.
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current) return;
    if (valuesEqual(value, lastSyncedRef.current)) return;
    lastSyncedRef.current = value;
    renderValueOnLayer(value);
  }, [value]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    const addFallbackBase = (map: L.Map, reason?: string) => {
      setFallbackActive(true);
      if (reason) setFallbackReason(reason);
      // Google is the primary tile source; if it can't load (no key /
      // quota), fall back to the OpenStreetMap raster tile server. MapTiler
      // + CARTO were intentionally removed from the stack.
      const layer = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          subdomains: "abc",
          maxZoom: 19,
        },
      );
      layer.addTo(map);
    };

    const init = async () => {
      (window as unknown as GoogleMapsWindow).L = L;
      await import("leaflet-draw");
      if (settings.gmapsKey) {
        const gridImport = (await import(
          "leaflet.gridlayer.googlemutant"
        )) as unknown as { default?: GoogleMutantNamespace } & GoogleMutantNamespace;
        void gridImport;
      }
      const gridNs: GoogleMutantNamespace = (
        L as unknown as { gridLayer: GoogleMutantNamespace }
      ).gridLayer;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        center: MOROCCO_CENTER,
        zoom: MOROCCO_ZOOM,
        zoomControl: true,
      });

      if (settings.gmapsKey) {
        try {
          const result: GoogleMapsLoadResult = await loadGoogleMaps(settings.gmapsKey);
          if (cancelled) return;
          const googleReady = !!(window as unknown as GoogleMapsWindow).google
            ?.maps;
          if (result.status === "ready" && googleReady) {
            const gLayer = gridNs.googleMutant({ type: "roadmap", maxZoom: 20 });
            gLayer.addTo(map);
            setFallbackActive(false);
            setFallbackReason(null);
          } else {
            const reason =
              result.status === "ready"
                ? "Google Maps loaded but the API global never became available — showing a fallback basemap."
                : result.message;
            addFallbackBase(map, reason);
          }
        } catch {
          addFallbackBase(map, "Could not load the Google Maps JavaScript API.");
        }
      } else {
        addFallbackBase(map);
      }

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawnItemsRef.current = drawnItems;
      mapRef.current = map;

      if (initialValueRef.current) {
        lastSyncedRef.current = initialValueRef.current;
        renderValueOnLayer(initialValueRef.current);
      } else if (value && !valuesEqual(value, lastSyncedRef.current)) {
        lastSyncedRef.current = value;
        renderValueOnLayer(value);
      }

      const drawControl = new L.Control.Draw({
        position: "topleft",
        edit: { featureGroup: drawnItems, remove: true },
        draw: {
          polygon: false,
          polyline: false,
          rectangle: false,
          circle: {
            shapeOptions: { color: "#3819A6", weight: 2 },
            showRadius: true,
            metric: true,
          },
          circlemarker: false,
          marker: false,
        },
      });
      map.addControl(drawControl);

      const emitChange = () => {
        const layers: L.Layer[] = [];
        drawnItems.eachLayer((l) => layers.push(l));
        if (layers.length === 0) {
          lastSyncedRef.current = null;
          onChangeRef.current(null);
          return;
        }
        const last = layers[layers.length - 1] as L.Circle;
        const center = last.getLatLng();
        const radius = last.getRadius();
        const next: CircleValue = {
          centerLat: center.lat,
          centerLng: center.lng,
          radiusM: Math.round(radius),
        };
        lastSyncedRef.current = next;
        onChangeRef.current(next);
      };

      map.on(L.Draw.Event.CREATED, (e: L.LeafletEvent) => {
        const created = e as L.LeafletEvent & { layer: L.Layer };
        // Only one circle allowed; replace any previous one.
        drawnItems.clearLayers();
        drawnItems.addLayer(created.layer);
        emitChange();
      });
      map.on(L.Draw.Event.EDITED, () => emitChange());
      map.on(L.Draw.Event.DELETED, () => emitChange());
    };

    void init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        drawnItemsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.gmapsKey]);

  return (
    <div className="relative w-full h-full min-h-[360px]">
      <div
        ref={containerRef}
        className="w-full h-full min-h-[360px] rounded-lg border bg-muted"
        data-testid="circle-map-editor"
      />
      {fallbackActive && !warningDismissed && (
        <div
          className="absolute top-3 left-3 right-3 z-[600] bg-amber-50/95 border border-amber-300 text-amber-900 rounded-md px-3 py-1.5 shadow text-[11px] font-medium flex items-start gap-2"
          data-testid="banner-google-tiles-failed"
          role="alert"
        >
          <span className="flex-1">
            {settings.gmapsKey
              ? fallbackReason ??
                "Google Maps tiles unavailable — showing a fallback basemap. Check your Google Maps web key in Settings."
              : "No Google Maps web key configured — showing a fallback basemap. Add a key in Settings → Maps to enable the standard Google Roadmap."}
          </span>
          <button
            type="button"
            onClick={() => setWarningDismissed(true)}
            className="text-amber-700 hover:text-amber-900 font-bold leading-none px-1"
            aria-label="Dismiss warning"
            data-testid="button-dismiss-google-tiles-warning"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
