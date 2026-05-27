import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import * as Location from "expo-location";
import type { Region } from "react-native-maps";
import { AppMap, type AppMapHandle, type DemandZone, type MapPoint } from "@/components/AppMap";
import { Button } from "@/components/Button";
import { useAuth, useDriver } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig, type PublicConfig } from "@/lib/config";
import { formatUsdAmount } from "@/lib/formatCurrency";
import { api, ApiError } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDriverDestinationModeQueryKey,
  useGetDriverDestinationMode,
} from "@workspace/api-client-react";
import { getSocket } from "@/lib/socket";
import { getJSON, setJSON } from "@/lib/storage";
import type { DriverIncomingRequest, TripStop } from "@/lib/types";

/**
 * Module-level store for the driver's map-follow preference and last known
 * location. Lives outside the component so both values survive brief remounts
 * (e.g. when the driver opens their profile then goes back). `following` resets
 * to `true` only when the driver explicitly taps "locate me".
 */
const _driverMapStore: {
  following: boolean;
  location: MapPoint | null;
  mapCenter: MapPoint | null;
  delta: number;
} = {
  following: true,
  location: null,
  mapCenter: null,
  delta: 0.04,
};

export default function DriverHome() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cfg = useConfig();
  const mapRef = useRef<AppMapHandle>(null);
  const { user } = useAuth();
  const {
    earnings,
    driverOnline,
    driverIncoming,
    driverTrip,
    setDriverOnline,
    declineDriverRequest,
    placeDriverBid,
  } = useDriver();

  const [demandZones, setDemandZones] = useState<DemandZone[]>([]);
  const [driverLocation, setDriverLocation] = useState<MapPoint | null>(() => _driverMapStore.location);
  const [following, setFollowing] = useState(() => _driverMapStore.following);
  const followingRef = useRef(_driverMapStore.following);
  // Capture the initial map centre once at mount so it doesn't drift across re-renders.
  // The user's last camera position (mapCenter) takes priority; fall back to GPS location.
  const initialMapCenter = useRef(_driverMapStore.mapCenter ?? _driverMapStore.location);

  // Reset the persistent store when a different driver account becomes active
  // so a new session always starts in follow-me mode with no stale position.
  const sessionKeyRef = useRef(user?.phone ?? null);
  useEffect(() => {
    const current = user?.phone ?? null;
    if (current !== sessionKeyRef.current) {
      sessionKeyRef.current = current;
      _driverMapStore.following = true;
      _driverMapStore.location = null;
      _driverMapStore.mapCenter = null;
      _driverMapStore.delta = 0.04;
      followingRef.current = true;
      setFollowing(true);
      setDriverLocation(null);
    }
  }, [user?.phone]);


  /** Full saved region loaded from AsyncStorage before the map first renders. */
  const [seedRegion, setSeedRegion] = useState<Region | null>(null);
  /** Becomes true once the AsyncStorage read completes, allowing the map to render. */
  const [mapSeedReady, setMapSeedReady] = useState(false);
  const lastRegionRef = useRef<Region | null>(null);

  useEffect(() => {
    let active = true;
    getJSON<{ lat: number; lng: number; latDelta: number; lngDelta: number }>("driver_map_region")
      .then((saved) => {
        if (!active) return;
        if (saved) {
          const restored: Region = {
            latitude: saved.lat,
            longitude: saved.lng,
            latitudeDelta: saved.latDelta,
            longitudeDelta: saved.lngDelta,
          };
          setSeedRegion(restored);
          // Pre-seed the ref so a very-short session still re-saves a valid region.
          lastRegionRef.current = restored;
        } else {
          // No persisted region yet — fall back to the in-session store so that
          // a brief remount (e.g. profile → back) still restores the exact zoom.
          const storeCenter = _driverMapStore.mapCenter ?? _driverMapStore.location;
          if (storeCenter) {
            const fallback: Region = {
              latitude: storeCenter.lat,
              longitude: storeCenter.lng,
              latitudeDelta: _driverMapStore.delta,
              longitudeDelta: _driverMapStore.delta,
            };
            setSeedRegion(fallback);
            lastRegionRef.current = fallback;
          }
        }
        setMapSeedReady(true);
      })
      .catch(() => {
        if (active) setMapSeedReady(true);
      });
    return () => {
      active = false;
      if (lastRegionRef.current) {
        setJSON("driver_map_region", {
          lat: lastRegionRef.current.latitude,
          lng: lastRegionRef.current.longitude,
          latDelta: lastRegionRef.current.latitudeDelta,
          lngDelta: lastRegionRef.current.longitudeDelta,
        });
      }
    };
  }, []);

  useEffect(() => {
    if (driverTrip) router.replace("/(driver)/trip");
  }, [driverTrip, router]);

  useEffect(() => {
    let locationSub: Location.LocationSubscription | null = null;
    let cancelled = false;

    async function initLocation() {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (perm.status !== "granted") return;

        // Seed the map immediately from the OS cache so the driver doesn't see
        // the hardcoded fallback region while we wait for a fresh GPS fix.
        const cached = await Location.getLastKnownPositionAsync({});
        if (!cancelled && cached) {
          const seed: MapPoint = { lat: cached.coords.latitude, lng: cached.coords.longitude };
          _driverMapStore.location = seed;
          setDriverLocation(seed);
          if (followingRef.current) {
            mapRef.current?.recenter(seed.lat, seed.lng, 0.04);
          }
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const loc: MapPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        _driverMapStore.location = loc;
        setDriverLocation(loc);
        if (followingRef.current) {
          mapRef.current?.recenter(loc.lat, loc.lng, 0.04);
        }

        locationSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 8000,
            distanceInterval: 30,
          },
          (update) => {
            if (cancelled) return;
            const next: MapPoint = {
              lat: update.coords.latitude,
              lng: update.coords.longitude,
            };
            _driverMapStore.location = next;
            setDriverLocation(next);
            if (followingRef.current) {
              mapRef.current?.recenter(next.lat, next.lng, 0.04);
            }
          },
        );

      } catch {
        // expo-location may throw on web or when permissions are missing — ignore
      }
    }

    initLocation();
    return () => {
      cancelled = true;
      locationSub?.remove();
    };
  }, []);

  function handleUserPan() {
    _driverMapStore.following = false;
    followingRef.current = false;
    setFollowing(false);
  }

  function handleRegionChange(lat: number, lng: number) {
    // Only record the camera centre when the driver has manually panned away
    // from their GPS position; programmatic recenters (following=true) should
    // not overwrite the store with an intermediate animated frame.
    if (!followingRef.current) {
      _driverMapStore.mapCenter = { lat, lng };
    }
  }

  function handleLocateMe() {
    _driverMapStore.following = true;
    _driverMapStore.mapCenter = null;
    followingRef.current = true;
    setFollowing(true);
    if (driverLocation) {
      mapRef.current?.recenter(driverLocation.lat, driverLocation.lng, 0.04);
    }
  }

  // ── Real-time surge heatmap ─────────────────────────────────────────────
  // Source of truth is Socket.IO room `drivers:heatmap`: the server pushes a
  // full snapshot on driver-online and incremental diffs on each aggregator
  // tick (~15s by default). The polling interval below is a fallback only —
  // it kicks in if the socket isn't connected yet, and otherwise just keeps
  // the snapshot fresh after a missed event. We deliberately keep the last
  // good data on any failure (no clearing) so a transient outage doesn't
  // black out the heatmap.
  useEffect(() => {
    let cancelled = false;
    const refreshSec = Math.max(10, Math.min(60, cfg.heatmapRefreshSeconds || 15));
    const cellKey = (z: { lat: number; lng: number }) => `${z.lat.toFixed(4)},${z.lng.toFixed(4)}`;

    function applySnapshot(zones: DemandZone[]) {
      if (cancelled) return;
      setDemandZones(zones);
    }
    function applyDiff(diff: {
      added?: DemandZone[];
      updated?: DemandZone[];
      removed?: string[];
    }) {
      if (cancelled) return;
      setDemandZones((prev) => {
        const map = new Map(prev.map((z) => [cellKey(z), z]));
        for (const z of diff.added ?? []) map.set(cellKey(z), z);
        for (const z of diff.updated ?? []) map.set(cellKey(z), z);
        for (const k of diff.removed ?? []) map.delete(k);
        return Array.from(map.values());
      });
    }

    async function fetchZones() {
      try {
        const res = await api<{ zones: DemandZone[]; generatedAt?: string }>("/demand-zones");
        applySnapshot(res.zones ?? []);
      } catch {
        // Keep the previous snapshot — heatmap is informational, never fail loud.
      }
    }

    const sock = getSocket();
    const onSnapshot = (payload: { zones: DemandZone[] }) => applySnapshot(payload.zones ?? []);
    const onDiff = (payload: {
      added?: DemandZone[];
      updated?: DemandZone[];
      removed?: string[];
    }) => applyDiff(payload);
    sock?.on("heatmap:snapshot", onSnapshot);
    sock?.on("heatmap:diff", onDiff);

    fetchZones();
    const interval = setInterval(fetchZones, refreshSec * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      sock?.off("heatmap:snapshot", onSnapshot);
      sock?.off("heatmap:diff", onDiff);
    };
  }, [cfg.heatmapRefreshSeconds]);

  const todayTotal = earnings
    .filter((e) => Date.now() - e.date < 24 * 60 * 60 * 1000)
    .reduce((s, e) => s + e.amount, 0);

  const { t } = useTranslation();
  const fonts = useFontFamily();

  return (
    <View style={styles.root}>
      {mapSeedReady && (
        <AppMap
          ref={mapRef}
          alwaysShow
          fit={false}
          seedRegion={seedRegion ?? undefined}
          heatmapZones={demandZones}
          etaLabelsEnabled={cfg.driverEtaLabelsEnabled}
          onUserPan={handleUserPan}
          onRegionChangeComplete={(region) => {
            lastRegionRef.current = region;
            // Persist the current zoom level to the module store so it survives
            // brief remounts (e.g. driver opens profile then returns).
            if (!followingRef.current) {
              _driverMapStore.delta = region.latitudeDelta;
              _driverMapStore.mapCenter = { lat: region.latitude, lng: region.longitude };
            }
          }}
          onRegionChange={handleRegionChange}
        />
      )}

      {!following && driverLocation && (
        <Pressable
          onPress={handleLocateMe}
          style={[styles.locateBtn, { backgroundColor: c.surface }]}
        >
          <Feather name="crosshair" size={20} color={c.primary} />
        </Pressable>
      )}

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.push("/profile")}
          style={[styles.iconBtn, { backgroundColor: c.surface }]}
        >
          <Feather name="user" size={20} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greeting, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{t("driverHome.driver")}</Text>
          <Text style={[styles.greetingName, { color: c.foreground, fontFamily: fonts.bold }]}>
            {user?.firstName ?? "—"}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/(driver)/wallet")}
          style={[styles.iconBtn, { backgroundColor: c.surface }]}
        >
          <Feather name="credit-card" size={20} color={c.foreground} />
        </Pressable>
        <Pressable
          onPress={() => router.push("/(driver)/earnings")}
          style={[styles.iconBtn, { backgroundColor: c.surface }]}
        >
          <Feather name="bar-chart-2" size={20} color={c.foreground} />
        </Pressable>
        <Pressable
          onPress={() => router.push("/(driver)/my-bids")}
          style={[styles.iconBtn, { backgroundColor: c.surface }]}
        >
          <Feather name="tag" size={20} color={c.foreground} />
        </Pressable>
        <DestinationModeButton />
      </View>

      <FlatList
        // Bidding rides (those carrying initialFare) get their own dedicated
        // modal pushed by AppContext on bidding:request — filter them out of
        // the inline cards so the driver doesn't see the same request twice.
        data={driverIncoming.filter((r) => r.initialFare == null)}
        keyExtractor={(r) => r.id}
        style={styles.listContainer}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
          gap: 12,
        }}
        ListHeaderComponent={
          <>
          <View style={[styles.statusCard, { backgroundColor: driverOnline ? c.primary : c.surface }]}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.statusLabel,
                  { color: driverOnline ? "rgba(255,255,255,0.75)" : c.mutedForeground, fontFamily: fonts.bold },
                ]}
              >
                {driverOnline ? t("driverHome.online") : t("driverHome.offline")}
              </Text>
              <Text style={[styles.statusValue, { color: driverOnline ? "#fff" : c.foreground, fontFamily: fonts.bold }]}>
                {driverOnline ? t("driverHome.receiving") : t("driverHome.tapToGoOnline")}
              </Text>
              <Text
                style={[
                  styles.statusSub,
                  { color: driverOnline ? "rgba(255,255,255,0.85)" : c.mutedForeground, fontFamily: fonts.medium },
                ]}
              >
                {t("driverHome.todayEarnings", { amount: formatUsdAmount(todayTotal, cfg), count: earnings.length })}
              </Text>
            </View>
            <Switch
              value={driverOnline}
              onValueChange={setDriverOnline}
              trackColor={{ true: c.accent, false: c.border }}
              thumbColor="#fff"
            />
          </View>
          <QuestBanner cfg={cfg} />
          </>
        }
        ListHeaderComponentStyle={{ paddingTop: 12, paddingHorizontal: 0, marginBottom: 4 }}
        ListEmptyComponent={
          driverOnline ? (
            <View style={[styles.emptyBox, { backgroundColor: c.surface }]}>
              <WaitingRadarIcon />
              <Text style={[styles.emptyTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
                {t("driverHome.waitingForRequest")}
              </Text>
              <Text style={[styles.emptySub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("driverHome.waitingSubtitle")}
              </Text>
            </View>
          ) : (
            <View style={[styles.emptyBox, { backgroundColor: c.surface }]}>
              <View style={[styles.emptyIcon, { backgroundColor: c.primarySoft, marginBottom: 14 }]}>
                <Feather name="moon" size={22} color={c.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: c.foreground, fontFamily: fonts.bold }]}>{t("driverHome.youreOffline")}</Text>
              <Text style={[styles.emptySub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("driverHome.offlineSubtitle")}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <RequestCard
            request={item}
            cfg={cfg}
            onSubmit={(amount) => placeDriverBid(item.id, amount)}
            onDecline={() => declineDriverRequest(item.id)}
          />
        )}
      />
    </View>
  );
}

