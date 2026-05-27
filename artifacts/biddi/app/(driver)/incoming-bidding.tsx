import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api } from "@/lib/api";

type Mode = "preview" | "counter" | "waiting";

export default function IncomingBiddingScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { driverIncoming } = useApp();
  const params = useLocalSearchParams<{ rideId?: string }>();

  const request = useMemo(() => {
    const id = params.rideId;
    if (id) {
      const match = driverIncoming.find((r) => r.id === id);
      if (match) return match;
    }
    return driverIncoming[0] ?? null;
  }, [driverIncoming, params.rideId]);

  const [mode, setMode] = useState<Mode>("preview");
  const [counterAmount, setCounterAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Grace flag: on first mount driverIncoming may still be empty because the
  // /driver/requests refetch triggered by the bidding:request socket event
  // hasn't completed yet. Without this, the auto-dismiss useEffect would
  // bounce the modal right back the moment it opens.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 2500);
    return () => clearTimeout(t);
  }, []);

  // Close the modal when the request is no longer in the driver's queue —
  // either accepted, rejected, expired, or rider cancelled. Wait until the
  // hydration grace period has elapsed so we don't dismiss the modal during
  // the brief window where driverIncoming hasn't hydrated yet.
  useEffect(() => {
    if (!hydrated) return;
    if (!request && mode !== "waiting") {
      router.back();
    }
  }, [hydrated, request, mode, router]);

  if (!request) {
    // Pre-hydration placeholder so users see a spinner instead of a blank
    // screen during the 0–2.5s window before the request arrives.
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: c.background,
            paddingTop: insets.top + 12,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const riderPrice = request.initialFare ?? request.suggestedFare;

  async function submitBid(amount: number) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api("/bidding/offers", {
        method: "POST",
        json: {
          rideId: request!.id,
          amount,
          etaMin: Math.max(2, Math.round(request!.distanceKm * 2 + 2)),
        },
      });
      setMode("waiting");
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Could not submit your offer.";
      Alert.alert("Couldn't submit offer", msg);
    } finally {
      setSubmitting(false);
    }
  }

  const acceptRiderPrice = () => submitBid(Number(riderPrice.toFixed(2)));
  const submitCounter = () => {
    const n = Number(counterAmount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert("Invalid amount", "Enter a number greater than zero.");
      return;
    }
    submitBid(n);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={20} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          New bidding request
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.priceCard, { backgroundColor: c.primarySoft }]}>
          <Text style={[styles.priceLabel, { color: c.primary, fontFamily: fonts.semiBold }]}>
            Rider's offer
          </Text>
          <Text style={[styles.priceValue, { color: c.primary, fontFamily: fonts.bold }]}>
            ${riderPrice.toFixed(2)}
          </Text>
          <Text style={[styles.priceMeta, { color: c.primary, fontFamily: fonts.regular }]}>
            {request.distanceKm.toFixed(1)} km · ~{request.durationMin} min
          </Text>
        </View>

        <View style={[styles.tripCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Row icon="map-pin" label="Pickup" value={request.pickup.label ?? request.pickup.address} c={c} fonts={fonts} />
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Row icon="flag" label="Drop-off" value={request.dropoff.label ?? request.dropoff.address} c={c} fonts={fonts} />
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Row icon="user" label="Rider" value={request.riderName} c={c} fonts={fonts} />
        </View>

        {mode === "preview" && (
          <View style={styles.actions}>
            <Button
              label={submitting ? "Sending…" : `Accept $${riderPrice.toFixed(2)}`}
              onPress={acceptRiderPrice}
              loading={submitting}
              disabled={submitting}
            />
            <Button
              label="Counter-offer"
              variant="secondary"
              onPress={() => setMode("counter")}
              disabled={submitting}
            />
            <Pressable onPress={() => router.back()} disabled={submitting}>
              <Text
                style={[
                  styles.skipText,
                  { color: c.mutedForeground, fontFamily: fonts.regular },
                ]}
              >
                Skip
              </Text>
            </Pressable>
          </View>
        )}

        {mode === "counter" && (
          <View style={styles.actions}>
            <View style={[styles.inputWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.inputPrefix, { color: c.foreground, fontFamily: fonts.semiBold }]}>$</Text>
              <TextInput
                value={counterAmount}
                onChangeText={setCounterAmount}
                placeholder={riderPrice.toFixed(2)}
                placeholderTextColor={c.mutedForeground}
                keyboardType="decimal-pad"
                autoFocus
                style={[styles.input, { color: c.foreground, fontFamily: fonts.bold }]}
                editable={!submitting}
              />
            </View>
            <Button
              label={submitting ? "Sending…" : "Send counter-offer"}
              onPress={submitCounter}
              loading={submitting}
              disabled={submitting || counterAmount.trim().length === 0}
            />
            <Button
              label="Back"
              variant="secondary"
              onPress={() => setMode("preview")}
              disabled={submitting}
            />
          </View>
        )}

        {mode === "waiting" && (
          <View style={styles.waitingWrap}>
            <ActivityIndicator color={c.primary} />
            <Text style={[styles.waitingText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
              Offer sent — waiting on rider
            </Text>
            <Text style={[styles.waitingMeta, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              You'll be notified if the rider accepts. Bids expire in ~90s.
            </Text>
            <Button label="Close" variant="secondary" onPress={() => router.back()} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  c,
  fonts,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: c.muted }]}>
        <Feather name={icon} size={14} color={c.foreground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: c.mutedForeground, fontFamily: fonts.regular }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  scroll: { gap: 16, paddingBottom: 32 },
  priceCard: { padding: 20, borderRadius: 20, alignItems: "center", gap: 4 },
  priceLabel: { fontSize: 13, letterSpacing: 0.5, textTransform: "uppercase" },
  priceValue: { fontSize: 40 },
  priceMeta: { fontSize: 13 },
  tripCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" },
  rowValue: { fontSize: 15, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 44 },
  actions: { gap: 10 },
  skipText: { textAlign: "center", fontSize: 14, paddingVertical: 12 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    height: 64,
  },
  inputPrefix: { fontSize: 22, marginRight: 8 },
  input: { flex: 1, fontSize: 28 },
  waitingWrap: { alignItems: "center", gap: 12, paddingVertical: 24 },
  waitingText: { fontSize: 16 },
  waitingMeta: { fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
});
