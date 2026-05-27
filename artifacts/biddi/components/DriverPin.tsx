import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";

const CAR_TOP_IMAGE = require("../assets/images/BiddiDriveTop.png");

interface Props {
  vehicleCategory?: "car" | "moto";
  /** When false, suppresses the radar pulse animation (used to keep faded /
   *  far-away driver markers visually quiet on a busy map). */
  showPulse?: boolean;
}

export function DriverPin({ vehicleCategory = "car", showPulse = true }: Props) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (!showPulse) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 2.4,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1400,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.45,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseScale, pulseOpacity, showPulse]);

  if (vehicleCategory === "moto") {
    return (
      <View style={styles.motoWrapper}>
        {showPulse && (
          <Animated.View
            style={[
              styles.pulseRing,
              {
                transform: [{ scale: pulseScale }],
                opacity: pulseOpacity,
              },
            ]}
          />
        )}
        <View style={styles.bubble}>
          <MaterialCommunityIcons name="motorbike" size={20} color="#3819A6" />
        </View>
        <View style={styles.tail} />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {showPulse && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
      )}
      <Image source={CAR_TOP_IMAGE} style={styles.carImage} resizeMode="contain" />
    </View>
  );
}

const BUBBLE_SIZE = 40;
const RING_SIZE = 18;
const CAR_WIDTH = 52;
const CAR_HEIGHT = 70;

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
  },
  motoWrapper: {
    alignItems: "center",
    width: BUBBLE_SIZE + 8,
  },
  pulseRing: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    backgroundColor: "#3819A6",
    zIndex: 0,
  },
  carImage: {
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
    zIndex: 1,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
    zIndex: 1,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#fff",
    zIndex: 1,
    marginTop: -1,
  },
});
