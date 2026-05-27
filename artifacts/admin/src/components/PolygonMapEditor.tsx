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

export interface PolygonMapEditorProps {
  value: string | null;
  onChange: (geoJson: string | null) => void;
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

export function PolygonMapEditor({
  value,
  onChange,
  settings,
}: PolygonMapEditorProps & { settings: MapSettings }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef<string | null>(value);
  // True when the map ended up on the Carto Light fallback (no Google
  // Maps web key configured, or the JS API failed to load). Drives a
  // dismissible inline warning so admins know they need to fix their
  // key in Settings → Maps instead of silently editing on a fallback.
  const [fallbackActive, setFallbackActive] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  // Reset failure / dismissed state whenever the key changes — a fresh
  // attempt deserves a fresh warning. Mirrors Live Map / Heat View.
  useEffect(() => {
    setFallbackActive(false);
    setFallbackReason(null);
    setWarningDismissed(false);
  }, [settings.gmapsKey]);
  // Tracks the most recent JSON we either rendered from a prop or emitted to
  // the parent. Used to skip redundant prop-syncs and avoid feedback loops.
  const lastSyncedRef = useRef<string | null>(value);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const renderValueOnLayer = (json: string | null) => {
    const drawnItems = drawnItemsRef.current;
    const map = mapRef.current;
    if (!drawnItems || !map) return;
    drawnItems.clearLayers();
    if (!json) return;
    try {
      const geo = JSON.parse(json) as GeoJSON.GeoJsonObject;
      const layer = L.geoJSON(geo);
      layer.eachLayer((l) => drawnItems.addLayer(l as L.Polygon));
      const bounds = drawnItems.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    } catch {
      // ignore invalid stored polygon
    }
  };

  // Sync incoming `value` (e.g. async-loaded edit data, or external resets)
  // into the map layer once the map has finished initializing. Skip when the
  // incoming value is the same one we last rendered or emitted, so user edits
  // don't get clobbered by parent re-renders.
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current) return;
    if (value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    renderValueOnLayer(value);
  }, [value]);

  // Initialize map. Re-runs (after cleanup) when the Google Maps key changes
  // — for example when settings finish loading — so the standardized Google
  // Roadmap base layer is always honored instead of being locked to whatever
  // the first render saw. When no key is configured (or the JS API fails to
  // load), the map falls back to a clean Carto Light basemap so the editor
  // is never blank.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    const addFallbackBase = (map: L.Map, reason?: string) => {
      setFallbackActive(true);
      if (reason) setFallbackReason(reason);
      // Google primary, raw OSM tile server fallback. MapTiler + CARTO
      // were removed from the maps stack.
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
      // leaflet-draw expects a global `L` reference. Expose our import to
      // window in a typed-safe way before loading the plugin's side effects.
      (window as unknown as GoogleMapsWindow).L = L;
      await import("leaflet-draw");
      if (settings.gmapsKey) {
        const gridImport = (await import("leaflet.gridlayer.googlemutant")) as unknown as { default?: GoogleMutantNamespace } & GoogleMutantNamespace;
        void gridImport;
      }
      const gridNs: GoogleMutantNamespace = (L as unknown as { gridLayer: GoogleMutantNamespace }).gridLayer;
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
          const googleReady = !!(window as unknown as GoogleMapsWindow).google?.maps;
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

      // Render existing polygon if present (from initial mount value).
      if (initialValueRef.current) {
        lastSyncedRef.current = initialValueRef.current;
        renderValueOnLayer(initialValueRef.current);
      }
      // If `value` changed while we were initializing (e.g. async edit data
      // arrived after mount), apply the latest value now.
      else if (value && value !== lastSyncedRef.current) {
        lastSyncedRef.current = value;
        renderValueOnLayer(value);
      }

      const drawControl = new L.Control.Draw({
        position: "topleft",
        edit: { featureGroup: drawnItems, remove: true },
        draw: {
          polygon: {
            allowIntersection: false,
            showArea: true,
            shapeOptions: { color: "#3819A6", weight: 2 },
          },
          polyline: false,
          rectangle: false,
          circle: false,
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
        const last = layers[layers.length - 1] as L.Polygon;
        const geo = last.toGeoJSON();
        const json = JSON.stringify(geo);
        lastSyncedRef.current = json;
        onChangeRef.current(json);
      };

      map.on(L.Draw.Event.CREATED, (e: L.LeafletEvent) => {
        // Only one polygon allowed; replace any previous shape.
        const created = e as L.LeafletEvent & { layer: L.Layer };
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
    <div className="relative w-full h-full min-h-[480px]">
      <div
        ref={containerRef}
        className="w-full h-full min-h-[480px] rounded-lg border bg-muted"
        data-testid="polygon-map-editor"
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
