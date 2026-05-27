import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useMemo } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useDriver } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig, type PublicConfig } from "@/lib/config";
import { formatUsdAmount } from "@/lib/formatCurrency";
import { RouteArrow } from "@/components/RouteArrow";
import type { EarningsEntry } from "@/lib/types";

const STAGGER_MS = 50;

type TripRowProps = {
  item: EarningsEntry;
  index: number;
  cfg: PublicConfig;
  onPress: () => void;
};

function AnimatedTripRow({ item, index, cfg, onPress }: TripRowProps) {
  const c = useColors();
  const fonts = useFontFamily();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        delay: index * STAGGER_MS,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        delay: index * STAGGER_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.tripRow,
          { backgroundColor: c.surface },
          pressed && { opacity: 0.75 },
        ]}
      >
        <View style={[styles.tripIcon, { backgroundColor: c.primarySoft }]}>
          <Feather name="check" size={16} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tripRider, { color: c.foreground, fontFamily: fonts.semiBold }]}>{item.riderName}</Text>
          <Text style={[styles.tripRoute, { color: c.mutedForeground, fontFamily: fonts.medium }]} numberOfLines={1}>
            {item.pickup} <RouteArrow /> {item.dropoff}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={[styles.tripAmount, { color: c.foreground, fontFamily: fonts.bold }]}>
            +{formatUsdAmount(item.amount, cfg)}
          </Text>
          <Feather name={fonts.isRTL ? "chevron-left" : "chevron-right"} size={16} color={c.mutedForeground} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const DAY = 24 * 60 * 60 * 1000;

export default function EarningsScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { earnings, earningsStale } = useDriver();
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const cfg = useConfig();

  const springScale = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(springScale, {
      toValue: 1,
      tension: 60,
      friction: 7,
      useNativeDriver: true,
    }).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.06,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 420,
            useNativeDriver: true,
          }),
        ]),
        { iterations: 2 }
      ).start();
    });
  }, []);

  const { today, week, total } = useMemo(() => {
    const now = Date.now();
    const todayTotal = earnings.filter((e) => now - e.date < DAY).reduce((s, e) => s + e.amount, 0);
    const weekTotal = earnings.filter((e) => now - e.date < 7 * DAY).reduce((s, e) => s + e.amount, 0);
    const tt = earnings.reduce((s, e) => s + e.amount, 0);
    return { today: todayTotal, week: weekTotal, total: tt };
  }, [earnings]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("earnings.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {earningsStale && (
        <View style={[styles.staleNotice, { backgroundColor: c.surface }]}>
          <Feather name="alert-circle" size={14} color={c.mutedForeground} />
          <Text style={[styles.staleText, { color: c.mutedForeground, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(12) }]}>
            {t("earnings.loadError")}
          </Text>
        </View>
      )}

      <Animated.View
        style={[
          styles.heroCard,
          { backgroundColor: c.foreground },
          { transform: [{ scale: Animated.multiply(springScale, pulseScale) }] },
        ]}
      >
        <Text style={[styles.heroLabel, { fontFamily: fonts.bold }]}>{t("earnings.thisWeek")}</Text>
        <Text style={[styles.heroAmount, { fontFamily: fonts.bold }]}>{formatUsdAmount(week, cfg)}</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatLabel, { fontFamily: fonts.semiBold }]}>{t("earnings.today")}</Text>
            <Text style={[styles.heroStatValue, { fontFamily: fonts.bold }]}>{formatUsdAmount(today, cfg)}</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatLabel, { fontFamily: fonts.semiBold }]}>{t("earnings.allTime")}</Text>
            <Text style={[styles.heroStatValue, { fontFamily: fonts.bold }]}>{formatUsdAmount(total, cfg)}</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatLabel, { fontFamily: fonts.semiBold }]}>{t("earnings.trips")}</Text>
            <Text style={[styles.heroStatValue, { fontFamily: fonts.bold }]}>{earnings.length}</Text>
          </View>
        </View>
      </Animated.View>

      <Text style={[styles.section, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{t("earnings.recentTrips")}</Text>

      <FlatList
        data={earnings}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 8 }}
        renderItem={({ item, index }) => (
          <AnimatedTripRow
            item={item}
            index={index}
            cfg={cfg}
            onPress={() => router.push({ pathname: "/(driver)/trip-detail", params: { rideId: item.rideId } })}
          />
        )}
        ListEmptyComponent={
          <View style={[styles.empty, { backgroundColor: c.surface }]}>
            <Feather name="inbox" size={22} color={c.mutedForeground} />
            <Text style={[styles.emptyText, { color: c.mutedForeground, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(13) }]}>
              {t("earnings.noTrips")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17 },
  heroCard: {
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 22,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    letterSpacing: 1.4,
  },
  heroAmount: {
    color: "#fff",
    fontSize: 44,
    marginTop: 6,
  },
  heroRow: {
    flexDirection: "row",
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.18)",
  },
  heroStat: { flex: 1 },
  heroStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  heroStatValue: { color: "#fff", fontSize: 16, marginTop: 4 },
  heroDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.18)", marginHorizontal: 12 },
  section: {
    fontSize: 11,
    letterSpacing: 1.2,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 10,
  },
  tripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
  },
  tripIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tripRider: { fontSize: 15 },
  tripRoute: { fontSize: 12, marginTop: 2 },
  tripAmount: { fontSize: 16 },
  empty: {
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 28,
    alignItems: "center",
    gap: 12,
  },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  staleNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  staleText: { fontSize: 12, flex: 1, lineHeight: 16 },
});
