import React from "react";
import { Text, TextStyle } from "react-native";

import { useFontFamily } from "@/hooks/useFontFamily";

interface Props {
  style?: TextStyle;
}

/**
 * Renders the pickup→dropoff separator arrow, flipped to ← in RTL locales.
 * Use this wherever a route's direction arrow is displayed so the symbol
 * stays correct for every language without duplicating the isRTL check.
 */
export function RouteArrow({ style }: Props) {
  const { isRTL } = useFontFamily();
  return <Text style={style}>{isRTL ? "←" : "→"}</Text>;
}