interface QuestBannerItem {
  id: string;
  title: string;
  bonusAmount: number;
  requiredTrips: number;
  completedTrips: number;
  remaining: number;
  rewardCredited: boolean;
}

// Header pill — opens the destination picker. Shows a green dot + remaining
// daily filter count so the driver can see at a glance whether the request
// stream is being filtered and how many activations they have left.
function DestinationModeButton() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const qc = useQueryClient();
  const stateQ = useGetDriverDestinationMode();

  useEffect(() => {
    const sock = getSocket();
    const onDeact = () =>
      qc.invalidateQueries({ queryKey: getGetDriverDestinationModeQueryKey() });
    sock?.on("destinationMode:deactivated", onDeact);
    return () => {
      sock?.off("destinationMode:deactivated", onDeact);
    };
  }, [qc]);

  const enabled = stateQ.data?.config.enabled ?? false;
  const active = !!stateQ.data?.active;
  const remaining = stateQ.data?.filtersRemainingToday ?? 0;
  if (!enabled) return null;
  return (
    <Pressable
      onPress={() => router.push("/(driver)/destination" as never)}
      style={[styles.iconBtn, { backgroundColor: active ? c.primarySoft : c.surface }]}
    >
      <Feather name="navigation" size={20} color={active ? c.primary : c.foreground} />
      {active ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: "#22c55e",
          }}
        />
      ) : (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            paddingHorizontal: 4,
            backgroundColor: remaining > 0 ? c.primary : c.mutedForeground,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 10, fontFamily: fonts.bold }}>{remaining}</Text>
        </View>
      )}
    </Pressable>
  );
}

