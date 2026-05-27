import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface Props {
  pickup?: boolean;
  dropoff?: boolean;
  /** Animate a moving dot along the route (cosmetic). */
  animated?: boolean;
}

/**
 * Stylized map look-and-feel without external map APIs.
 * Subtle grid + abstract roads + pickup/dropoff pins.
 */
export function MapBackdrop({ pickup, dropoff }: Props) {
  const c = useColors();
  return (
    <View style={[styles.container, { backgroundColor: c.map }]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
        {/* Grid blocks */}
        {Array.from({ length: 12 }).map((_, i) => (
          <Line
            key={`h${i}`}
            x1={0}
            y1={i * 50}
            x2={400}
            y2={i * 50}
            stroke={c.mapStroke}
            strokeWidth={1}
            opacity={0.6}
          />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <Line
            key={`v${i}`}
            x1={i * 50}
            y1={0}
            x2={i * 50}
            y2={600}
            stroke={c.mapStroke}
            strokeWidth={1}
            opacity={0.6}
          />
        ))}
        {/* Major roads */}
        <Path d="M0 200 L400 240" stroke="#FFFFFF" strokeWidth={10} strokeLinecap="round" opacity={0.95} />
        <Path d="M40 0 L80 600" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" opacity={0.95} />
        <Path d="M260 -10 L320 600" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" opacity={0.95} />
        <Path d="M0 430 L400 460" stroke="#FFFFFF" strokeWidth={8} strokeLinecap="round" opacity={0.9} />
        {/* Park */}
        <Path
          d="M120 280 L240 290 L235 400 L115 395 Z"
          fill="#CFE7C8"
          opacity={0.85}
        />
        {/* Route line */}
        {pickup && dropoff && (
          <Path
            d="M90 460 C 150 430, 200 360, 230 300 S 330 220, 320 160"
            stroke={c.primary}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {/* Pickup pin */}
        {pickup && (
          <>
            <Circle cx={90} cy={460} r={14} fill="#FFFFFF" />
            <Circle cx={90} cy={460} r={9} fill={c.accent} />
          </>
        )}
        {/* Dropoff pin */}
        {dropoff && (
          <>
            <Circle cx={320} cy={160} r={14} fill="#FFFFFF" />
            <Circle cx={320} cy={160} r={9} fill={c.primary} />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
});
