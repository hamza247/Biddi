import { Feather } from "@expo/vector-icons";
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import MapView, {
  AnimatedRegion,
  Circle,
  Marker,
  Polyline,
  type Region,
} from "react-native-maps";

import { decodePolyline } from "@/lib/maps";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig, getPlatformMapsKey } from "@/lib/config";
import { MapBackdrop } from "./MapBackdrop";
import { DriverPin } from "./DriverPin";
import type { NearbyDriver } from "@/hooks/useNearbyDrivers";

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * Real-time surge zone broadcast by the server heatmap aggregator. Replaces the
 * old static 24-hour demand zone shape.
 */
export interface DemandZone {
  lat: number;
  lng: number;
  /** Normalised tier 0..1 (0=light, 0.25, 0.5, 0.75, 1=very high). */
  intensity: number;
  surgeMultiplier: number;
  bonus?: number;
  labelMode: "multiplier" | "bonus" | "off";
}

export interface AppMapHandle {
  recenter: (lat: number, lng: number, delta?: number, lngDelta?: number) => void;
  fitPoints: (pts: Array<{ lat: number; lng: number }>) => void;
}

interface Props {
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  routePolyline?: string | null;
  /** When true, fits the camera to show pickup, dropoff, and the polyline. */
  fit?: boolean;
  /** Center-pin mode: map is always shown, no markers, fires onCenterChange after each pan. */
  centerPin?: boolean;
  onCenterChange?: (lat: number, lng: number) => void;
  /** Nearby drivers to render as real map markers. */
  drivers?: NearbyDriver[];
  /** Demand zones for heatmap overlay on the driver home screen. */
  heatmapZones?: DemandZone[];
  /** Whether to show ETA pill labels on demand zones. */
  etaLabelsEnabled?: boolean;
  /** When true, always renders the map even without pickup/dropoff (driver mode). */
  alwaysShow?: boolean;
  /** Initial region for the map when no pickup/dropoff is set. */
  initialCenter?: MapPoint;
  /**
   * Full initial region (lat, lng, and deltas) that takes priority over initialCenter and the
   * fallback region. Use this to restore a previously saved viewport exactly.
   */
  seedRegion?: Region;
  /** Called when the user drags the map (distinguishes manual pans from programmatic recenters). */
  onUserPan?: () => void;
  /** Called after any region change (pan or zoom) with the full Region object.
   *  Use this when you need zoom deltas (e.g. to persist the full viewport). */
  onRegionChangeComplete?: (region: Region) => void;
  /** Called when the map camera settles after any gesture with just the centre.
   *  Useful for lightweight session-level centre tracking. */
  onRegionChange?: (lat: number, lng: number) => void;
  /**
   * The driver's own current position. When provided, renders a branded DriverPin marker
   * that animates smoothly to each new GPS coordinate. Used on the driver trip screen.
   */
  selfDriver?: { lat: number; lng: number; heading?: number | null; vehicleCategory?: "car" | "moto" } | null;
}

const FALLBACK_REGION: Region = {
  latitude: 33.5731,
  longitude: -7.5898,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

const ANIMATE_DURATION_MS = 1400;
const FADE_IN_DURATION_MS = 360;
/** Maximum number of nearby driver markers rendered at once. Keeps the map
 *  uncluttered and avoids per-marker render churn when many drivers are
 *  available. */
const MAX_VISIBLE_DRIVERS = 24;
/** Number of "primary" closest driver markers shown at full opacity; the rest
 *  fade slightly so the eye is drawn to the relevant ones. */
const PRIMARY_DRIVER_COUNT = 6;
const FADED_DRIVER_OPACITY = 0.55;
/** Threshold (in latitudeDelta) above which dense driver markers collapse
 *  into cluster bubbles. ~0.025 corresponds to a roughly neighbourhood-sized
 *  view; zooming out past it begins clustering. */
const CLUSTER_LAT_DELTA_THRESHOLD = 0.025;
/** Approximate number of cluster cells per axis at any zoom level. */
const CLUSTER_GRID_DIVISIONS = 6;

/** Hide floating labels once the camera is zoomed out past this latitude span. */
const LABEL_VISIBLE_LAT_DELTA = 0.12;

/**
 * Slightly desaturated map style so UI chrome and driver markers pop without
 * making roads or labels harder to read. Mutes natural feature colour
 * intensity and softens water/landscape fills.
 */
const DESATURATED_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ saturation: -35 }, { lightness: 5 }] },
  { elementType: "labels.icon", stylers: [{ saturation: -55 }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ saturation: -25 }, { lightness: 10 }] },
  { featureType: "landscape", stylers: [{ saturation: -40 }, { lightness: 8 }] },
  { featureType: "road", elementType: "geometry", stylers: [{ saturation: -25 }, { lightness: 6 }] },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 5-tier gradient (light yellow → orange → red → dark red → purple) keyed off
 * the normalised intensity that the server emits (0, 0.25, 0.5, 0.75, 1).
 */