function QuestBanner({ cfg }: { cfg: PublicConfig }) {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const [items, setItems] = useState<QuestBannerItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ promotions: QuestBannerItem[] }>("/driver/promotions")
      .then((res) => {
        if (cancelled) return;
        // Show only in-progress (not yet credited) quests, top 1.
        const active = res.promotions.filter((p) => !p.rewardCredited);
        setItems(active.slice(0, 1));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;
  const top = items[0];
  if (!top) return null;
  const pct = Math.min(
    1,
    top.requiredTrips > 0 ? top.completedTrips / top.requiredTrips : 0,
  );

  return (
    <Pressable
      onPress={() => router.push("/(driver)/quests")}
      style={[
        questStyles.banner,
        { backgroundColor: c.surface, borderColor: c.primary },
      ]}
    >
      <View style={[questStyles.bonus, { backgroundColor: c.primary }]}>
        <Text style={[questStyles.bonusText, { fontFamily: fonts.bold }]}>
          {formatUsdAmount(top.bonusAmount, cfg)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={[questStyles.title, { color: c.foreground, fontFamily: fonts.bold }]}
        >
          {top.title}
        </Text>
        <View style={[questStyles.bar, { backgroundColor: c.border }]}>
          <View
            style={[
              questStyles.barFill,
              { backgroundColor: c.primary, width: `${pct * 100}%` },
            ]}
          />
        </View>
        <Text
          style={[
            questStyles.sub,
            { color: c.mutedForeground, fontFamily: fonts.medium },
          ]}
        >
          {top.completedTrips}/{top.requiredTrips} trips · {top.remaining} to go
        </Text>
      </View>
      <Feather name={fonts.isRTL ? "chevron-left" : "chevron-right"} size={20} color={c.mutedForeground} />
    </Pressable>
  );
}

const questStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  bonus: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minWidth: 64,
    alignItems: "center",
  },
  bonusText: { color: "#fff", fontSize: 13 },
  title: { fontSize: 14, marginBottom: 6 },
  bar: { height: 6, borderRadius: 999, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  sub: { fontSize: 11, marginTop: 4 },
});

