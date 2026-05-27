import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useFontFamily } from "@/hooks/useFontFamily";

interface CountdownBarProps {
  progress: number;
  secondsLeft: number;
}

function interpolateColor(progress: number): string {
  const GREEN = { r: 0x22, g: 0xc5, b: 0x5e };
  const AMBER = { r: 0xf5, g: 0x9e, b: 0x0b };
  const RED = { r: 0xef, g: 0x44, b: 0x44 };

  let from: typeof GREEN;
  let to: typeof GREEN;
  let t: number;

  if (progress > 1 / 3) {
    from = AMBER;
    to = GREEN;
    t = (progress - 1 / 3) / (2 / 3);
  } else if (progress > 1 / 6) {
    from = RED;
    to = AMBER;
    t = (progress - 1 / 6) / (1 / 6);
  } else {
    from = RED;
    to = RED;
    t = 1;
  }

  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r},${g},${b})`;
}

export function CountdownBar({ progress, secondsLeft }: CountdownBarProps) {
  const fonts = useFontFamily();
  const fillColor = interpolateColor(progress);
  const clampedProgress = Math.max(0, Math.min(1, progress));

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${clampedProgress * 100}%`,
              backgroundColor: fillColor,
            },
          ]}
        />
      </View>
      <Text style={[styles.label, { color: fillColor, fontFamily: fonts.semiBold }]}>
        {secondsLeft}s
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(0,0,0,0.08)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    minWidth: 28,
    textAlign: "right",
  },
});
