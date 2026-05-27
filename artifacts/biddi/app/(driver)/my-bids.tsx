import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api } from "@/lib/api";

interface MyOffer {
  id: string;
  rideId: string;
  amount: number;
  etaMin: number;
  note: string | null;
  status: "active" | "accepted" | "rejected" | "cancelled" | "expired";
  expiresAt: string | null;
  createdAt: string;
  ride: {
    id: string;
    status: string;
    pickupLabel: string;
    dropoffLabel: string;
    initialFare: number | null;
    biddingExpiresAt: string | null;
    estimatedDistanceKm: number;
    estimatedDurationMin: number;
  } | null;
}

export default function MyBidsScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ offers: MyOffer[] }>("/bidding/offers/mine?status=active");
      setOffers(r.offers);
    } catch {
      /* keep last good list */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const withdraw = async (bidId: string) => {
    if (withdrawing) return;
    setWithdrawing(bidId);
    try {
      await api(`/bidding/offers/${bidId}/withdraw`, { method: "POST" });
      setOffers((prev) => prev.filter((o) => o.id !== bidId));
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Could not withdraw.";
      Alert.alert("Withdraw failed", msg);
    } finally {
      setWithdrawing(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          My active offers
        </Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={c.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="inbox" size={32} color={c.mutedForeground} />
              <Text style={[styles.emptyText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                No active offers
              </Text>
              <Text style={[styles.emptyMeta, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
                Offers you place on bidding rides show up here until the rider accepts, you withdraw, or they expire.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const exp = item.expiresAt ? new Date(item.expiresAt) : null;
            const remaining = exp ? Math.max(0, Math.round((exp.getTime() - Date.now()) / 1000)) : null;
            return (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.amount, { color: c.foreground, fontFamily: fonts.bold }]}>
                      ${item.amount.toFixed(2)}
                    </Text>
                    {item.ride?.initialFare != null && (
                      <Text style={[styles.askingMeta, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
                        rider asked ${item.ride.initialFare.toFixed(2)}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.etaLabel, { color: c.mutedForeground, fontFamily: fonts.regular }]}>ETA</Text>
                    <Text style={[styles.etaValue, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                      {item.etaMin} min
                    </Text>
                  </View>
                </View>
                {item.ride && (
                  <View style={styles.routeRow}>
                    <Feather name="map-pin" size={12} color={c.mutedForeground} />
                    <Text style={[styles.routeText, { color: c.foreground, fontFamily: fonts.regular }]} numberOfLines={1}>
                      {item.ride.pickupLabel}
                    </Text>
                  </View>
                )}
                {item.ride && (
                  <View style={styles.routeRow}>
                    <Feather name="flag" size={12} color={c.mutedForeground} />
                    <Text style={[styles.routeText, { color: c.foreground, fontFamily: fonts.regular }]} numberOfLines={1}>
                      {item.ride.dropoffLabel}
                    </Text>
                  </View>
                )}
                {item.note && (
                  <Text style={[styles.note, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={2}>
                    "{item.note}"
                  </Text>
                )}
                <View style={styles.cardFooter}>
                  <Text style={[styles.expiresIn, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
                    {remaining != null && remaining > 0
                      ? `expires in ${remaining}s`
                      : "expired"}
                  </Text>
                  <Pressable
                    onPress={() => withdraw(item.id)}
                    disabled={withdrawing === item.id}
                    style={({ pressed }) => [
                      styles.withdrawBtn,
                      {
                        backgroundColor: c.muted,
                        opacity: withdrawing === item.id ? 0.6 : pressed ? 0.9 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.withdrawLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                      {withdrawing === item.id ? "…" : "Withdraw"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { alignItems: "center", paddingTop: 80, gap: 12, paddingHorizontal: 32 },
  emptyText: { fontSize: 16 },
  emptyMeta: { fontSize: 13, textAlign: "center" },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  amount: { fontSize: 24 },
  askingMeta: { fontSize: 12, marginTop: 2 },
  etaLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  etaValue: { fontSize: 15, marginTop: 2 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { flex: 1, fontSize: 13 },
  note: { fontStyle: "italic", fontSize: 13 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  expiresIn: { fontSize: 12 },
  withdrawBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  withdrawLabel: { fontSize: 13 },
});