const TIER_COLORS = ["#FFE082", "#FFB74D", "#FF7043", "#C0392B", "#6A1B9A"] as const;
function heatColor(intensity: number): string {
  const tier = Math.max(0, Math.min(4, Math.round(intensity * 4)));
  return TIER_COLORS[tier];
}

/** Returns heatmap circle radius in metres based on intensity tier. */
function heatRadius(intensity: number): number {
  return 350 + intensity * 600;
}

/** Returns heatmap fill opacity. */
function heatOpacity(intensity: number): number {
  return 0.25 + intensity * 0.35;
}

function formatZoneLabel(zone: DemandZone): string | null {
  if (zone.labelMode === "off") return null;
  if (zone.labelMode === "bonus") {
    if (typeof zone.bonus !== "number" || zone.bonus <= 0) return null;
    return `+$${zone.bonus.toFixed(zone.bonus % 1 === 0 ? 0 : 2)}`;
  }
  // multiplier
  return `${zone.surgeMultiplier.toFixed(zone.surgeMultiplier >= 10 ? 0 : 1)}x`;
}

/** Floating surge label rendered as a native map marker child view. */
function SurgePill({ zone }: { zone: DemandZone }) {
  const fonts = useFontFamily();
  const label = formatZoneLabel(zone);
  if (!label) return null;
  const bg = heatColor(zone.intensity);
  return (
    <View style={[styles.etaPill, { backgroundColor: bg }]}>
      <Feather name="trending-up" size={11} color="#fff" style={{ marginEnd: 3 }} />
      <Text style={[styles.etaPillText, { fontFamily: fonts.bold }]}>{label}</Text>
    </View>
  );
}

/**
 * Cross-fades a heatmap circle when its zone is added/removed/changed. Each
 * zone keyed by its lat/lng cell mounts/unmounts independently, so unmounted
 * zones get a quick fade-out via Animated opacity.
 */
function HeatCircle({ zone }: { zone: DemandZone }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 350,
      useNativeDriver: false,
    }).start();
  }, [opacity]);
  // react-native-maps Circle does not animate fillColor opacity directly, so
  // we approximate by re-rendering with an interpolated alpha hex suffix.
  const targetAlpha = heatOpacity(zone.intensity);
  const [alpha, setAlpha] = React.useState(0);
  useEffect(() => {
    const id = opacity.addListener(({ value }) => setAlpha(value * targetAlpha));
    return () => opacity.removeListener(id);
  }, [opacity, targetAlpha]);
  const hex = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return (
    <Circle
      center={{ latitude: zone.lat, longitude: zone.lng }}
      radius={heatRadius(zone.intensity)}
      strokeColor="transparent"
      strokeWidth={0}
      fillColor={`${heatColor(zone.intensity)}${hex}`}
    />
  );
}

interface AnimatedDriverMarkerProps {
  driver: NearbyDriver;
  /** Optional opacity (0..1) so the parent can fade out non-primary drivers. */
  opacity?: number;
}

