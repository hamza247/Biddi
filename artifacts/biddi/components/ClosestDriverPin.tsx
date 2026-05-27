import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useFontFamily } from "@/hooks/useFontFamily";

export type ClosestDriverPinStatus = "loading" | "ready" | "empty" | "unavailable";

interface Props {
  status: ClosestDriverPinStatus;
  etaMinutes?: number;
}

const CIRCLE_SIZE = 58;
const BRAND_PURPLE = "#3819A6";
const DEBOUNCE_MS = 300;
const FADE_DURATION = 220;

interface DisplayState {
  status: ClosestDriverPinStatus;
  etaMinutes?: number;
}

function sameState(a: DisplayState, b: DisplayState): boolean {
  return a.status === b.status && a.etaMinutes === b.etaMinutes;
}

function LoadingDots() {
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;
  const d3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const make = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 380,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0.3,
            duration: 380,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
    const a = make(d1, 0);
    const b = make(d2, 140);
    const c = make(d3, 280);
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [d1, d2, d3]);

  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.dot, { opacity: d1 }]} />
      <Animated.View style={[styles.dot, { opacity: d2 }]} />
      <Animated.View style={[styles.dot, { opacity: d3 }]} />
    </View>
  );
}

export function ClosestDriverPin({ status, etaMinutes }: Props) {
  const fonts = useFontFamily();
  const [displayed, setDisplayed] = useState<DisplayState>({ status, etaMinutes });
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const next: DisplayState = { status, etaMinutes };

    debounceRef.current = setTimeout(() => {
      setDisplayed((prev) => {
        if (sameState(prev, next)) return prev;

        if (animRef.current) animRef.current.stop();
        fadeAnim.setValue(0);
        animRef.current = Animated.timing(fadeAnim, {
          toValue: 1,
          duration: FADE_DURATION,
          useNativeDriver: true,
        });
        animRef.current.start();

        return next;
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (animRef.current) animRef.current.stop();
    };
  }, [status, etaMinutes, fadeAnim]);

  const renderInner = () => {
    if (displayed.status === "loading") {
      return (
        <>
          <LoadingDots />
          <Text
            style={[styles.statusLabel, { fontFamily: fonts.medium, color: BRAND_PURPLE, opacity: 0.7 }]}
            numberOfLines={1}
          >
            Finding…
          </Text>
        </>
      );
    }
    if (displayed.status === "ready" && typeof displayed.etaMinutes === "number") {
      return (
        <>
          <Text style={[styles.minuteNumber, { fontFamily: fonts.bold }]}>
            {displayed.etaMinutes}
          </Text>
          <Text style={[styles.minuteLabel, { fontFamily: fonts.semiBold }]}>min</Text>
        </>
      );
    }
    if (displayed.status === "unavailable") {
      return (
        <>
          <Text style={[styles.dashText, { fontFamily: fonts.bold }]}>—</Text>
          <Text style={[styles.statusLabel, { fontFamily: fonts.medium }]} numberOfLines={1}>
            ETA unavailable
          </Text>
        </>
      );
    }
    return (
      <>
        <Text style={[styles.dashText, { fontFamily: fonts.bold }]}>—</Text>
        <Text style={[styles.statusLabel, { fontFamily: fonts.medium }]} numberOfLines={1}>
          No drivers
        </Text>
      </>
    );
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.circle}>
        <Animated.View style={{ alignItems: "center", opacity: fadeAnim }}>
          {renderInner()}
        </Animated.View>
      </View>
      <View style={styles.tail} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: BRAND_PURPLE,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: "hidden",
  },
  minuteNumber: {
    fontSize: 21,
    color: BRAND_PURPLE,
    lineHeight: 24,
    letterSpacing: -0.5,
  },
  minuteLabel: {
    fontSize: 9,
    color: BRAND_PURPLE,
    opacity: 0.75,
    lineHeight: 11,
    letterSpacing: 0.2,
  },
  dashText: {
    fontSize: 19,
    color: "#aaa",
    lineHeight: 23,
  },
  statusLabel: {
    fontSize: 8,
    color: "#bbb",
    lineHeight: 10,
    letterSpacing: 0.1,
    maxWidth: CIRCLE_SIZE - 10,
    textAlign: "center",
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 14,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: BRAND_PURPLE,
    marginHorizontal: 1.5,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: BRAND_PURPLE,
    marginTop: -2,
  },
});
