import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { RatingStars } from "@/components/RatingStars";
import { useRide } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useConfig } from "@/lib/config";
import { formatDisplayAmount } from "@/lib/formatCurrency";
import { useFontFamily } from "@/hooks/useFontFamily";
import type { FareBreakdown } from "@/lib/types";

export default function RateScreen() {
  const c = useColors();
  const cfg = useConfig();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ride, rateAndClose } = useRide();
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const { t } = useTranslation();
  const fonts = useFontFamily();

  const iconScale = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(iconScale, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.delay(100),
    ]).start(() => {
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
        { iterations: 2 },
      ).start();
    });
  }, [iconScale, pulseScale]);

  if (!ride || !ride.acceptedBidId) {
    router.replace("/(rider)/home");
    return null;
  }
  const driver = ride.bids.find((b) => b.id === ride.acceptedBidId);
  if (!driver) return null;

  const finish = () => {
    rateAndClose(score, comment.trim() || undefined);
    router.replace("/(rider)/home");
  };

  // Prefer server-provided display envelopes so the symbol and the
  // converted amount always agree. Fall back to the USD figure +
  // platform symbol when the server hasn't enriched the payload (older
  // servers / partial data).
  const breakdownDisplay = ride.fareBreakdownDisplay;
  const breakdown = breakdownDisplay ?? ride.fareBreakdown;
  const totalDisplayed =
    ride.finalAmountDisplay?.displayAmount ??
    breakdownDisplay?.total ??
    ride.finalAmount ??
    driver.amountDisplay?.displayAmount ??
    driver.amount;
  const agreedFallback = driver.amountDisplay?.displayAmount ?? driver.amount;
  const lineItems = buildLineItems(breakdown, agreedFallback, t);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 16 }}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.amountBox,
            { backgroundColor: c.primarySoft, transform: [{ scale: iconScale }, { scale: pulseScale }] },
          ]}
        >
          <View style={[styles.amountCheckIcon, { backgroundColor: c.primary }]}>
            <Feather name="check-circle" size={26} color="#fff" />
          </View>
          <Text style={[styles.amountLabel, { color: c.primary, fontFamily: fonts.semiBold }]}>{t("rate.youPaid")}</Text>
          <Text style={[styles.amountValue, { color: c.foreground, fontFamily: fonts.bold }]}>
            {formatDisplayAmount(totalDisplayed, cfg)}
          </Text>
          <Text style={[styles.amountMethod, { color: c.mutedForeground, fontFamily: fonts.medium }]}>{t("rate.cash")}</Text>
        </Animated.View>

        {lineItems.length > 0 && (
          <View
            style={[
              styles.breakdownBox,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Text style={[styles.breakdownTitle, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
              {t("rate.fareBreakdown")}
            </Text>
            {lineItems.map((item) => (
              <View key={item.label} style={styles.breakdownRow}>
                <Text
                  style={[styles.breakdownLabel, { color: c.foreground, fontFamily: fonts.medium }]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                <Text
                  style={[
                    styles.breakdownValue,
                    { color: item.value < 0 ? c.primary : c.foreground, fontFamily: fonts.semiBold },
                  ]}
                >
                  {item.value < 0
                    ? `−${formatDisplayAmount(Math.abs(item.value), cfg)}`
                    : formatDisplayAmount(item.value, cfg)}
                </Text>
              </View>
            ))}
            <View style={[styles.breakdownDivider, { backgroundColor: c.border }]} />
            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownTotalLabel, { color: c.foreground, fontFamily: fonts.bold }]}>
                {t("rate.total")}
              </Text>
              <Text style={[styles.breakdownTotalValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                {formatDisplayAmount(totalDisplayed, cfg)}
              </Text>
            </View>
            {breakdown?.minimumApplied && (
              <Text style={[styles.breakdownNote, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("rate.minimumFareApplied")}
              </Text>
            )}
            {breakdown?.agreedBid != null &&
              Math.abs(breakdown.agreedBid - totalDisplayed) > 0.01 && (
                <Text style={[styles.breakdownNote, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("rate.agreedBid", { amount: formatDisplayAmount(breakdown.agreedBid, cfg) })}
                </Text>
              )}
          </View>
        )}

        <View style={styles.driverWrap}>
          <Avatar initial={driver.driverInitial} size={72} />
          <Text style={[styles.driverName, { color: c.foreground, fontFamily: fonts.bold }]}>{driver.driverName}</Text>
          <Text style={[styles.driverVehicle, { color: c.mutedForeground, fontFamily: fonts.medium }]}>{driver.vehicle}</Text>
        </View>

        <Text style={[styles.question, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("rate.howWasRide")}</Text>
        <RatingStars score={score} onSelect={setScore} />

        <TextInput
          style={[
            styles.commentInput,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              color: c.foreground,
              fontFamily: fonts.medium,
            },
          ]}
          placeholder={t("rate.leaveComment")}
          placeholderTextColor={c.mutedForeground}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
          textAlignVertical="top"
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label={t("common.submit")} onPress={finish} />
      </View>
    </View>
  );
}

interface LineItem {
  label: string;
  value: number;
}

function buildLineItems(
  breakdown: FareBreakdown | undefined,
  agreedAmount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): LineItem[] {
  if (!breakdown) {
    return [{ label: t("rate.tripFare"), value: agreedAmount }];
  }
  const items: LineItem[] = [];
  if (breakdown.base > 0) items.push({ label: t("rate.baseFare"), value: breakdown.base });
  if (breakdown.distance > 0)
    items.push({
      label: t("rate.distance", { km: breakdown.distanceKm.toFixed(1) }),
      value: breakdown.distance,
    });
  if (breakdown.time > 0)
    items.push({
      label: t("rate.time", { min: breakdown.durationMin }),
      value: breakdown.time,
    });
  if (breakdown.peakSurcharge > 0)
    items.push({ label: t("rate.peakSurcharge"), value: breakdown.peakSurcharge });
  if (breakdown.nightSurcharge > 0)
    items.push({ label: t("rate.nightSurcharge"), value: breakdown.nightSurcharge });
  if ((breakdown.weatherSurcharge ?? 0) > 0) {
    const reasonKey = breakdown.weatherReason
      ? t(`rate.weatherReason.${breakdown.weatherReason}`, {
          defaultValue: breakdown.weatherReason,
        })
      : "";
    items.push({
      label: t("rate.weatherSurcharge", { reason: reasonKey }),
      value: breakdown.weatherSurcharge ?? 0,
    });
  }
  if ((breakdown.airportPickupSurcharge ?? 0) > 0) {
    const key = breakdown.airportPickupName
      ? "rate.airportPickupSurcharge"
      : "rate.airportPickupSurchargeNoName";
    items.push({
      label: t(key, { airport: breakdown.airportPickupName ?? "" }),
      value: breakdown.airportPickupSurcharge ?? 0,
    });
  }
  if ((breakdown.airportDropoffSurcharge ?? 0) > 0) {
    const key = breakdown.airportDropoffName
      ? "rate.airportDropoffSurcharge"
      : "rate.airportDropoffSurchargeNoName";
    items.push({
      label: t(key, { airport: breakdown.airportDropoffName ?? "" }),
      value: breakdown.airportDropoffSurcharge ?? 0,
    });
  }
  if (breakdown.waitingFee > 0)
    items.push({
      label: t("rate.waiting", { min: breakdown.waitingMin }),
      value: breakdown.waitingFee,
    });
  if ((breakdown.couponDiscount ?? 0) > 0) {
    items.push({
      label: breakdown.couponCode
        ? t("rate.promoApplied", { code: breakdown.couponCode })
        : t("rate.promoApplied", { code: "" }),
      value: -(breakdown.couponDiscount ?? 0),
    });
  }
  return items;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { paddingHorizontal: 24, alignItems: "center", paddingBottom: 16 },
  amountBox: {
    width: "100%",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    marginBottom: 32,
  },
  amountCheckIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  amountLabel: { fontSize: 11, letterSpacing: 1.2 },
  amountValue: { fontSize: 36, marginTop: 6 },
  amountMethod: { fontSize: 13, marginTop: 4 },
  breakdownBox: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 24,
  },
  breakdownTitle: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  breakdownLabel: { fontSize: 14, flex: 1, marginEnd: 12 },
  breakdownValue: { fontSize: 14 },
  breakdownDivider: { height: 1, marginVertical: 8 },
  breakdownTotalLabel: { fontSize: 15 },
  breakdownTotalValue: { fontSize: 15 },
  breakdownNote: { fontSize: 11, marginTop: 6 },
  driverWrap: { alignItems: "center", marginBottom: 32, gap: 8 },
  driverName: { fontSize: 18, marginTop: 6 },
  driverVehicle: { fontSize: 13 },
  question: { fontSize: 18, marginBottom: 18 },
  starsRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  starBtn: {},
  commentInput: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 96,
  },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
});