/** A single driver marker that smoothly glides to new coordinates with an
 *  ease-in-out interpolation and fades in when first mounted. Heading is
 *  derived from successive positions when the server doesn't provide one.
 *
 *  Uses an Animated.Value progress (0→1) with Easing.inOut to drive
 *  setNativeProps coordinate updates so the motion is genuinely eased rather
 *  than the linear interpolation that AnimatedRegion.timing would produce. */
const AnimatedDriverMarker = React.memo(function AnimatedDriverMarker({
  driver,
  opacity = 1,
}: AnimatedDriverMarkerProps) {
  const markerRef = useRef<React.ElementRef<typeof Marker> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(opacity)).current;
  const progress = useRef(new Animated.Value(1)).current;
  const fromRef = useRef({ lat: driver.lat, lng: driver.lng });
  const toRef = useRef({ lat: driver.lat, lng: driver.lng });
  /** Always reflects the *currently displayed* interpolated coordinate so
   *  React rerenders (e.g. caused by opacity-tier changes when the rider
   *  pans/zooms) don't reapply a stale `from` position to the Marker and
   *  cause a backward snap. The animation listener writes to it on every
   *  frame and the animation-complete callback advances `fromRef` to the
   *  final target so the next animation starts from the right place. */
  const currentPosRef = useRef({ lat: driver.lat, lng: driver.lng });
  const derivedHeading = useRef<number>(driver.heading ?? 0);

  // Fade in on mount.
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Animate opacity changes when fade tier changes.
  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: opacity,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [opacity, opacityAnim]);

  // Coordinate listener — drives marker position via setNativeProps so we
  // get true ease-in-out motion between socket ticks.
  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      const lat = fromRef.current.lat + (toRef.current.lat - fromRef.current.lat) * value;
      const lng = fromRef.current.lng + (toRef.current.lng - fromRef.current.lng) * value;
      currentPosRef.current = { lat, lng };
      markerRef.current?.setNativeProps({
        coordinate: { latitude: lat, longitude: lng },
      });
    });
    return () => progress.removeListener(id);
  }, [progress]);

  useEffect(() => {
    if (toRef.current.lat === driver.lat && toRef.current.lng === driver.lng) return;

    // Derive heading from movement when not provided by the server.
    if (driver.heading == null) {
      const dLat = driver.lat - toRef.current.lat;
      const dLng = driver.lng - toRef.current.lng;
      const meaningful = Math.abs(dLat) + Math.abs(dLng) > 1e-6;
      if (meaningful) {
        const h = (Math.atan2(dLng, dLat) * 180) / Math.PI;
        derivedHeading.current = (h + 360) % 360;
      }
    } else {
      derivedHeading.current = driver.heading;
    }

    // Start the next animation from wherever the marker is *currently
    // displayed* (which may be mid-interpolation if a fresh location update
    // arrived before the previous one finished), not from the previous
    // target. This avoids visible snaps when updates land back-to-back.
    fromRef.current = { ...currentPosRef.current };
    toRef.current = { lat: driver.lat, lng: driver.lng };
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: ANIMATE_DURATION_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: false,
    }).start(({ finished }) => {
      // On natural completion, advance the source-of-truth refs to the
      // final coordinate so any future React rerender (e.g. from an
      // opacity-tier change as the rider pans/zooms) renders the latest
      // position rather than reapplying a stale `from` coordinate.
      if (finished) {
        currentPosRef.current = { ...toRef.current };
        fromRef.current = { ...toRef.current };
      }
    });
  }, [driver.lat, driver.lng, driver.heading, progress]);

  const anchor = driver.vehicleCategory === "moto"
    ? { x: 0.5, y: 1 }
    : { x: 0.5, y: 0.5 };

  const heading = driver.heading ?? derivedHeading.current;

  return (
    <Marker
      ref={markerRef}
      coordinate={{ latitude: currentPosRef.current.lat, longitude: currentPosRef.current.lng }}
      anchor={anchor}
      rotation={heading}
      flat
      tracksViewChanges={false}
    >
      <Animated.View style={{ opacity: Animated.multiply(fadeAnim, opacityAnim) }}>
        <DriverPin vehicleCategory={driver.vehicleCategory} showPulse={opacity >= 0.95} />
      </Animated.View>
    </Marker>
  );
}, (prev, next) => {
  return (
    prev.driver.id === next.driver.id &&
    prev.driver.lat === next.driver.lat &&
    prev.driver.lng === next.driver.lng &&
    prev.driver.heading === next.driver.heading &&
    prev.driver.vehicleCategory === next.driver.vehicleCategory &&
    prev.opacity === next.opacity
  );
});

