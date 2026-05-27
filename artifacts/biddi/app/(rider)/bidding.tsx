import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { AppMap } from "@/components/AppMap";
import { CountdownBar } from "@/components/CountdownBar";
import { useRide } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useCountdown } from "@/hooks/useCountdown";
import { useConfig, type PublicConfig } from "@/lib/config";
import { formatDisplayAmount } from "@/lib/formatCurrency";
import type { DriverBid } from "@/lib/types";

const COUNTDOWN_SECONDS = 30;

type SortMode = "price" | "eta";

export default function BiddingScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ride, cancelRide, acceptBid } = useRide();
  const cfg = useConfig();
  const [sort, setSort] = useState<SortMode>("price");
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const [expired, setExpired] = useState(false);
  const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);
  const [cancellingRide, setCancellingRide] = useState(false);
  const cancellingRef = useRef(false);

  useEffect(() => {
    if (!ride) {
      router.replace("/(rider)/home");
      return;
    }
    if (
      ride.status === "driver_arriving" ||
      ride.status === "in_progress" ||
      ride.status === "queued" ||
      ride.status === "assigned_next"
    ) {
      router.replace("/(rider)/trip");
    }
  }, [ride, router]);

  const sortedBids = useMemo(() => {
    if (!ride) return [];
    const list = [...ride.bids];
    list.sort((a, b) => (sort === "price" ? a.amount - b.amount : a.etaMin - b.etaMin));
    return list;
  }, [ride, sort]);

  const countdownActive = sortedBids.length > 0 && !expired;

  const handleExpire = useCallback(() => {
    setExpired(true);
    cancelRide();
    router.replace("/(rider)/home");
    setTimeout(() => {
      Alert.alert(
        t("bidding.offersExpiredTitle"),
        t("bidding.offersExpiredMessage")
      );
    }, 300);
  }, [cancelRide, router, t]);

  const { secondsLeft, progress } = useCountdown(
    COUNTDOWN_SECONDS,
    handleExpire,
    countdownActive
  );

  if (!ride) return null;

  const offersLabel =
    sortedBids.length === 0
      ? t("bidding.findingDrivers")
      : sortedBids.length === 1
      ? t("bidding.offersOne")
      : t("bidding.offersOther", { count: sortedBids.length });

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={styles.mapWrap}>
        <AppMap
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
        />
        <View style={[styles.headerBar, { top: insets.top + 12 }]}>
          <Pressable
            disabled={cancellingRide}
            onPress={async () => {
              if (cancellingRef.current) return;
              cancellingRef.current = true;
              setCancellingRide(true);
              try {
                await cancelRide();
                router.replace("/(rider)/home");
              } catch {
                cancellingRef.current = false;
                setCancellingRide(false);
              }
            }}
            style={[styles.iconBtn, { backgroundColor: c.background }]}
          >
            {cancellingRide ? (
              <ActivityIndicator size="small" color={c.foreground} />
            ) : (
              <Feather name="x" size={20} color={c.foreground} />
            )}
          </Pressable>
          <View style={[styles.routePill, { backgroundColor: c.background }]}>
            <View style={[styles.dot, { backgroundColor: c.accent }]} />
            <Text style={[styles.routeText, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
              {ride.dropoff.label}
            </Text>
            <Text style={[styles.routeMeta, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              · {ride.estimatedDistanceKm} km · {ride.estimatedDurationMin} min
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.sheet, { backgroundColor: c.background, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.handle, { backgroundColor: c.border }]} />
        <View style={styles.titleRow}>
          <View>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
              {offersLabel}
            </Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {sortedBids.length === 0
                ? t("bidding.driversReviewing")
                : t("bidding.tapToAccept")}
            </Text>
          </View>
          {sortedBids.length === 0 && <ActivityIndicator color={c.primary} />}
        </View>

        {sortedBids.length > 0 && (
          <CountdownBar progress={progress} secondsLeft={secondsLeft} />
        )}

        {ride.isShared && (ride.sharedRidersCount ?? 1) > 1 && (
          <View style={[styles.sharedBanner, { backgroundColor: c.primarySoft }]}>
            <Text style={styles.sharedBannerEmoji}>👥</Text>
            <Text style={[styles.sharedBannerText, { color: c.primary, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(13) }]}>
              {t("bidding.sharedMatch")}
            </Text>
          </View>
        )}

        {sortedBids.length > 0 && (
          <View style={[styles.sortRow, { backgroundColor: c.surface }]}>
            <SortPill active={sort === "price"} label={t("bidding.lowestPrice")} onPress={() => setSort("price")} />
            <SortPill active={sort === "eta"} label={t("bidding.fastest")} onPress={() => setSort("eta")} />
          </View>
        )}

        <FlatList
          data={sortedBids}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ paddingBottom: 16, paddingTop: 4, gap: 10 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <BidCard
              bid={item}
              index={index}
              cfg={cfg}
              tripsLabel={t("bidding.tripsCount", { count: item.trips })}
              isAccepting={acceptingBidId === item.id}
              disabled={acceptingBidId !== null}
              onAccept={async () => {
                if (acceptingBidId !== null) return;
                setAcceptingBidId(item.id);
                setExpired(true);
                try {
                  await acceptBid(item.id);
                  router.replace("/(rider)/trip");
                } catch {
                  setExpired(false);
                } finally {
                  setAcceptingBidId(null);
                }
              }}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[styles.skeleton, { backgroundColor: c.surface, opacity: 1 - i * 0.25 }]}
                />
              ))}
            </View>
          }
        />

        <Button
          variant="secondary"
          label={t("bidding.cancelRide")}
          loading={cancellingRide}
          disabled={cancellingRide}
          onPress={async () => {
            if (cancellingRide) return;
            setCancellingRide(true);
            try {
              await cancelRide();
              router.replace("/(rider)/home");
            } catch {
              setCancellingRide(false);
            }
          }}
        />
      </View>
    </View>
  );
}

