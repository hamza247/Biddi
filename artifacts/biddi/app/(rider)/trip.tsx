import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Linking } from "react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, AppState, Easing, Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { AppMap } from "@/components/AppMap";
import type { AppMapHandle } from "@/components/AppMap";
import { Sheet } from "@/components/Sheet";
import { TripChatSheet } from "@/components/TripChatSheet";
import { useAuth, useRide } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useConfig } from "@/lib/config";
import { formatDisplayAmount } from "@/lib/formatCurrency";
import { useFontFamily } from "@/hooks/useFontFamily";
import type { NearbyDriver } from "@/hooks/useNearbyDrivers";
import { connectSocket, getSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/formatPhone";

const DEFAULT_SPEED_KMH = 30;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeLiveEtaMin(
  driverLat: number,
  driverLng: number,
  pickupLat: number,
  pickupLng: number,
  speedMps?: number,
): number {
  const distKm = haversineKm(driverLat, driverLng, pickupLat, pickupLng);
  const speedKmh =
    speedMps != null && speedMps > 1 ? speedMps * 3.6 : DEFAULT_SPEED_KMH;
  return Math.max(1, Math.round((distKm / speedKmh) * 60));
}

export default function RiderTrip() {
  const c = useColors();
  const cfg = useConfig();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ride } = useRide();
  const { user } = useAuth();
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const [showChat, setShowChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const handleChatRead = useCallback(() => setUnreadCount(0), []);

  const tripIdForChat = ride?.id ?? null;
  useEffect(() => {
    if (!tripIdForChat) return;
    let cancelled = false;
    const refetchUnread = () => {
      api<{ unread: number; byTrip: Record<string, number> }>(
        "/chat/unread-count",
      )
        .then((res) => {
          if (cancelled) return;
          const tripUnread = res.byTrip?.[tripIdForChat] ?? 0;
          setUnreadCount(tripUnread);
        })
        .catch(() => {});
    };
    refetchUnread();

    const onUnreadUpdate = (payload: { tripId: string; unread: number }) => {
      if (cancelled) return;
      if (payload.tripId === tripIdForChat) setUnreadCount(payload.unread);
    };
    let attachedSocket: ReturnType<typeof getSocket> | null = null;
    connectSocket().then((sock) => {
      if (!sock || cancelled) return;
      attachedSocket = sock;
      sock.on("chat:unread:update", onUnreadUpdate);
      sock.on("connect", refetchUnread);
    });

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") refetchUnread();
    });

    return () => {
      cancelled = true;
      if (attachedSocket) {
        attachedSocket.off("chat:unread:update", onUnreadUpdate);
        attachedSocket.off("connect", refetchUnread);
      }
      appStateSub.remove();
    };
  }, [tripIdForChat]);

  const mapRef = useRef<AppMapHandle>(null);
  const [driverLocation, setDriverLocation] = useState<NearbyDriver | null>(null);
  const driverLocationRef = useRef<NearbyDriver | null>(null);

  const [showCallSheet, setShowCallSheet] = useState(false);
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [safetyActive, setSafetyActive] = useState(false);
  const [showSafetySheet, setShowSafetySheet] = useState(false);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  const rideId = ride?.id ?? null;
  const rideStatus = ride?.status ?? null;

  useEffect(() => {
    if (!rideId) return;
    const isActive = rideStatus === "driver_arriving" || rideStatus === "in_progress";
    if (!isActive) {
      setDriverLocation(null);
      return;
    }

    let cancelled = false;

    const handleLocation = (data: NearbyDriver) => {
      if (!cancelled) setDriverLocation(data);
    };

    const handleOffline = () => {
      if (!cancelled) setDriverLocation(null);
    };

    connectSocket().then((sock) => {
      if (!sock || cancelled) return;
      sock.emit("ride:join", rideId);
      sock.on("trip:driver_location", handleLocation);
      sock.on("trip:driver_offline", handleOffline);
    });

    return () => {
      cancelled = true;
      setDriverLocation(null);
      const sock = getSocket();
      if (sock) {
        sock.emit("ride:leave", rideId);
        sock.off("trip:driver_location", handleLocation);
        sock.off("trip:driver_offline", handleOffline);
      }
    };
  }, [rideId, rideStatus]);

  useEffect(() => {
    driverLocationRef.current = driverLocation;
  }, [driverLocation]);

  useEffect(() => {
    if (!driverLocation) return;
    if (rideStatus === "driver_arriving") {
      mapRef.current?.recenter(driverLocation.lat, driverLocation.lng);
    } else if (rideStatus === "in_progress") {
      if (ride?.dropoff?.lat != null && ride?.dropoff?.lng != null) {
        mapRef.current?.fitPoints([
          { lat: driverLocation.lat, lng: driverLocation.lng },
          { lat: ride.dropoff.lat, lng: ride.dropoff.lng },
        ]);
      } else {
        mapRef.current?.recenter(driverLocation.lat, driverLocation.lng);
      }
    }
  }, [driverLocation, rideStatus, ride?.dropoff?.lat, ride?.dropoff?.lng]);

  const completedIconScale = useRef(new Animated.Value(0)).current;
  const completedPulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (rideStatus !== "completed") return;
    Animated.sequence([
      Animated.spring(completedIconScale, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.delay(100),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(completedPulseScale, {
            toValue: 1.06,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.timing(completedPulseScale, {
            toValue: 1,
            duration: 420,
            useNativeDriver: true,
          }),
        ]),
        { iterations: 2 },
      ).start();
    });
  }, [rideStatus, completedIconScale, completedPulseScale]);

  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevStatusRef.current === "driver_arriving" && rideStatus === "in_progress") {
      const pts: Array<{ lat: number; lng: number }> = [];
      const loc = driverLocationRef.current;
      if (loc) pts.push({ lat: loc.lat, lng: loc.lng });
      if (ride?.dropoff?.lat != null && ride?.dropoff?.lng != null) {
        pts.push({ lat: ride.dropoff.lat, lng: ride.dropoff.lng });
      }
      if (pts.length > 0) {
        mapRef.current?.fitPoints(pts);
      }
    }
    prevStatusRef.current = rideStatus;
  }, [rideStatus]);

  useEffect(() => {
    if (!ride) router.replace("/(rider)/home");
  }, [ride, router]);

  if (!ride) return null;

  // Queued state: a driver has accepted this ride as their NEXT trip but is
  // still finishing another one. Show a lightweight info screen instead of
  // the full driver-arriving UI (there's no acceptedBidId yet).
  if (ride.status === "queued" || ride.status === "assigned_next") {
    // Rough ETA estimate: the queued ride's own estimated duration is the
    // distance from the queueing driver's CURRENT dropoff to this pickup
    // converted to time at an assumed 30 km/h urban average. We use the
    // server-provided estimatedDurationMin (computed on the queue row) when
    // available, otherwise fall back to the ride's own pickup-trip estimate.
    const etaMin = Math.max(
      1,
      Math.round(
        ride.queuedEtaMin ?? ride.estimatedDurationMin ?? 5,
      ),
    );
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={[styles.statusBanner, { top: insets.top + 12, backgroundColor: c.primary }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { fontFamily: fonts.bold }]}>
              {t("riderTrip.queuedTitle", { defaultValue: "Driver finishing a nearby ride first" })}
            </Text>
            <Text style={[styles.statusSub, { fontFamily: fonts.medium }]} numberOfLines={2}>
              {t("riderTrip.queuedSub", {
                defaultValue:
                  "Your driver is wrapping up another trip nearby. Estimated pickup in ~{{etaMin}} min.",
                etaMin,
              })}
            </Text>
          </View>
        </View>
        <View style={{ position: "absolute", bottom: insets.bottom + 24, left: 16, right: 16 }}>
          <Button
            label={t("riderTrip.cancelQueued", { defaultValue: "Cancel ride" })}
            onPress={() => {
              Alert.alert(
                t("riderTrip.cancelQueuedConfirm", { defaultValue: "Cancel this ride?" }),
                "",
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("common.confirm", { defaultValue: "Confirm" }),
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await api(`/rides/${ride.id}/cancel`, { method: "POST" });
                        router.replace("/(rider)/home");
                      } catch {
                        Alert.alert(t("common.error"), t("common.tryAgain"));
                      }
                    },
                  },
                ],
              );
            }}
          />
        </View>
      </View>
    );
  }

  if (!ride.acceptedBidId) return null;
  const driver = ride.bids.find((b) => b.id === ride.acceptedBidId);
  if (!driver) return null;

  const status = ride.status;
  const tripMeta = `${ride.estimatedDistanceKm} km · ${ride.estimatedDurationMin} min`;

  const liveEtaMin =
    status === "driver_arriving" &&
    driverLocation != null &&
    ride.pickup.lat != null &&
    ride.pickup.lng != null
      ? computeLiveEtaMin(
          driverLocation.lat,
          driverLocation.lng,
          ride.pickup.lat,
          ride.pickup.lng,
          driverLocation.speed,
        )
      : null;

  const displayEtaMin = liveEtaMin ?? driver.etaMin;

  const banner =
    status === "driver_arriving"
      ? {
          title: t("riderTrip.driverOnTheWay", { name: driver.driverName }),
          sub: t("riderTrip.arrivingIn", { min: displayEtaMin }),
        }
      : status === "in_progress"
      ? {
          title: t("riderTrip.onTheWay"),
          sub: `${tripMeta} · ${ride.dropoff.address}`,
        }
      : {
          title: t("riderTrip.tripCompleted"),
          sub: `${formatDisplayAmount(ride.finalAmountDisplay?.displayAmount ?? driver.amountDisplay?.displayAmount ?? ride.finalAmount ?? driver.amount, cfg)} · ${t("riderTrip.cash")}`,
        };

  async function handleSafetyPress() {
    if (safetyActive) {
      setShowSafetySheet(true);
      return;
    }
    if (!rideId) return;
    setSafetyLoading(true);
    try {
      await api(`/rides/${rideId}/safety-alert`, { method: "POST" });
      setSafetyActive(true);
      setShowSafetySheet(true);
    } catch {
      Alert.alert(t("common.error"), t("common.tryAgain"));
    } finally {
      setSafetyLoading(false);
    }
  }

  async function handleCancelSafety() {
    if (!rideId) return;
    setSafetyLoading(true);
    try {
      await api(`/rides/${rideId}/safety-alert`, { method: "DELETE" });
      setSafetyActive(false);
      setShowSafetySheet(false);
    } catch {
      Alert.alert(t("common.error"), t("common.tryAgain"));
    } finally {
      setSafetyLoading(false);
    }
  }

  async function handleShareTrip() {
    if (!rideId || shareLoading) return;
    setShareLoading(true);
    try {
      const data = await api<{ url: string; token: string }>(
        `/rides/${rideId}/share`,
        { method: "POST" },
      );
      if (!data?.url) throw new Error("no_url");
      await Share.share({
        message: t("riderTrip.shareMessage", { url: data.url }),
        url: data.url,
      });
    } catch {
      Alert.alert(t("common.error"), t("common.tryAgain"));
    } finally {
      setShareLoading(false);
    }
  }

  async function handleOpenCallSheet() {
    setShowCallSheet(true);
    if (contactPhone || contactLoading) return;
    setContactLoading(true);
    try {
      const data = await api<{ phone: string }>(`/rides/${rideId}/contact`);
      setContactPhone(data.phone ?? null);
    } catch {
      setContactPhone(null);
    } finally {
      setContactLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppMap
        ref={mapRef}
        pickup={
          ride.pickup.lat != null && ride.pickup.lng != null
            ? { lat: ride.pickup.lat, lng: ride.pickup.lng }
            : null
        }
        dropoff={
          ride.dropoff.lat != null && ride.dropoff.lng != null
            ? { lat: ride.dropoff.lat, lng: ride.dropoff.lng }
            : null
        }
        routePolyline={ride.routePolyline ?? null}
        drivers={driverLocation ? [driverLocation] : []}
      />

      <View style={[styles.statusBanner, { top: insets.top + 12, backgroundColor: c.primary }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { fontFamily: fonts.bold }]}>{banner.title}</Text>
          <Text style={[styles.statusSub, { fontFamily: fonts.medium }]} numberOfLines={1}>
            {banner.sub}
          </Text>
        </View>
        {status === "driver_arriving" && (
          <View style={styles.statusEta}>
            <Text style={[styles.statusEtaNum, { fontFamily: fonts.bold }]}>{displayEtaMin}</Text>
            <Text style={[styles.statusEtaUnit, { fontFamily: fonts.semiBold }]}>{t("riderTrip.minUnit")}</Text>
          </View>
        )}
        {status === "completed" && (
          <Animated.View
            style={[
              styles.completedIcon,
              { backgroundColor: "rgba(255,255,255,0.2)", transform: [{ scale: completedIconScale }, { scale: completedPulseScale }] },
            ]}
          >
            <Feather name="check-circle" size={22} color="#fff" />
          </Animated.View>
        )}
      </View>

      <View style={{ flex: 1 }} />

      <Sheet>
        <View style={styles.driverRow}>
          <Avatar initial={driver.driverInitial} size={56} photoUrl={driver.driverPhotoUrl} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.driverName, { color: c.foreground, fontFamily: fonts.bold }]}>{driver.driverName}</Text>
            <View style={styles.starRow}>
              <Feather name="star" size={12} color={c.accent} />
              <Text style={[styles.starText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {driver.rating.toFixed(2)} · {driver.trips.toLocaleString()} {t("riderTrip.trips")}
              </Text>
            </View>
          </View>
          <View style={[styles.plateBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.plateText, { color: c.foreground, fontFamily: fonts.bold }]}>{driver.plate}</Text>
          </View>
        </View>

        <View style={[styles.vehicleBar, { backgroundColor: c.surface }]}>
          <Feather name="truck" size={16} color={c.mutedForeground} />
          <Text style={[styles.vehicleText, { color: c.foreground, fontFamily: fonts.semiBold }]}>{driver.vehicle}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.fareTag, { color: c.foreground, fontFamily: fonts.bold }]}>{formatDisplayAmount(driver.amountDisplay?.displayAmount ?? driver.amount, cfg)}</Text>
        </View>

        <View style={[styles.tripMetaRow, { backgroundColor: c.surface }]}>
          <Feather name="map" size={14} color={c.mutedForeground} />
          <Text style={[styles.tripMetaText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>{tripMeta}</Text>
        </View>

        {ride.isShared && (ride.sharedRidersCount ?? 1) > 1 && (
          <View style={[styles.sharedNotice, { backgroundColor: c.primarySoft }]}>
            <Text style={styles.sharedNoticeEmoji}>👥</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sharedNoticeTitle, { color: c.primary, fontFamily: fonts.bold }]}>
                {t("riderTrip.sharedRide")}
              </Text>
              <Text style={[styles.sharedNoticeSub, { color: c.primary, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(12) }]}>
                {t("riderTrip.sharedRideDetail", { count: ride.sharedRidersCount! - 1 })}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.actionRow}>
          <ActionButton
            icon="phone"
            label={t("riderTrip.call")}
            onPress={handleOpenCallSheet}
          />
          {(status === "driver_arriving" || status === "in_progress") && (
            <ActionButton
              icon="message-circle"
              label={t("riderTrip.message")}
              badge={unreadCount}
              onPress={() => { setUnreadCount(0); setShowChat(true); }}
            />
          )}
          {(status === "driver_arriving" || status === "in_progress") && (
            <ActionButton
              icon="share-2"
              label={t("riderTrip.share")}
              onPress={handleShareTrip}
              loading={shareLoading}
            />
          )}
          <ActionButton
            icon="shield"
            label={t("riderTrip.safety")}
            active={safetyActive}
            onPress={handleSafetyPress}
            loading={safetyLoading}
          />
        </View>

        {status === "completed" ? (
          <Button label={t("riderTrip.rateDriver")} onPress={() => router.replace("/(rider)/rate")} />
        ) : status === "in_progress" ? (
          <TripInProgressIndicator />
        ) : (
          <Button
            variant="secondary"
            label={t("riderTrip.cancelRide")}
            onPress={() => router.replace("/(rider)/home")}
          />
        )}
      </Sheet>

      {user && ride && (status === "driver_arriving" || status === "in_progress") && (
        <TripChatSheet
          tripId={ride.id}
          userId={user.id}
          peerName={driver.driverName}
          isOpen={showChat}
          onClose={() => setShowChat(false)}
          onChatRead={handleChatRead}
          role="rider"
        />
      )}

      {/* Call sheet */}
      <Modal
        visible={showCallSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCallSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("riderTrip.driverContactTitle")}
            </Text>
            <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {driver.driverName}
            </Text>
            {contactLoading ? (
              <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("common.loading")}
              </Text>
            ) : contactPhone ? (
              <>
                <View style={[styles.phoneBox, { backgroundColor: c.surface }]}>
                  <Feather name="phone" size={18} color={c.primary} />
                  <Text style={[styles.phoneNumber, { color: c.foreground, fontFamily: fonts.bold }]}>
                    {formatPhoneDisplay(contactPhone)}
                  </Text>
                </View>
                <Button
                  label={t("riderTrip.callNow")}
                  onPress={() => {
                    Linking.openURL(`tel:${contactPhone}`);
                    setShowCallSheet(false);
                  }}
                />
              </>
            ) : (
              <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("riderTrip.phoneUnavailable")}
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowCallSheet(false)}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Safety sheet */}
      <Modal
        visible={showSafetySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSafetySheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <View style={[styles.safetyIconWrap, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="shield" size={28} color="#EF4444" />
            </View>
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {safetyActive ? t("riderTrip.safetyAlertActive") : t("riderTrip.safetyAlertTitle")}
            </Text>
            <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {t("riderTrip.safetyAlertDesc")}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.cancelAlertBtn,
                { backgroundColor: "#FEE2E2", opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={handleCancelSafety}
              disabled={safetyLoading}
            >
              <Text style={[styles.cancelAlertText, { fontFamily: fonts.semiBold }]}>
                {t("riderTrip.safetyFalseAlarm")}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowSafetySheet(false)}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.close")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TripInProgressIndicator() {
  const c = useColors();
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={[styles.progressContainer, { backgroundColor: c.surface }]}>
      <Animated.View style={[styles.progressDot, { backgroundColor: c.primary, opacity: pulse }]} />
      <Text style={[styles.progressText, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("riderTrip.tripInProgress")}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  badge,
  active,
  loading,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress?: () => void;
  badge?: number;
  active?: boolean;
  loading?: boolean;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  const iconBg = active ? "#FEE2E2" : c.surface;
  const iconColor = active ? "#EF4444" : c.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.action, { opacity: pressed || loading ? 0.7 : 1 }]}
    >
      <View style={{ position: "relative" }}>
        <View style={[styles.actionIcon, { backgroundColor: iconBg }]}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        {!!badge && badge > 0 && (
          <View style={styles.badge}>
            <Text style={[styles.badgeText, { fontFamily: fonts.bold }]}>
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.actionLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statusBanner: {
    position: "absolute",
    start: 16,
    end: 16,
    minHeight: 64,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#3819A6",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statusTitle: { color: "#fff", fontSize: 15 },
  statusSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    marginTop: 2,
    maxWidth: 240,
  },
  statusEta: { marginStart: "auto", alignItems: "center" },
  statusEtaNum: { color: "#fff", fontSize: 22, lineHeight: 24 },
  statusEtaUnit: { color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  driverName: { fontSize: 17 },
  starRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  starText: { fontSize: 12 },
  plateBox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  plateText: { fontSize: 13, letterSpacing: 1 },
  vehicleBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  vehicleText: { fontSize: 14 },
  fareTag: { fontSize: 16 },
  tripMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: -10,
    marginBottom: 18,
  },
  tripMetaText: { fontSize: 13 },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 4,
    marginBottom: 18,
  },
  action: { alignItems: "center", gap: 6 },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 12 },
  badge: {
    position: "absolute",
    top: -4,
    end: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#E53E3E",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    lineHeight: 12,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  progressText: {
    fontSize: 14,
  },
  completedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sharedNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  sharedNoticeEmoji: { fontSize: 22, lineHeight: 26 },
  sharedNoticeTitle: { fontSize: 14, marginBottom: 3 },
  sharedNoticeSub: { fontSize: 12, lineHeight: 17 },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    alignItems: "center",
    gap: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, textAlign: "center" },
  modalSub: { fontSize: 14, textAlign: "center", marginBottom: 4 },
  phoneBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
    justifyContent: "center",
    marginVertical: 8,
  },
  phoneNumber: { fontSize: 20, letterSpacing: 1 },
  cancelBtn: { paddingVertical: 12 },
  cancelText: { fontSize: 14 },
  safetyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  cancelAlertBtn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
    marginTop: 4,
  },
  cancelAlertText: {
    color: "#EF4444",
    fontSize: 15,
  },
});
