import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig } from "@/lib/config";
import { formatUsdAmount } from "@/lib/formatCurrency";
import { AppMap } from "@/components/AppMap";

interface TripDetail {
  id: string;
  date: number;
  amount: number;
  riderName: string;
  pickup: string;
  dropoff: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  routePolyline: string | null;
  distanceKm: number | null;
  durationMin: number | null;
  couponCode: string | null;
  couponDiscount: number | null;
  grossAmount: number | null;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDistance(km: number | null): string {
  if (km == null) return "—";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function formatDuration(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function TripDetailScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const cfg = useConfig();

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const slideAnim = useRef(new Animated.Value(120)).current;

  useEffect(() => {
    if (!rideId) return;
    setLoading(true);
    setError(false);
    api<{ trip: TripDetail }>(`/driver/trips/${rideId}`)
      .then((data) => {
        setTrip(data.trip);
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 60,
          friction: 10,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [rideId]);

  const hasMap =
    trip &&
    trip.pickupLat != null &&
    trip.pickupLng != null &&
    trip.dropoffLat != null &&
    trip.dropoffLng != null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.mapContainer, { backgroundColor: c.surface }]}>
        {hasMap ? (
          <AppMap
            pickup={{ lat: trip.pickupLat!, lng: trip.pickupLng! }}
            dropoff={{ lat: trip.dropoffLat!, lng: trip.dropoffLng! }}
            routePolyline={trip.routePolyline}
            fit
          />
        ) : (
          <View style={[styles.mapPlaceholder, { backgroundColor: c.surface }]}>
            {loading ? (
              <ActivityIndicator color={c.primary} />
            ) : (
              <Feather name="map" size={40} color={c.mutedForeground} />
            )}
          </View>
        )}

        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + 12, backgroundColor: c.background }]}
        >
          <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={20} color={c.foreground} />
        </Pressable>
      </View>