function SortPill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.sortPill,
        { backgroundColor: active ? c.background : "transparent" },
      ]}
    >
      <Text
        style={[
          styles.sortPillText,
          { color: active ? c.foreground : c.mutedForeground, fontFamily: fonts.semiBold },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function BidCard({
  bid,
  index,
  cfg,
  tripsLabel,
  isAccepting,
  disabled,
  onAccept,
}: {
  bid: DriverBid;
  index: number;
  cfg: PublicConfig;
  tripsLabel: string;
  isAccepting: boolean;
  disabled: boolean;
  onAccept: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();

  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const delay = index * 80;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        onPress={onAccept}
        disabled={disabled}
        style={({ pressed }) => [
          styles.bidCard,
          {
            backgroundColor: c.surface,
            borderColor: isAccepting ? c.primary : c.border,
            opacity: disabled && !isAccepting ? 0.5 : pressed ? 0.92 : 1,
            transform: [{ scale: pressed && !disabled ? 0.99 : 1 }],
          },
        ]}
      >
        <Avatar initial={bid.driverInitial} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bidDriver, { color: c.foreground, fontFamily: fonts.semiBold }]}>{bid.driverName}</Text>
          <Text style={[styles.bidVehicle, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {bid.vehicle} · ⭐ {bid.rating?.toFixed(1)} · {tripsLabel}
          </Text>
        </View>
        {isAccepting ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <View style={{ alignItems: fonts.isRTL ? "flex-start" : "flex-end", gap: 2 }}>
            <Text style={[styles.bidAmount, { color: c.foreground, fontFamily: fonts.bold }]}>{formatDisplayAmount(bid.amountDisplay?.displayAmount ?? bid.amount, cfg)}</Text>
            <Text style={[styles.bidEta, { color: c.mutedForeground, fontFamily: fonts.regular }]}>{bid.etaMin} min</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { flex: 1 },
  headerBar: {
    position: "absolute",
    start: 12,
    end: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  routePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 14 },
  routeMeta: { fontSize: 12 },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: "55%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: { fontSize: 20 },
  subtitle: { fontSize: 13, marginTop: 4 },
  sharedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  sharedBannerEmoji: { fontSize: 16 },
  sharedBannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  sortRow: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
    gap: 4,
  },
  sortPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  sortPillText: { fontSize: 13 },
  emptyWrap: { gap: 10 },
  skeleton: {
    height: 80,
    borderRadius: 16,
  },
  bidCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  bidDriver: { fontSize: 15 },
  bidVehicle: { fontSize: 12, marginTop: 2 },
  bidAmount: { fontSize: 18 },
  bidEta: { fontSize: 12 },
});
