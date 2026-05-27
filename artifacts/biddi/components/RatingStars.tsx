import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface RatingStarsProps {
  score: number;
  onSelect: (n: number) => void;
  size?: number;
  readonly?: boolean;
}

export function RatingStars({ score, onSelect, size = 42, readonly = false }: RatingStarsProps) {
  const c = useColors();
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) =>
        readonly ? (
          <View key={n} style={styles.starBtn}>
            <Feather name="star" size={size} color={n <= score ? c.accent : c.border} />
          </View>
        ) : (
          <Pressable key={n} onPress={() => onSelect(n)} style={styles.starBtn} hitSlop={8}>
            <Feather name="star" size={size} color={n <= score ? c.accent : c.border} />
          </Pressable>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  starBtn: {},
});
