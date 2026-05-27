import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { decodePolyline } from "@/lib/maps";
import { useConfig, getPlatformMapsKey } from "@/lib/config";
import {
  loadGoogleMaps,
  describeLoadResult,
  subscribeAuthFailure,
  type GoogleMapsLoadResult,
} from "@/lib/googleMapsLoader.web";

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface AppMapHandle {
  recenter: (lat: number, lng: number, delta?: number) => void;
  fitPoints: (pts: Array<{ lat: number; lng: number }>) => void;
}

/**
 * Real-time surge zone — duplicated from AppMap.tsx so the web shim doesn't
 * have to import the native-only module. The web map is intentionally a
 * non-rendering shim for heatmap data; we just accept the prop so callers
 * (driver home) can pass it without TS errors.
 */
export interface DemandZone {
  lat: number;
  lng: number;
  intensity: number;
  surgeMultiplier: number;
  bonus?: number;
  labelMode: "multiplier" | "bonus" | "off";
}

interface Props {
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  routePolyline?: string | null;
  fit?: boolean;
  centerPin?: boolean;
  onCenterChange?: (lat: number, lng: number) => void;
  /** Demand zones from the server heatmap aggregator. Not rendered on web. */
  heatmapZones?: DemandZone[];
  etaLabelsEnabled?: boolean;
  alwaysShow?: boolean;
  initialCenter?: MapPoint;
  seedRegion?: unknown;
  onUserPan?: () => void;
  onRegionChangeComplete?: (region: unknown) => void;
  onRegionChange?: (lat: number, lng: number) => void;
  drivers?: unknown;
  selfDriver?: unknown;
}

declare global {
  interface Window {
    google?: any;
  }
}

/**
 * Web map renderer. Standardized to the Google Maps JS API when a web key
 * is configured. When no web key is available — or the configured key is
 * rejected by Google (invalid, referrer not allowed, API not activated,
 * billing not enabled) — falls back to a clean Carto Light basemap
 * (rendered via Leaflet inside a sandboxed iframe) and shows the same
 * actionable reason banner that the admin maps display, so internal QA
 * can reproduce key issues quickly.
 */