const RING_DURATION = 2000;
const RING_STAGGER = 667;

function WaitingRadarIcon() {
  const c = useColors();
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const makeRing = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: RING_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );

    Animated.parallel([
      makeRing(ring1, 0),
      makeRing(ring2, RING_STAGGER),
      makeRing(ring3, RING_STAGGER * 2),
      Animated.loop(
        Animated.sequence([
          Animated.timing(iconScale, {
            toValue: 0.88,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(iconScale, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      ),
    ]).start();
  }, []);

  const ringStyle = (val: Animated.Value) => ({
    position: "absolute" as const,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: c.primary,
    transform: [
      {
        scale: val.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 2.8],
        }),
      },
    ],
    opacity: val.interpolate({
      inputRange: [0, 0.15, 1],
      outputRange: [0, 0.55, 0],
    }),
  });

  return (
    <View style={styles.radarContainer}>
      <Animated.View style={ringStyle(ring1)} />
      <Animated.View style={ringStyle(ring2)} />
      <Animated.View style={ringStyle(ring3)} />
      <Animated.View
        style={[
          styles.emptyIcon,
          { backgroundColor: c.primarySoft, transform: [{ scale: iconScale }] },
        ]}
      >
        <Feather name="radio" size={22} color={c.primary} />
      </Animated.View>
    </View>
  );
}