      <Animated.View
        style={[
          styles.panel,
          { backgroundColor: c.background, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={c.primary} />
            <Text style={[styles.loadingText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("common.loading")}
            </Text>
          </View>
        )}

        {error && !loading && (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={22} color={c.mutedForeground} />
            <Text style={[styles.errorText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("tripDetail.error")}
            </Text>
          </View>
        )}

        {trip && !loading && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          >
            <View style={styles.amountRow}>
              <View style={[styles.amountBadge, { backgroundColor: c.primarySoft }]}>
                <Feather name="check-circle" size={16} color={c.primary} />
              </View>
              <Text style={[styles.amount, { color: c.foreground, fontFamily: fonts.bold }]}>
                +{formatUsdAmount(trip.amount, cfg)}
              </Text>
            </View>

            <Text style={[styles.riderName, { color: c.foreground, fontFamily: fonts.semiBold }]}>
              {trip.riderName}
            </Text>
            <Text style={[styles.dateText, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {formatDate(trip.date)}
            </Text>

            {trip.couponDiscount != null &&
              trip.couponDiscount > 0 &&
              trip.grossAmount != null && (
                <View
                  style={[
                    styles.couponBox,
                    { backgroundColor: c.surface, borderColor: c.border },
                  ]}
                >
                  <View style={styles.couponHeaderRow}>
                    <Feather name="tag" size={14} color={c.primary} />
                    <Text
                      style={[
                        styles.couponHeader,
                        { color: c.mutedForeground, fontFamily: fonts.semiBold },
                      ]}
                    >
                      {trip.couponCode
                        ? t("tripDetail.promoApplied", { code: trip.couponCode })
                        : t("tripDetail.promoApplied", { code: "" })}
                    </Text>
                  </View>
                  <View style={styles.couponRow}>
                    <Text style={[styles.couponLabel, { color: c.foreground, fontFamily: fonts.medium }]}>
                      {t("tripDetail.grossFare")}
                    </Text>
                    <Text style={[styles.couponValue, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                      {formatUsdAmount(trip.grossAmount, cfg)}
                    </Text>
                  </View>
                  <View style={styles.couponRow}>
                    <Text style={[styles.couponLabel, { color: c.foreground, fontFamily: fonts.medium }]}>
                      {t("tripDetail.promoDiscount")}
                    </Text>
                    <Text style={[styles.couponValue, { color: c.primary, fontFamily: fonts.semiBold }]}>
                      −{formatUsdAmount(trip.couponDiscount, cfg)}
                    </Text>
                  </View>
                  <View style={[styles.couponDivider, { backgroundColor: c.border }]} />
                  <View style={styles.couponRow}>
                    <Text style={[styles.couponLabel, { color: c.foreground, fontFamily: fonts.bold }]}>
                      {t("tripDetail.netToYou")}
                    </Text>
                    <Text style={[styles.couponValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                      {formatUsdAmount(trip.amount, cfg)}
                    </Text>
                  </View>
                </View>
              )}

            <View style={[styles.divider, { backgroundColor: c.border }]} />

            <View style={styles.routeBlock}>
              <View style={styles.routeDot}>
                <View style={[styles.dotFill, { backgroundColor: c.primary }]} />
                <View style={[styles.routeLine, { backgroundColor: c.border }]} />
                <View style={[styles.dotSquare, { borderColor: c.foreground }]} />
              </View>
              <View style={{ flex: 1, gap: 16 }}>
                <View>
                  <Text style={[styles.routeLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                    {t("tripDetail.pickup")}
                  </Text>
                  <Text style={[styles.routeAddress, { color: c.foreground, fontFamily: fonts.semiBold, lineHeight: fonts.getBodyLineHeight(14) }]} numberOfLines={2}>
                    {trip.pickup}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.routeLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                    {t("tripDetail.dropoff")}
                  </Text>
                  <Text style={[styles.routeAddress, { color: c.foreground, fontFamily: fonts.semiBold, lineHeight: fonts.getBodyLineHeight(14) }]} numberOfLines={2}>
                    {trip.dropoff}
                  </Text>
                </View>
              </View>
            </View>

            {(trip.distanceKm != null || trip.durationMin != null) && (
              <>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Feather name="navigation" size={14} color={c.mutedForeground} />
                    <Text style={[styles.statValue, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                      {formatDistance(trip.distanceKm)}
                    </Text>
                    <Text style={[styles.statLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                      {t("tripDetail.distance")}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: c.border }]} />
                  <View style={styles.stat}>
                    <Feather name="clock" size={14} color={c.mutedForeground} />
                    <Text style={[styles.statValue, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                      {formatDuration(trip.durationMin)}
                    </Text>
                    <Text style={[styles.statLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                      {t("tripDetail.duration")}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    minHeight: 280,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 20,
  },
  loadingText: { fontSize: 14 },
  errorBox: {
    alignItems: "center",
    gap: 10,
    padding: 32,
  },
  errorText: { fontSize: 14, textAlign: "center" },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  amountBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  amount: { fontSize: 28 },
  riderName: { fontSize: 17, marginTop: 2 },
  dateText: { fontSize: 13, marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
  routeBlock: {
    flexDirection: "row",
    gap: 14,
  },
  routeDot: {
    width: 20,
    alignItems: "center",
    paddingTop: 4,
    gap: 0,
  },
  dotFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeLine: {
    width: 2,
    flex: 1,
    marginVertical: 4,
    minHeight: 32,
  },
  dotSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 2,
  },
  routeLabel: { fontSize: 11, letterSpacing: 0.5, marginBottom: 2 },
  routeAddress: { fontSize: 14, lineHeight: 20 },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  statValue: { fontSize: 18 },
  statLabel: { fontSize: 11 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 40 },
  couponBox: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  couponHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  couponHeader: { fontSize: 11, letterSpacing: 1.1 },
  couponRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  couponLabel: { fontSize: 13 },
  couponValue: { fontSize: 13 },
  couponDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
});
