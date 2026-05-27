import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig } from "@/lib/config";
import { formatUsdAmount } from "@/lib/formatCurrency";

interface QuestDetail {
  id: string;
  title: string;
  description: string | null;
  bonusAmount: number;
  requiredTrips: number;
  startAt: string;
  endAt: string;
  repeatType: "none" | "daily" | "weekly";
  cycleStart: string | null;
  cycleEnd: string | null;
  completedTrips: number;
  remaining: number;
  rewardCredited: boolean;
  state: "in_progress" | "earned" | "expired" | "scheduled";
  serviceAreaId: string | null;
  serviceAreaName: string | null;
  serviceAreaPolygonJson: string | null;
  vehicleTypeId: string | null;
}

export default function QuestDetailScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const cfg = useConfig();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id ?? "");
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api<{ promotion: QuestDetail }>(`/driver/promotions/${id}`);
      setQuest(res.promotion);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const stateLabel: Record<QuestDetail["state"], string> = {
    in_progress: "In progress",
    earned: "Earned",
    expired: "Expired",
    scheduled: "Scheduled",
  };
  const stateColor = (s: QuestDetail["state"]): string => {
    if (s === "earned") return c.primary;
    if (s === "expired") return c.mutedForeground;
    if (s === "scheduled") return c.mutedForeground;
    return c.foreground;
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
          Quest details
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : notFound || !quest ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={42} color={c.mutedForeground} />
          <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            This quest is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
          <View style={[styles.heroCard, { backgroundColor: c.surface, borderColor: c.primary }]}>
            <View style={[styles.bonusPill, { backgroundColor: c.primary }]}>
              <Text style={[styles.bonusText, { fontFamily: fonts.bold }]}>
                {formatUsdAmount(quest.bonusAmount, cfg)}
              </Text>
            </View>
            <Text style={[styles.heroTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {quest.title}
            </Text>
            {quest.description ? (
              <Text style={[styles.heroSub, { color: c.mutedForeground, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(13) }]}>
                {quest.description}
              </Text>
            ) : null}
            <View style={[styles.badge, { borderColor: stateColor(quest.state) }]}>
              <Text style={[styles.badgeText, { color: stateColor(quest.state), fontFamily: fonts.semiBold }]}>
                {stateLabel[quest.state]}
              </Text>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.cardLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
              Progress
            </Text>
            <View style={[styles.progressBar, { backgroundColor: c.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: c.primary,
                    width: `${
                      Math.min(
                        1,
                        quest.requiredTrips > 0 ? quest.completedTrips / quest.requiredTrips : 0,
                      ) * 100
                    }%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.metaLine, { color: c.foreground, fontFamily: fonts.bold }]}>
              {quest.completedTrips} / {quest.requiredTrips} trips ·{" "}
              {quest.rewardCredited ? "Earned" : `${quest.remaining} to go`}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Row label="Cycle window" value={formatRange(quest.cycleStart, quest.cycleEnd)} c={c} fonts={fonts} />
            <Row
              label="Repeats"
              value={quest.repeatType === "none" ? "One-time" : quest.repeatType}
              c={c}
              fonts={fonts}
            />
            <Row
              label="Service area"
              value={quest.serviceAreaName ?? (quest.serviceAreaId ? "Restricted zone" : "Anywhere")}
              c={c}
              fonts={fonts}
            />
            <Row
              label="Vehicle type"
              value={quest.vehicleTypeId ? "Specific type required" : "Any vehicle"}
              c={c}
              fonts={fonts}
            />
            <Row
              label="Promotion runs"
              value={`${new Date(quest.startAt).toLocaleString()} → ${new Date(quest.endAt).toLocaleString()}`}
              c={c}
              fonts={fonts}
            />
          </View>

          {quest.serviceAreaPolygonJson ? (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.cardLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                Eligible zone
              </Text>
              <Text style={[styles.metaLine, { color: c.foreground, fontFamily: fonts.medium }]}>
                Trips picked up inside "{quest.serviceAreaName ?? "the promotion zone"}" count toward this quest.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  c,
  fonts,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
        {label}
      </Text>
      <Text
        style={[styles.rowValue, { color: c.foreground, fontFamily: fonts.semiBold }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function formatRange(start: string | null, end: string | null): string {
  if (!start || !end) return "Not currently active";
  return `${new Date(start).toLocaleString()} → ${new Date(end).toLocaleString()}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { padding: 8 },
  title: { fontSize: 20 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  empty: { textAlign: "center", fontSize: 14 },
  heroCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  bonusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  bonusText: { color: "#fff", fontSize: 16 },
  heroTitle: { fontSize: 20 },
  heroSub: { fontSize: 13, lineHeight: 18 },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  cardLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  progressBar: { height: 10, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999 },
  metaLine: { fontSize: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  rowLabel: { fontSize: 12, flex: 1 },
  rowValue: { fontSize: 12, flex: 1.4, textAlign: "right" },
});