function RequestCard({
  request,
  cfg,
  onSubmit,
  onDecline,
}: {
  request: DriverIncomingRequest;
  cfg: PublicConfig;
  onSubmit: (amount: number) => Promise<void>;
  onDecline: () => void;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const [bid, setBid] = useState(request.suggestedFare.toFixed(2));
  const [bidError, setBidError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bidInputRef = useRef<TextInput>(null);

  const badges: { key: string; emoji: string; label: string; tone: string }[] = [];
  if (request.isShared) {
    badges.push({
      key: "pool",
      emoji: "👥",
      label: `Pool · ${Math.max(1, request.seatsRequested ?? 1)}`,
      tone: c.primarySoft,
    });
  }
  if (request.wheelchairRequested) {
    badges.push({ key: "wc", emoji: "♿", label: "Wheelchair", tone: c.primarySoft });
  }
  if (request.petRequested) {
    badges.push({ key: "pet", emoji: "🐾", label: "Pet", tone: c.primarySoft });
  }
  if (request.assistRequested) {
    badges.push({ key: "assist", emoji: "✋", label: "Assist", tone: c.primarySoft });
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.distancePill, { backgroundColor: c.primarySoft }]}>
          <Feather name="map" size={12} color={c.primary} />
          <Text style={[styles.distanceText, { color: c.primary, fontFamily: fonts.semiBold }]}>
            {request.distanceKm} km · {request.durationMin} min
          </Text>
        </View>
        {request.riderCustomerRating != null ? (
          <View style={styles.ratingRow}>
            <Feather name="star" size={12} color={c.accent} />
            <Text style={[styles.ratingText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {request.riderCustomerRating.toFixed(1)}
              {request.riderCustomerRatingCount
                ? ` (${request.riderCustomerRatingCount})`
                : ""}
            </Text>
          </View>
        ) : null}
      </View>

      {(request.vehicleTypeName || badges.length > 0) && (
        <View style={styles.badgeRow}>
          {request.vehicleTypeName ? (
            <View style={[styles.typeBadge, { backgroundColor: c.background, borderColor: c.border }]}>
              <Text style={[styles.typeBadgeText, { color: c.foreground, fontFamily: fonts.bold }]}>
                {request.vehicleTypeName}
              </Text>
            </View>
          ) : null}
          {badges.map((b) => (
            <View key={b.key} style={[styles.capBadge, { backgroundColor: b.tone }]}>
              <Text style={styles.capBadgeEmoji}>{b.emoji}</Text>
              <Text style={[styles.capBadgeText, { color: c.primary, fontFamily: fonts.bold }]}>{b.label}</Text>
            </View>
          ))}
        </View>
      )}

      {request.stops && request.stops.length > 2 ? (
        <SharedStopPreview stops={request.stops} c={c} />
      ) : (
        <View style={styles.routeBlock}>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: c.accent }]} />
            <Text style={[styles.routeAddress, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
              {request.pickup.address}
            </Text>
          </View>
          <View style={[styles.routeConnector, { backgroundColor: c.border }]} />
          <View style={styles.routeRow}>
            <View style={[styles.dotSquare, { backgroundColor: c.primary }]} />
            <Text style={[styles.routeAddress, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
              {request.dropoff.address}
            </Text>
          </View>
        </View>
      )}

      {request.fareModel === "fixed" && (
        <View style={[styles.fixedFareBadge, { backgroundColor: c.primarySoft }]}>
          <Feather name="lock" size={13} color={c.primary} />
          <Text style={[styles.fixedFareText, { color: c.primary, fontFamily: fonts.semiBold }]}>
            {t("driverHome.fixedPrice", { amount: formatUsdAmount(request.suggestedFare, cfg) })}
          </Text>
        </View>
      )}
      <View style={styles.bidRow}>
        <View style={[styles.bidInputWrap, { backgroundColor: c.background, borderColor: c.border, opacity: request.fareModel === "fixed" ? 0.55 : 1 }]}>
          <Text style={[styles.bidCurrency, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{cfg.displaySymbol}</Text>
          <TextInput
            ref={bidInputRef}
            value={bid}
            onChangeText={(v) => { setBid(v); setBidError(null); }}
            keyboardType="decimal-pad"
            editable={request.fareModel !== "fixed"}
            style={[styles.bidInput, { color: c.foreground, fontFamily: fonts.bold }]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t("driverHome.sendBid")}
            disabled={submitting}
            onPress={async () => {
              const amount = parseFloat(bid);
              if (!Number.isFinite(amount) || amount <= 0) return;
              Keyboard.dismiss();
              setBidError(null);
              setSubmitting(true);
              try {
                await onSubmit(amount);
              } catch (err) {
                const data = err instanceof ApiError
                  ? (err.data as { bounds?: { min: number; max: number } } | null)
                  : null;
                const bounds = data?.bounds;
                if (err instanceof ApiError && err.message === "must_match_fixed" && bounds) {
                  setBidError(t("driverHome.bidMustMatchFixed", { amount: formatUsdAmount(bounds.min, cfg) }));
                } else if (err instanceof ApiError && err.message === "below_minimum" && bounds) {
                  setBidError(t("driverHome.bidBelowMinimum", { amount: formatUsdAmount(bounds.min, cfg) }));
                } else if (err instanceof ApiError && err.message === "above_maximum" && bounds) {
                  setBidError(t("driverHome.bidAboveMaximum", { amount: formatUsdAmount(bounds.max, cfg) }));
                } else {
                  setBidError(t("driverHome.bidFailed"));
                }
                bidInputRef.current?.focus();
              } finally {
                setSubmitting(false);
              }
            }}
            style={{ height: 52 }}
          />
        </View>
      </View>
      {bidError ? (
        <Text style={[styles.bidErrorText, { color: c.destructive, fontFamily: fonts.medium }]}>
          {bidError}
        </Text>
      ) : null}

      <Pressable onPress={() => { Keyboard.dismiss(); onDecline(); }} style={styles.declineBtn}>
        <Text style={[styles.declineText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{t("driverHome.skip")}</Text>
      </Pressable>
    </View>
  );
}

function SharedStopPreview({
  stops,
  c,
}: {
  stops: TripStop[];
  c: ReturnType<typeof useColors>;
}) {
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const pickups = stops.filter((s) => s.type === "pickup");
  const dropoffs = stops.filter((s) => s.type === "dropoff");
  return (
    <View style={styles.routeBlock}>
      {pickups.map((stop, idx) => (
        <React.Fragment key={`pu-${stop.rideId}`}>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: c.accent }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.stopLabel, { color: c.mutedForeground, fontFamily: fonts.bold }]}>
                {t("driverHome.pickup", { name: stop.riderName })}
              </Text>

              <Text style={[styles.routeAddress, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                {stop.address}
              </Text>
            </View>
          </View>
          {idx < pickups.length - 1 && (
            <View style={[styles.routeConnector, { backgroundColor: c.border }]} />
          )}
        </React.Fragment>
      ))}
      <View style={[styles.routeConnector, { backgroundColor: c.border }]} />
      {dropoffs.map((stop, idx) => (
        <React.Fragment key={`do-${stop.rideId}`}>
          <View style={styles.routeRow}>
            <View style={[styles.dotSquare, { backgroundColor: c.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.stopLabel, { color: c.mutedForeground, fontFamily: fonts.bold }]}>
                {t("driverHome.dropoff", { name: stop.riderName })}
              </Text>
              <Text style={[styles.routeAddress, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                {stop.address}
              </Text>
            </View>
          </View>
          {idx < dropoffs.length - 1 && (
            <View style={[styles.routeConnector, { backgroundColor: c.border }]} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  locateBtn: {
    position: "absolute",
    end: 16,
    top: "45%",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
    zIndex: 9,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    zIndex: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  greeting: { fontSize: 12, letterSpacing: 1 },
  greetingName: { fontSize: 18, marginTop: 2 },
  listContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "62%",
  },
  statusCard: {
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  statusLabel: { fontSize: 11, letterSpacing: 1.4 },
  statusValue: { fontSize: 19, marginTop: 4 },
  statusSub: { fontSize: 13, marginTop: 4 },
  card: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  typeBadgeText: { fontSize: 11, letterSpacing: 0.5 },
  capBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  capBadgeEmoji: { fontSize: 12 },
  capBadgeText: { fontSize: 11, letterSpacing: 0.3 },
  distancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  distanceText: { fontSize: 12 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 12 },
  routeBlock: { gap: 4 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  routeAddress: { flex: 1, fontSize: 14 },
  routeConnector: { width: 1, height: 12, marginStart: 5 },
  stopLabel: { fontSize: 10, letterSpacing: 0.6, marginBottom: 1 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  dotSquare: { width: 11, height: 11, borderRadius: 3 },
  fixedFareBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  fixedFareText: { fontSize: 13 },
  bidRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bidInputWrap: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    width: 110,
  },
  bidCurrency: { fontSize: 18, marginEnd: 4 },
  bidInput: {
    flex: 1,
    fontSize: 18,
    height: "100%",
  },
  declineBtn: { alignItems: "center", paddingVertical: 4 },
  declineText: { fontSize: 13 },
  bidErrorText: { fontSize: 12, marginTop: 4 },
  emptyBox: {
    borderRadius: 22,
    padding: 28,
    alignItems: "center",
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  radarContainer: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, marginBottom: 6 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 18 },
});