export const AppMap = forwardRef<AppMapHandle, Props>(function AppMap(
  { pickup, dropoff, routePolyline, centerPin = false, onCenterChange },
  outerRef,
) {
  const cfg = useConfig();
  const key = getPlatformMapsKey(cfg);

  const [loadResult, setLoadResult] = useState<GoogleMapsLoadResult | null>(
    key ? null : { status: "script-error", message: "" },
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const useFallback = !key || (loadResult !== null && loadResult.status !== "ready");

  // Re-show the banner whenever the failure reason changes so a new
  // (distinct) error isn't hidden by a previous dismissal.
  const bannerSignature = `${key ? "k" : "nk"}:${loadResult?.status ?? "pending"}:${
    loadResult && loadResult.status === "auth-failed" ? loadResult.reason : ""
  }`;
  useEffect(() => {
    setBannerDismissed(false);
  }, [bannerSignature]);

  const polylinePts = useMemo(
    () => (routePolyline ? decodePolyline(routePolyline) : []),
    [routePolyline],
  );

  // Google Maps refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gMapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const idleListenerRef = useRef<any>(null);

  // Fallback iframe ref (for recenter commands)
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Expose recenter and fitPoints to parent via ref
  useImperativeHandle(outerRef, () => ({
    recenter(lat: number, lng: number) {
      if (useFallback) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "biddiRecenter", lat, lng },
            "*",
          );
        } catch {
          /* cross-origin guard */
        }
      } else if (gMapRef.current) {
        gMapRef.current.panTo({ lat, lng });
        gMapRef.current.setZoom(15);
      }
    },
    fitPoints(pts: Array<{ lat: number; lng: number }>) {
      if (pts.length === 0) return;
      if (useFallback) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "biddiFitPoints", pts },
            "*",
          );
        } catch {
          /* cross-origin guard */
        }
      } else if (gMapRef.current && window.google?.maps) {
        const bounds = new window.google.maps.LatLngBounds();
        pts.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
        gMapRef.current.fitBounds(bounds, 60);
      }
    },
  }));

  // ── Kick off the loader (and subscribe to late-arriving auth failures) ────
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadGoogleMaps(key)
      .then((result) => {
        if (cancelled) return;
        setLoadResult(result);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadResult({
          status: "script-error",
          message: "Could not load the Google Maps JavaScript API.",
        });
      });
    const unsub = subscribeAuthFailure((r) => {
      if (cancelled) return;
      setLoadResult(r);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [key]);

  // ── Google Maps effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (useFallback) return;
    if (typeof window === "undefined") return;
    if (!window.google?.maps || !containerRef.current) return;
    const google = window.google;
    const center = pickup ?? dropoff ?? { lat: 33.5731, lng: -7.5898 };
    if (!gMapRef.current) {
      gMapRef.current = new google.maps.Map(containerRef.current, {
        center: { lat: center.lat, lng: center.lng },
        zoom: 14,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      if (centerPin && onCenterChange) {
        idleListenerRef.current = gMapRef.current.addListener("idle", () => {
          const c = gMapRef.current?.getCenter();
          if (c) onCenterChange(c.lat(), c.lng());
        });
      }
    } else if (centerPin && pickup) {
      gMapRef.current.panTo({ lat: pickup.lat, lng: pickup.lng });
    } else if (!centerPin && (pickup ?? dropoff)) {
      gMapRef.current.setCenter({ lat: center.lat, lng: center.lng });
    }

    if (centerPin) return;

    for (const o of overlaysRef.current) o.setMap(null);
    overlaysRef.current = [];

    if (pickup) {
      overlaysRef.current.push(
        new google.maps.Marker({
          position: { lat: pickup.lat, lng: pickup.lng },
          map: gMapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#FF6B3D",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 3,
          },
        }),
      );
    }
    if (dropoff) {
      overlaysRef.current.push(
        new google.maps.Marker({
          position: { lat: dropoff.lat, lng: dropoff.lng },
          map: gMapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#3819A6",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 3,
          },
        }),
      );
    }
    if (polylinePts.length > 0) {
      const path = polylinePts.map((p) => ({ lat: p.latitude, lng: p.longitude }));
      const line = new google.maps.Polyline({
        path,
        strokeColor: "#3819A6",
        strokeOpacity: 0.9,
        strokeWeight: 5,
        map: gMapRef.current,
      });
      overlaysRef.current.push(line);
      const bounds = new google.maps.LatLngBounds();
      path.forEach((p: any) => bounds.extend(p));
      gMapRef.current.fitBounds(bounds, 40);
    } else if (pickup && dropoff) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: pickup.lat, lng: pickup.lng });
      bounds.extend({ lat: dropoff.lat, lng: dropoff.lng });
      gMapRef.current.fitBounds(bounds, 40);
    }
  }, [useFallback, loadResult, pickup, dropoff, polylinePts, centerPin, onCenterChange]);

  // ── Fallback postMessage bridge (center-change + recenter responses) ──────
  useEffect(() => {
    if (!useFallback || !centerPin || !onCenterChange) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "biddiCenter") {
        onCenterChange(e.data.lat as number, e.data.lng as number);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [useFallback, centerPin, onCenterChange]);

  // ── Fallback HTML builder (raw OSM tile server via Leaflet) ─────────────────
  // Used when Google Maps JS API isn't loaded. MapTiler + CARTO were removed
  // from the stack so this is the only remaining tile source.
  const fallbackHtml = useMemo(() => {
    if (!useFallback) return null;

    const tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const tileAttr = "&copy; OpenStreetMap contributors";
    const tileLayer = `L.tileLayer('${tileUrl}',{maxZoom:19,subdomains:'abc',attribution:'${tileAttr}'}).addTo(map);`;

    if (centerPin) {
      const center = pickup ?? { lat: 33.5731, lng: -7.5898 };
      return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#E5E7EB}</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([${center.lat},${center.lng}],14);
${tileLayer}
function postCenter(){var c=map.getCenter();window.parent.postMessage({type:'biddiCenter',lat:c.lat,lng:c.lng},'*');}
map.on('moveend',postCenter);
map.on('zoomend',postCenter);
window.addEventListener('message',function(e){
  if(!e.data)return;
  if(e.data.type==='biddiRecenter'){map.setView([e.data.lat,e.data.lng],map.getZoom(),{animate:true});}
  if(e.data.type==='biddiFitPoints'&&e.data.pts&&e.data.pts.length){
    var b=L.latLngBounds(e.data.pts.map(function(p){return[p.lat,p.lng];}));
    map.fitBounds(b,{padding:[40,40],animate:true});
  }
});
</script></body></html>`;
    }

    const center = pickup ?? dropoff ?? { lat: 33.5731, lng: -7.5898 };
    const polylineLatLngs = polylinePts
      .map((p) => `[${p.latitude},${p.longitude}]`)
      .join(",");
    const draw: string[] = [];
    if (pickup) {
      draw.push(
        `L.circleMarker([${pickup.lat},${pickup.lng}],{radius:8,color:'#fff',weight:3,fillColor:'#FF6B3D',fillOpacity:1}).addTo(map);`,
      );
    }
    if (dropoff) {
      draw.push(
        `L.circleMarker([${dropoff.lat},${dropoff.lng}],{radius:8,color:'#fff',weight:3,fillColor:'#3819A6',fillOpacity:1}).addTo(map);`,
      );
    }
    if (polylineLatLngs) {
      draw.push(
        `var line=L.polyline([${polylineLatLngs}],{color:'#3819A6',weight:5,opacity:0.9}).addTo(map);map.fitBounds(line.getBounds(),{padding:[40,40]});`,
      );
    } else if (pickup && dropoff) {
      draw.push(
        `map.fitBounds([[${pickup.lat},${pickup.lng}],[${dropoff.lat},${dropoff.lng}]],{padding:[40,40]});`,
      );
    }
    return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#E5E7EB}</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([${center.lat},${center.lng}],13);
${tileLayer}
${draw.join("\n")}
window.addEventListener('message',function(e){
  if(!e.data)return;
  if(e.data.type==='biddiRecenter'){map.setView([e.data.lat,e.data.lng],map.getZoom(),{animate:true});}
  if(e.data.type==='biddiFitPoints'&&e.data.pts&&e.data.pts.length){
    var b=L.latLngBounds(e.data.pts.map(function(p){return[p.lat,p.lng];}));
    map.fitBounds(b,{padding:[40,40],animate:true});
  }
});
</script></body></html>`;
  }, [useFallback, centerPin, pickup, dropoff, polylinePts]);

  // ── Banner message (mirrors the admin reason banner) ──────────────────────
  const bannerMessage = useMemo(() => {
    if (!useFallback) return "";
    if (!key) {
      return "No Google Maps web key configured — showing a fallback basemap.";
    }
    if (loadResult) return describeLoadResult(loadResult, true);
    return "";
  }, [useFallback, key, loadResult]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (useFallback) {
    return (
      <View style={styles.container}>
        {/* @ts-ignore iframe is valid under react-native-web */}
        <iframe
          ref={iframeRef}
          title="Map"
          srcDoc={fallbackHtml ?? ""}
          style={iframeStyle}
          loading="lazy"
          sandbox="allow-scripts"
        />
        {!bannerDismissed && bannerMessage ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>{bannerMessage}</Text>
            <Pressable
              onPress={() => setBannerDismissed(true)}
              accessibilityLabel="Dismiss warning"
              hitSlop={8}
              style={styles.dismissBtn}
            >
              <Text style={styles.dismissText}>×</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* @ts-ignore native div under react-native-web */}
      <div ref={containerRef} style={divStyle} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: "#E5E7EB" },
  note: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FCD34D",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  noteText: {
    flex: 1,
    color: "#78350F",
    fontSize: 12,
    fontWeight: "500",
  },
  dismissBtn: {
    paddingHorizontal: 4,
  },
  dismissText: {
    color: "#92400E",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 16,
  },
});

const iframeStyle = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  border: 0,
};

const divStyle = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
};
