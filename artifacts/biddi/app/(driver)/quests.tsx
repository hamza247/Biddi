import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig, type PublicConfig } from "@/lib/config";
import { formatUsdAmount } from "@/lib/formatCurrency";

export interface DriverPromotionView {
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
}

export default function QuestsScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const cfg = useConfig();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<DriverPromotionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ promotions: DriverPromotionView[] }>(
        "/driver/promotions",
      );
      setItems(res.promotions);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
          Quests & Bonuses
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="award" size={42} color={c.mutedForeground} />
          <Text
            style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}
          >
            No active promotions right now. Check back soon!
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: "/(driver)/quest-detail", params: { id: item.id } })
              }
            >
              <QuestCard item={item} cfg={cfg} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function QuestCard({ item, cfg }: { item: DriverPromotionView; cfg: PublicConfig }) {
  const c = useColors();
  const fonts = useFontFamily();
  const pct = Math.min(
    1,
    item.requiredTrips > 0 ? item.completedTrips / item.requiredTrips : 0,
  );
  const done = item.rewardCredited;
  const cycleEnd = item.cycleEnd ? new Date(item.cycleEnd) : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: done ? c.primary : c.border,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.bonusPill, { backgroundColor: c.primary }]}>
          <Text style={[styles.bonusText, { fontFamily: fonts.bold }]}>
            {formatUsdAmount(item.bonusAmount, cfg)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.cardTitle, { color: c.foreground, fontFamily: fonts.bold }]}
          >
            {item.title}
          </Text>
          {item.description ? (
            <Text
              style={[styles.cardSub, { color: c.mutedForeground, fontFamily: fonts.medium }]}
              numberOfLines={3}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.progressBar, { backgroundColor: c.border }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: c.primary,
              width: `${pct * 100}%`,
            },
          ]}
        />
      </View>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          {item.completedTrips} / {item.requiredTrips} trips
        </Text>
        {done ? (
          <Text style={[styles.meta, { color: c.primary, fontFamily: fonts.bold }]}>
            ✓ Earned
          </Text>
        ) : item.remaining === 0 ? (
          <Text style={[styles.meta, { color: c.primary, fontFamily: fonts.bold }]}>
            Crediting…
          </Text>
        ) : (
          <Text style={[styles.meta, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {item.remaining} to go
          </Text>
        )}
      </View>
      {cycleEnd ? (
        <Text style={[styles.endsAt, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
          Ends {cycleEnd.toLocaleString()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backBtn: { padding: 8 },
  title: { fontSize: 20 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  empty: { textAlign: "center", fontSize: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  bonusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minWidth: 64,
    alignItems: "center",
  },
  bonusText: { color: "#fff", fontSize: 14 },
  cardTitle: { fontSize: 16 },
  cardSub: { fontSize: 12, marginTop: 4 },
  progressBar: { height: 8, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999 },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  meta: { fontSize: 13 },
  endsAt: { fontSize: 11 },
});
