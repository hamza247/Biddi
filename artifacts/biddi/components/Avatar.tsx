import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { getBaseUrl } from "@/lib/api";

function resolvePhotoUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = getBaseUrl().replace(/\/api$/, "");
  return `${base}${url}`;
}

export function Avatar({
  initial,
  size = 44,
  photoUrl,
}: {
  initial: string;
  size?: number;
  photoUrl?: string | null;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const resolvedUrl = photoUrl ? resolvePhotoUrl(photoUrl) : null;
  const showImage = !!resolvedUrl && !imgError;

  if (showImage) {
    return (
      <Image
        source={{ uri: resolvedUrl! }}
        style={[
          styles.wrap,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.primarySoft,
        },
      ]}
    >
      <Text style={[styles.text, { color: c.primary, fontSize: size * 0.42, fontFamily: fonts.bold }]}>
        {initial.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  text: {},
});
