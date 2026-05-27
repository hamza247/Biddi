import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useFontFamily } from "@/hooks/useFontFamily";

export type ClosestDriverEtaBadgeStatus =
  | "loading"
  | "ready"
  | "empty"
  | "unavailable";

interface Props {
  status: ClosestDriverEtaBadgeStatus;
  etaMinutes?: number;
}

const BRAND_PURPLE = "#3819A6";

function PulsingDot() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0.35,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.85,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <Animated.View
      style={[styles.pulseDot, { opacity, transform: [{ scale }] }]}
    />
  );
}

export function ClosestDriverEtaBadge({ status, etaMinutes }: Props) {
  const { t } = useTranslation();
  const fonts = useFontFamily();

  if (status === "empty" || status === "unavailable") return null;
  if (status === "ready" && typeof etaMinutes !== "number") return null;

  return (
    <View style={styles.wrapper} pointerEvents="none">
      <View style={styles.pill}>
        {status === "loading" ? (
          <>
            <PulsingDot />
            <Text
              style={[
                styles.label,
                { fontFamily: fonts.medium, opacity: 0.8 },
              ]}
              numberOfLines={1}
            >
              {t("riderHome.findingDriver")}
            </Text>
          </>
        ) : (
          <>
            <View style={styles.solidDot} />
            <Text
              style={[styles.label, { fontFamily: fonts.semiBold }]}
              numberOfLines={1}
            >
              {t("riderHome.minutesAway", { minutes: etaMinutes })}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    marginBottom: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F1EEFB",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#E1DAF6",
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND_PURPLE,
  },
  solidDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND_PURPLE,
  },
  label: {
    fontSize: 12,
    color: BRAND_PURPLE,
    letterSpacing: 0.1,
  },
});
