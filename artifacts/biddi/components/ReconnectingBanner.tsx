import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useReconnect } from "@/context/AppContext";

export function ReconnectingBanner() {
  const { isReconnecting, attempt, maxAttempts, socketConnected } = useReconnect();
  const { t } = useTranslation();
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  const connectedTranslateY = useRef(new Animated.Value(-60)).current;
  const connectedOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isReconnecting) {
      setVisible(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setVisible(false);
      });
    }
  }, [isReconnecting, opacity]);

  useEffect(() => {
    if (socketConnected) {
      Animated.parallel([
        Animated.spring(connectedTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
        }),
        Animated.timing(connectedOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(connectedTranslateY, {
          toValue: -60,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(connectedOpacity, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [socketConnected, connectedTranslateY, connectedOpacity]);

  const insets = useSafeAreaInsets();

  const label =
    attempt > 0
      ? `${t("common.reconnecting")} (${attempt}/${maxAttempts})`
      : t("common.reconnecting");

  return (
    <>
      {visible && (
        <Animated.View
          style={[styles.container, { top: insets.top + 8, opacity }]}
          pointerEvents="none"
        >
          <View style={styles.pill}>
            <SpinnerDots />
            <Text style={styles.label}>{label}</Text>
          </View>
        </Animated.View>
      )}

      <Animated.View
        style={[
          styles.container,
          {
            top: insets.top + 8,
            opacity: connectedOpacity,
            transform: [{ translateY: connectedTranslateY }],
          },
        ]}
        pointerEvents="none"
      >
        <View style={styles.connectedPill}>
          <View style={styles.connectedDot} />
          <Text style={styles.label}>{t("common.connected")}</Text>
        </View>
      </Animated.View>
    </>
  );
}

function SpinnerDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      );

    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 160);
    const a3 = pulse(dot3, 320);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.dots}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: dot }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
    elevation: 20,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30, 30, 30, 0.92)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  connectedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(22, 101, 52, 0.92)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  dots: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4ADE80",
  },
  label: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.1,
  },
});
