import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useConfig, getPlatformMapsKey } from "@/lib/config";
import {
  loadGoogleMaps,
  describeLoadResult,
  subscribeAuthFailure,
  type GoogleMapsLoadResult,
} from "@/lib/googleMapsLoader.web";

export interface MapPickerHandle {
  animateToCenter(lat: number, lng: number): void;
}

interface Props {
  initialLat: number;
  initialLng: number;
  onRegionChangeComplete: (lat: number, lng: number) => void;
  innerRef?: React.MutableRefObject<MapPickerHandle | null>;
}

declare global {
  interface Window {
    google?: any;
  }
}

/**
 * Web map picker. Standardized to the Google Maps JS API base layer when a
 * web key is configured. Without a key — or when the configured key is
 * rejected by Google (invalid, referrer not allowed, API not activated,
 * billing not enabled) — falls back to a Carto Light basemap (rendered via
 * Leaflet inside a sandboxed iframe) and shows the same actionable reason
 * banner that the admin maps display, so internal QA can reproduce key
 * issues quickly.
 *
 * The center pin overlay is rendered by the parent screen on top of this
 * component, matching the inDrive-style picker UX.
 */
export function MapPicker({
  initialLat,
  initialLng,
  onRegionChangeComplete,
  innerRef,
}: Props) {
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

  // ── Google Maps refs ──────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gMapRef = useRef<any>(null);
  const idleListenerRef = useRef<any>(null);

  // ── Fallback iframe refs ──────────────────────────────────────────────────
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const channelIdRef = useRef<string>(`mp_${Math.random().toString(36).slice(2)}`);

  // ── Imperative API exposed to parent ──────────────────────────────────────
  React.useImperativeHandle(
    innerRef as React.RefObject<MapPickerHandle>,
    () => ({
      animateToCenter(lat, lng) {
        if (useFallback) {
          const w = iframeRef.current?.contentWindow;
          if (!w) return;
          w.postMessage(
            { channel: channelIdRef.current, type: "setCenter", lat, lng },
            "*",
          );
        } else if (gMapRef.current) {
          gMapRef.current.panTo({ lat, lng });
        }
      },
    }),
    [useFallback],
  );

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

  // ── Google Maps mount ─────────────────────────────────────────────────────
  useEffect(() => {
    if (useFallback) return;
    if (typeof window === "undefined") return;
    if (!window.google?.maps || !containerRef.current) return;
    const google = window.google;
    if (!gMapRef.current) {
      gMapRef.current = new google.maps.Map(containerRef.current, {
        center: { lat: initialLat, lng: initialLng },
        zoom: 15,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      idleListenerRef.current = gMapRef.current.addListener("idle", () => {
        const c = gMapRef.current?.getCenter();
        if (c) onRegionChangeComplete(c.lat(), c.lng());
      });
    }
    // initialLat/initialLng intentionally omitted — only the first mount
    // seeds the viewport; subsequent recenters use animateToCenter().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useFallback, loadResult, onRegionChangeComplete]);

  // ── Fallback iframe HTML (raw OSM tile server via Leaflet) ─────────────────
  // MapTiler + CARTO were removed from the stack so this is the only
  // remaining tile source when Google Maps JS API can't load.
  const fallbackHtml = useMemo(() => {
    if (!useFallback) return null;
    const channelId = channelIdRef.current;
    const tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const tileAttr = "&copy; OpenStreetMap contributors";
    const tileLayerCall = `L.tileLayer('${tileUrl}',{maxZoom:19,subdomains:'abc',attribution:'${tileAttr}'}).addTo(map);`;
    return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#E5E7EB}</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var CH=${JSON.stringify(channelId)};
  var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([${initialLat},${initialLng}],15);
  ${tileLayerCall}
  function send(){
    var c=map.getCenter();
    parent.postMessage({channel:CH,type:'moveend',lat:c.lat,lng:c.lng},'*');
  }
  map.on('moveend', send);
  window.addEventListener('message',function(ev){
    var d=ev.data||{};
    if(d.channel!==CH) return;
    if(d.type==='setCenter' && typeof d.lat==='number' && typeof d.lng==='number'){
      map.setView([d.lat,d.lng], map.getZoom(), {animate:true});
    }
  });
  parent.postMessage({channel:CH,type:'ready'},'*');
})();
</script></body></html>`;
  }, [useFallback, initialLat, initialLng]);

  // ── Fallback postMessage bridge ───────────────────────────────────────────
  useEffect(() => {
    if (!useFallback) return;
    if (typeof window === "undefined") return;
    const channel = channelIdRef.current;
    const onMessage = (ev: MessageEvent) => {
      const data: any = ev.data;
      if (!data || data.channel !== channel) return;
      if (data.type === "moveend" && typeof data.lat === "number" && typeof data.lng === "number") {
        onRegionChangeComplete(data.lat, data.lng);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [useFallback, onRegionChangeComplete]);

  // ── Banner message (mirrors the admin reason banner) ──────────────────────
  const bannerMessage = useMemo(() => {
    if (!useFallback) return "";
    if (!key) {
      return "No Google Maps web key configured — showing a fallback basemap.";
    }
    if (loadResult) return describeLoadResult(loadResult, true);
    return "";
  }, [useFallback, key, loadResult]);

  if (useFallback) {
    return (
      <View style={styles.container}>
        {/* @ts-ignore iframe is a valid web element under react-native-web */}
        <iframe
          ref={iframeRef as any}
          title="Map picker"
          srcDoc={fallbackHtml ?? ""}
          style={iframeStyle}
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
}

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
