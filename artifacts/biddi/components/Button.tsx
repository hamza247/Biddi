import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  fullWidth = true,
  style,
  icon,
  testID,
}: Props) {
  const c = useColors();
  const fonts = useFontFamily();

  const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.primaryForeground },
    secondary: { bg: c.surface, fg: c.foreground, border: c.border },
    ghost: { bg: "transparent", fg: c.primary },
    destructive: { bg: c.destructive, fg: c.destructiveForeground },
  };
  const p = palette[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (isDisabled) return;
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPress();
      }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: p.bg,
          borderColor: p.border ?? "transparent",
          borderWidth: p.border ? StyleSheet.hairlineWidth : 0,
          opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1,
          width: fullWidth ? "100%" : undefined,
          transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.label, { color: p.fg, fontFamily: fonts.semiBold }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: {
    fontSize: 16,
    letterSpacing: 0.1,
  },
});
