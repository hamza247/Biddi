import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { RatingStars } from "@/components/RatingStars";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api } from "@/lib/api";

export default function DriverRateScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fonts = useFontFamily();

  const { rideId, riderName } = useLocalSearchParams<{ rideId: string; riderName: string }>();

  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = riderName ?? t("driverRate.defaultRiderName", { defaultValue: "Rider" });

  const handleSubmit = async () => {
    if (!rideId || loading) return;
    setLoading(true);
    setError(null);
    try {
      await api(`/rides/${rideId}/rate-customer`, {
        method: "POST",
        json: { rating: score, comment: comment.trim() || undefined },
      });
      router.replace("/(driver)/home");
    } catch {
      setError(t("driverRate.submitError", { defaultValue: "Could not submit rating. Please try again." }));
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    router.replace("/(driver)/home");
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 16 }}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.riderWrap}>
          <Avatar initial={displayName.charAt(0) || "?"} size={72} />
          <Text style={[styles.riderName, { color: c.foreground, fontFamily: fonts.bold }]}>
            {displayName}
          </Text>
          <Text style={[styles.riderSubtitle, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {t("driverRate.tripCompleted", { defaultValue: "Trip completed" })}
          </Text>
        </View>

        <Text style={[styles.question, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          {t("driverRate.howWasRider", { defaultValue: "How was your rider?" })}
        </Text>

        <RatingStars score={score} onSelect={setScore} />

        <TextInput
          style={[
            styles.commentInput,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              color: c.foreground,
              fontFamily: fonts.medium,
            },
          ]}
          placeholder={t("rate.leaveComment", { defaultValue: "Leave a comment (optional)" })}
          placeholderTextColor={c.mutedForeground}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
          textAlignVertical="top"
        />

        {error != null && (
          <Text style={[styles.errorText, { color: c.destructive, fontFamily: fonts.medium }]}>
            {error}
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={loading ? "" : t("common.submit")}
          onPress={handleSubmit}
          disabled={loading}
          icon={loading ? <ActivityIndicator color="#fff" /> : undefined}
        />
        <Pressable onPress={handleSkip} style={styles.skipBtn} hitSlop={8}>
          <Text style={[styles.skipText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {t("common.skip", { defaultValue: "Skip" })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { paddingHorizontal: 24, alignItems: "center", paddingBottom: 16, paddingTop: 32 },
  riderWrap: { alignItems: "center", marginBottom: 40, gap: 8 },
  riderName: { fontSize: 20, marginTop: 8 },
  riderSubtitle: { fontSize: 13 },
  question: { fontSize: 18, marginBottom: 20, textAlign: "center" },
  commentInput: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 96,
    marginTop: 24,
  },
  errorText: { marginTop: 12, fontSize: 14, textAlign: "center" },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 8 },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipText: { fontSize: 15 },
});