interface DriverCluster {
  id: string;
  lat: number;
  lng: number;
  drivers: NearbyDriver[];
}

/** A bubble that represents multiple drivers grouped together when the
 *  camera is zoomed out. Tapping it zooms the map in toward the cluster's
 *  centre so individual markers can re-emerge. */
const ClusterMarker = React.memo(function ClusterMarker({
  cluster,
  onPress,
}: {
  cluster: DriverCluster;
  onPress: (c: DriverCluster) => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);
  const count = cluster.drivers.length;
  const size = count >= 25 ? 52 : count >= 10 ? 46 : 40;
  return (
    <Marker
      coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      onPress={() => onPress(cluster)}
    >
      <Animated.View
        style={[
          styles.clusterBubble,
          { width: size, height: size, borderRadius: size / 2, opacity: fadeAnim },
        ]}
      >
        <Text style={styles.clusterText}>{count}</Text>
      </Animated.View>
    </Marker>
  );
});

export const AppMap = forwardRef<AppMapHandle, Props>(function AppMap(
  {
    pickup,
    dropoff,
    routePolyline,
    fit = true,
    centerPin = false,
    onCenterChange,
    drivers,
    heatmapZones,
    etaLabelsEnabled = true,
    alwaysShow = false,
    initialCenter,
    seedRegion,
    onUserPan,
    onRegionChangeComplete: onRegionChangeCompleteProp,
    onRegionChange,
    selfDriver,
  },
  outerRef,
) {
  const c = useColors();
  const cfg = useConfig();
  const ref = useRef<MapView | null>(null);
  const [mapView, setMapView] = React.useState<{
    lat: number;
    lng: number;
    latDelta: number;
    lngDelta: number;
  } | null>(() => {
    if (seedRegion) {
      return {
        lat: seedRegion.latitude,
        lng: seedRegion.longitude,
        latDelta: seedRegion.latitudeDelta,
        lngDelta: seedRegion.longitudeDelta,
      };
    }
    if (pickup) return { lat: pickup.lat, lng: pickup.lng, latDelta: 0.03, lngDelta: 0.03 };
    return null;
  });
  const mapCenter = mapView ? { lat: mapView.lat, lng: mapView.lng } : null;

  useImperativeHandle(outerRef, () => ({
    recenter(lat: number, lng: number, delta = 0.012, lngDelta?: number) {
      ref.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: lngDelta ?? delta },
        350,
      );
    },
    fitPoints(pts: Array<{ lat: number; lng: number }>) {
      if (!ref.current || pts.length === 0) return;
      const coords = pts.map((p) => ({ latitude: p.lat, longitude: p.lng }));
      try {
        ref.current.fitToCoordinates(coords, {
          edgePadding: { top: 120, bottom: 320, left: 60, right: 60 },
          animated: true,
        });
      } catch {
        /* ignore */
      }
    },
  }));

  // Google Maps is the only supported tile provider on mobile (MapTiler was
  // removed from the stack). If no platform key is configured the map
  // renders with the system default basemap.
  const googleMapsKey = getPlatformMapsKey(cfg);
  const mapsUsable = !!googleMapsKey;

  const polylineCoords = useMemo(
    () => (routePolyline ? decodePolyline(routePolyline) : []),
    [routePolyline],
  );

  const initialRegion = useMemo<Region>(() => {
    // Saved viewport takes highest priority so the driver sees exactly what they left.
    if (seedRegion) return seedRegion;
    if (pickup) {
      return {
        latitude: pickup.lat,
        longitude: pickup.lng,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      };
    }
    if (dropoff) {
      return {
        latitude: dropoff.lat,
        longitude: dropoff.lng,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      };
    }
    if (initialCenter) {
      return {
        latitude: initialCenter.lat,
        longitude: initialCenter.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    return FALLBACK_REGION;
  }, [seedRegion, pickup, dropoff, initialCenter]);

  /** Pick the closest N drivers to the current map centre and tag the top
   *  ones at full opacity; the rest fade slightly so attention falls on the
   *  most relevant markers without losing context.
   *
   *  When the camera is zoomed out past `CLUSTER_LAT_DELTA_THRESHOLD`,
   *  drivers within the same grid cell collapse into a single cluster
   *  bubble showing the count. Cells with a single driver still render as
   *  a normal animated marker so individual motion is preserved when not
   *  clustered. */
  const { unclusteredDrivers, clusters } = useMemo<{
    unclusteredDrivers: Array<{ driver: NearbyDriver; opacity: number }>;
    clusters: DriverCluster[];
  }>(() => {
    if (!drivers || drivers.length === 0) {
      return { unclusteredDrivers: [], clusters: [] };
    }
    const center = mapCenter ?? pickup ?? null;
    const ranked = drivers
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
      .map((driver) => {
        const distanceKm = center
          ? haversineKm(center.lat, center.lng, driver.lat, driver.lng)
          : 0;
        return { driver, distanceKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_VISIBLE_DRIVERS);

    const latDelta = mapView?.latDelta ?? 0;
    const shouldCluster = latDelta > CLUSTER_LAT_DELTA_THRESHOLD;

    if (!shouldCluster) {
      return {
        unclusteredDrivers: ranked.map(({ driver }, index) => ({
          driver,
          opacity: index < PRIMARY_DRIVER_COUNT ? 1 : FADED_DRIVER_OPACITY,
        })),
        clusters: [],
      };
    }

    // Grid-bucket clustering. Cell size scales with zoom so a single screen
    // contains roughly CLUSTER_GRID_DIVISIONS cells per axis regardless of
    // zoom level.
    const cellSize = Math.max(latDelta / CLUSTER_GRID_DIVISIONS, 0.001);
    const buckets = new Map<string, NearbyDriver[]>();
    for (const { driver } of ranked) {
      const cellLat = Math.floor(driver.lat / cellSize);
      const cellLng = Math.floor(driver.lng / cellSize);
      const key = `${cellLat}:${cellLng}`;
      const existing = buckets.get(key);
      if (existing) existing.push(driver);
      else buckets.set(key, [driver]);
    }

    const singletons: NearbyDriver[] = [];
    const groups: DriverCluster[] = [];
    for (const [key, list] of buckets) {
      if (list.length < 2) {
        singletons.push(list[0]);
        continue;
      }
      const sumLat = list.reduce((s, d) => s + d.lat, 0);
      const sumLng = list.reduce((s, d) => s + d.lng, 0);
      groups.push({
        id: `cluster-${key}`,
        lat: sumLat / list.length,
        lng: sumLng / list.length,
        drivers: list,
      });
    }

    return {
      unclusteredDrivers: singletons.map((driver, index) => ({
        driver,
        opacity: index < PRIMARY_DRIVER_COUNT ? 1 : FADED_DRIVER_OPACITY,
      })),
      clusters: groups,
    };
  }, [drivers, mapCenter, pickup, mapView?.latDelta]);

  const handleClusterPress = React.useCallback((cluster: DriverCluster) => {
    const currentDelta = mapView?.latDelta ?? 0.05;
    const nextDelta = Math.max(currentDelta / 2.2, 0.008);
    ref.current?.animateToRegion(
      {
        latitude: cluster.lat,
        longitude: cluster.lng,
        latitudeDelta: nextDelta,
        longitudeDelta: nextDelta,
      },
      400,
    );
  }, [mapView?.latDelta]);

  useEffect(() => {
    if (centerPin || !fit || !ref.current) return;
    const pts: { latitude: number; longitude: number }[] = [];
    if (pickup) pts.push({ latitude: pickup.lat, longitude: pickup.lng });
    if (dropoff) pts.push({ latitude: dropoff.lat, longitude: dropoff.lng });
    pts.push(...polylineCoords);
    if (pts.length >= 2) {
      try {
        ref.current.fitToCoordinates(pts, {
          edgePadding: { top: 120, bottom: 320, left: 60, right: 60 },
          animated: true,
        });
      } catch {
        /* ignore */
      }
    }
  }, [centerPin, pickup, dropoff, polylineCoords, fit]);

  const [labelsVisible, setLabelsVisible] = React.useState(
    (seedRegion?.latitudeDelta ?? initialRegion.latitudeDelta) <= LABEL_VISIBLE_LAT_DELTA,
  );

  if (!alwaysShow && !centerPin && !pickup && !dropoff) {
    return <MapBackdrop pickup={false} dropoff={false} />;
  }

  if (!mapsUsable) {
    return <MapBackdrop pickup={!!pickup} dropoff={!!dropoff} />;
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        loadingEnabled
        mapType="standard"
        customMapStyle={DESATURATED_MAP_STYLE}
        onPanDrag={onUserPan}
        onRegionChangeComplete={(region) => {
          if (centerPin && onCenterChange) {
            onCenterChange(region.latitude, region.longitude);
          }
          onRegionChangeCompleteProp?.(region);
          onRegionChange?.(region.latitude, region.longitude);
          setMapView({
            lat: region.latitude,
            lng: region.longitude,
            latDelta: region.latitudeDelta,
            lngDelta: region.longitudeDelta,
          });
          // Hide floating multiplier/bonus labels when zoomed out so we don't
          // clutter the map at city scale.
          setLabelsVisible(region.latitudeDelta <= LABEL_VISIBLE_LAT_DELTA);
        }}
      >
        {/* MapTiler UrlTile fallback removed — Google Maps only on mobile. */}
        {heatmapZones?.map((zone) => (
          <HeatCircle
            key={`heat-${zone.lat.toFixed(4)},${zone.lng.toFixed(4)}`}
            zone={zone}
          />
        ))}

        {etaLabelsEnabled && labelsVisible &&
          heatmapZones?.map((zone) =>
            zone.labelMode === "off" ? null : (
              <Marker
                key={`pill-${zone.lat.toFixed(4)},${zone.lng.toFixed(4)}`}
                coordinate={{ latitude: zone.lat, longitude: zone.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <SurgePill zone={zone} />
              </Marker>
            ),
          )}

        {polylineCoords.length > 0 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor={c.primary}
            strokeWidth={5}
          />
        )}
        {!centerPin && pickup && (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.pinOuter, { backgroundColor: "#fff" }]}>
              <View style={[styles.pinInner, { backgroundColor: c.accent }]} />
            </View>
          </Marker>
        )}
        {!centerPin && dropoff && (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.pinOuter, { backgroundColor: "#fff" }]}>
              <View
                style={[
                  styles.pinInner,
                  { backgroundColor: c.primary, borderRadius: 4 },
                ]}
              />
            </View>
          </Marker>
        )}
        {unclusteredDrivers.map(({ driver, opacity }) => (
          <AnimatedDriverMarker key={driver.id} driver={driver} opacity={opacity} />
        ))}
        {clusters.map((cluster) => (
          <ClusterMarker key={cluster.id} cluster={cluster} onPress={handleClusterPress} />
        ))}
        {selfDriver && (
          <AnimatedDriverMarker
            driver={{
              id: "__self__",
              lat: selfDriver.lat,
              lng: selfDriver.lng,
              heading: selfDriver.heading ?? 0,
              vehicleCategory: selfDriver.vehicleCategory ?? "car",
            }}
          />
        )}
      </MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject },
  pinOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pinInner: { width: 16, height: 16, borderRadius: 8 },
  etaPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  etaPillText: {
    color: "#fff",
    fontSize: 11,
    letterSpacing: 0.3,
  },
  clusterBubble: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3819A6",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.92)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  clusterText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.2,
  },
});
