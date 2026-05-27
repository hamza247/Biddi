import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
} from "react-native";

import { useBounceOffset } from "@/hooks/useBounceOffset";
import { useFontFamily } from "@/hooks/useFontFamily";

interface Props {
  visible: boolean;
}

export function DriverLoadingBadge({ visible }: Props) {
  const fonts = useFontFamily();
  const bounceOffset = useBounceOffset();

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-bounceOffset)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);
  const [mounted, setMounted] = useState(false);

  const startPulse = () => {
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.045,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    pulseRef.current.start();
  };

  const stopPulse = () => {
    if (pulseRef.current) {
      pulseRef.current.stop();
      pulseRef.current = null;
    }
    scale.setValue(1);
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.setValue(-bounceOffset);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 10,
          mass: 0.6,
          stiffness: 120,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          startPulse();
        }
      });
    } else {
      stopPulse();
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }

    return () => {
      stopPulse();
    };
  }, [visible, opacity, translateY, bounceOffset]);

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        styles.badge,
        { opacity, transform: [{ translateY }, { scale }] },
      ]}
    >
      <ActivityIndicator size="small" color="#fff" style={{ marginEnd: 6 }} />
      <Text style={[styles.text, { fontFamily: fonts.semiBold }]}>Finding drivers…</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  text: {
    fontSize: 13,
    color: "#fff",
  },
});
