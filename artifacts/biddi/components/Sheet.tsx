import React from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

/** A non-interactive bottom sheet container with consistent padding + safe area. */
export function Sheet({ children, style }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "web" ? 34 : 16) + 16;

  return (
    <View
      style={[
        styles.sheet,
        {
          backgroundColor: c.background,
          paddingBottom: bottomPad,
          shadowColor: "#000",
        },
        style,
      ]}
    >
      <View style={[styles.handle, { backgroundColor: c.border }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
});
