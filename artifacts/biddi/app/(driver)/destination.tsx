import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import {
  type DriverSavedPlace,
  getGetDriverDestinationModeQueryKey,
  getListDriverSavedPlacesQueryKey,
  useActivateDriverDestinationMode,
  useDeactivateDriverDestinationMode,
  useDeleteDriverSavedPlace,
  useGetDriverDestinationMode,
  useListDriverSavedPlaces,
  useUpsertDriverSavedPlace,
} from "@workspace/api-client-react";

import { Button } from "@/components/Button";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { ApiError } from "@/lib/api";
import { useCurrentLocation } from "@/lib/location";
import {
  fetchAutocomplete,
  fetchPlaceDetails,
  newSessionToken,
  type AutocompleteResult,
} from "@/lib/maps";

interface PickedPlace {
  address: string;
  label?: string;
  lat: number;
  lng: number;
  googlePlaceId?: string | null;
}

export default function DriverDestinationScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { location } = useCurrentLocation();
  const qc = useQueryClient();

  const stateQ = useGetDriverDestinationMode();
  const placesQ = useListDriverSavedPlaces();
  const activateM = useActivateDriverDestinationMode();
  const deactivateM = useDeactivateDriverDestinationMode();
  const upsertPlaceM = useUpsertDriverSavedPlace();
  const deletePlaceM = useDeleteDriverSavedPlace();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AutocompleteResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);
  const sessionRef = useRef<string>(newSessionToken());
  const [pendingSavePick, setPendingSavePick] = useState<PickedPlace | null>(
    null,
  );

  const state = stateQ.data;
  const places = placesQ.data;
  const featureEnabled = state?.config.enabled ?? true;
  const remaining = state?.filtersRemainingToday ?? 0;
  const max = state?.config.maxPerDay ?? 0;
  const active = state?.active ?? null;
  const disabledUntil =
    state?.disabledUntil && new Date(state.disabledUntil).getTime() > Date.now()
      ? state.disabledUntil
      : null;
  const disabledReason = disabledUntil ? state?.disabledReason ?? null : null;
  const busy =
    activateM.isPending ||
    deactivateM.isPending ||
    upsertPlaceM.isPending ||
    deletePlaceM.isPending;

  const refreshState = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetDriverDestinationModeQueryKey() });
    void qc.invalidateQueries({ queryKey: getListDriverSavedPlacesQueryKey() });
  }, [qc]);

  // Debounced address autocomplete (same pipeline as the rider screens).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const myToken = ++tokenRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetchAutocomplete(
          q,
          location ? { lat: location.lat, lng: location.lng } : undefined,
          sessionRef.current,
        );
        if (myToken !== tokenRef.current) return;
        setResults(r);
      } catch {
        if (myToken !== tokenRef.current) return;
        setResults([]);
      } finally {
        if (myToken === tokenRef.current) setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, location]);

  const activateWith = useCallback(
    (pick: PickedPlace) => {
      activateM.mutate(
        {
          data: {
            address: pick.address,
            label: pick.label,
            lat: pick.lat,
            lng: pick.lng,
            googlePlaceId: pick.googlePlaceId ?? undefined,
          },
        },
        {
          onSuccess: () => {
            setQuery("");
            setResults([]);
            sessionRef.current = newSessionToken();
            refreshState();
            router.back();
          },
          onError: (err: unknown) => {
            const status =
              err instanceof ApiError
                ? err.status
                : (err as { status?: number })?.status;
            if (status === 429) {
              Alert.alert(
                t("driverDestination.capTitle", { defaultValue: "Daily limit reached" }),
                t("driverDestination.capBody", {
                  defaultValue:
                    "You've used all your destination filters for today. Try again tomorrow.",
                }),
              );
            } else if (status === 403) {
              const data = (err as { data?: { disabledUntil?: string; disabledReason?: string } | null })?.data ?? null;
              const until = data?.disabledUntil
                ? new Date(data.disabledUntil).toLocaleString()
                : null;
              const reason = data?.disabledReason;
              const lines = [
                t("driverDestination.disabledByAdminBody", {
                  defaultValue:
                    "An administrator has temporarily disabled destination mode on your account.",
                }),
                until
                  ? t("driverDestination.disabledUntil", {
                      defaultValue: "Available again: {{until}}",
                      until,
                    })
                  : null,
                reason
                  ? t("driverDestination.disabledReason", {
                      defaultValue: "Reason: {{reason}}",
                      reason,
                    })
                  : null,
              ].filter(Boolean) as string[];
              Alert.alert(
                t("driverDestination.disabledByAdminTitle", {
                  defaultValue: "Destination mode disabled",
                }),
                lines.join("\n\n"),
              );
              refreshState();
            } else if (status === 400) {
              Alert.alert(
                t("driverDestination.unavailableTitle", { defaultValue: "Unavailable" }),
                t("driverDestination.unavailableBody", {
                  defaultValue: "Destination mode is currently turned off by support.",
                }),
              );
            } else {
              Alert.alert(
                t("common.error", { defaultValue: "Error" }),
                t("driverDestination.activateFailed", {
                  defaultValue: "Couldn't turn on destination mode. Please try again.",
                }),
              );
            }
          },
        },
      );
    },
    [activateM, refreshState, router, t],
  );

  const onPickAutocomplete = useCallback(
    async (r: AutocompleteResult) => {
      const details = await fetchPlaceDetails(r.placeId, sessionRef.current);
      if (!details) {
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          t("driverDestination.lookupFailed", {
            defaultValue: "Couldn't load that address.",
          }),
        );
        return;
      }
      setPendingSavePick({
        address: details.address,
        label: r.primary,
        lat: details.lat,
        lng: details.lng,
        googlePlaceId: details.placeId,
      });
    },
    [t],
  );

  const deactivate = useCallback(() => {
    deactivateM.mutate(undefined, { onSuccess: refreshState });
  }, [deactivateM, refreshState]);

  // Toggle handler for the explicit ON/OFF switch at the top of the screen.
  const onToggle = useCallback(
    (next: boolean) => {
      if (!next && active) {
        deactivate();
        return;
      }
      if (next && !active) {
        Alert.alert(
          t("driverDestination.pickFirstTitle", { defaultValue: "Pick a destination" }),
          t("driverDestination.pickFirstBody", {
            defaultValue: "Search for an address below to turn destination mode on.",
          }),
        );
      }
    },
    [active, deactivate, t],
  );

  const saveAs = useCallback(
    (kind: "home" | "work") => {
      const target = pendingSavePick ?? (active
        ? {
            address: active.address,
            label: active.label,
            lat: active.lat,
            lng: active.lng,
          }
        : null);
      if (!target) return;
      upsertPlaceM.mutate(
        {
          data: {
            kind,
            label: target.label || (kind === "home" ? "Home" : "Work"),
            address: target.address,
            lat: target.lat,
            lng: target.lng,
            googlePlaceId: target.googlePlaceId ?? undefined,
          },
        },
        { onSuccess: refreshState },
      );
    },
    [active, pendingSavePick, refreshState, upsertPlaceM],
  );

  const removeSaved = useCallback(
    (id: string) => {
      deletePlaceM.mutate({ id }, { onSuccess: refreshState });
    },
    [deletePlaceM, refreshState],
  );

  if (stateQ.isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!featureEnabled) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top + 12 }]}>
        <Header onBack={() => router.back()} title={t("driverDestination.title", { defaultValue: "Destination" })} />
        <View style={styles.disabledBox}>
          <Feather name="navigation-2" size={36} color={c.mutedForeground} />
          <Text style={[styles.disabledText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {t("driverDestination.disabled", {
              defaultValue: "Destination mode is currently turned off.",
            })}
          </Text>
        </View>
      </View>
    );
  }

  const renderPlaceRow = (
    p: DriverSavedPlace,
    icon: React.ComponentProps<typeof Feather>["name"],
  ) => (
    <View
      key={p.id}
      style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <Pressable
        style={styles.rowMain}
        onPress={() =>
          activateWith({
            address: p.address,
            label: p.label || p.address,
            lat: p.lat,
            lng: p.lng,
            googlePlaceId: p.googlePlaceId ?? undefined,
          })
        }
        disabled={busy}
      >
        <View style={[styles.rowIcon, { backgroundColor: c.primarySoft }]}>
          <Feather name={icon} size={18} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
            {p.label || p.address}
          </Text>
          <Text style={[styles.rowSub, { color: c.mutedForeground, fontFamily: fonts.medium }]} numberOfLines={1}>
            {p.address}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => removeSaved(p.id)}
        hitSlop={10}
        style={{ paddingHorizontal: 8 }}
        disabled={busy}
      >
        <Feather name="x" size={16} color={c.mutedForeground} />
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <Header onBack={() => router.back()} title={t("driverDestination.title", { defaultValue: "Destination" })} />

        {disabledUntil ? (
          <View style={styles.warningCard}>
            <Feather name="alert-triangle" size={18} color="#92400e" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.warningTitle, { fontFamily: fonts.semiBold }]}>
                {t("driverDestination.disabledByAdminTitle", {
                  defaultValue: "Destination mode disabled",
                })}
              </Text>
              <Text style={[styles.warningBody, { fontFamily: fonts.medium }]}>
                {t("driverDestination.disabledByAdminBody", {
                  defaultValue:
                    "An administrator has temporarily disabled destination mode on your account.",
                })}
              </Text>
              <Text style={[styles.warningBody, { fontFamily: fonts.medium }]}>
                {t("driverDestination.disabledUntil", {
                  defaultValue: "Available again: {{until}}",
                  until: new Date(disabledUntil).toLocaleString(),
                })}
              </Text>
              {disabledReason ? (
                <Text style={[styles.warningBody, { fontFamily: fonts.medium }]}>
                  {t("driverDestination.disabledReason", {
                    defaultValue: "Reason: {{reason}}",
                    reason: disabledReason,
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={[styles.toggleCard, { backgroundColor: active ? c.primary : c.surface, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleLabel, { color: active ? "rgba(255,255,255,0.85)" : c.mutedForeground, fontFamily: fonts.semiBold }]}>
              {active
                ? t("driverDestination.headingTo", { defaultValue: "Heading to" })
                : t("driverDestination.off", { defaultValue: "Destination mode" })}
            </Text>
            <Text style={[styles.toggleValue, { color: active ? "#fff" : c.foreground, fontFamily: fonts.bold }]} numberOfLines={2}>
              {active ? active.label || active.address : t("driverDestination.tapToPick", { defaultValue: "Pick an address below" })}
            </Text>
            <Text style={[styles.toggleSub, { color: active ? "rgba(255,255,255,0.85)" : c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("driverDestination.quota", {
                defaultValue: "{{remaining}} of {{max}} filters left today",
                remaining,
                max,
              })}
            </Text>
          </View>
          <Switch
            value={!!active}
            onValueChange={onToggle}
            trackColor={{ true: c.accent, false: c.border }}
            thumbColor="#fff"
            disabled={busy}
          />
        </View>

        {active ? (
          <View style={styles.saveRow}>
            <Button
              label={t("driverDestination.saveHome", { defaultValue: "Save as Home" })}
              variant={places?.home ? "ghost" : "secondary"}
              onPress={() => saveAs("home")}
              fullWidth={false}
              loading={upsertPlaceM.isPending}
            />
            <Button
              label={t("driverDestination.saveWork", { defaultValue: "Save as Work" })}
              variant={places?.work ? "ghost" : "secondary"}
              onPress={() => saveAs("work")}
              fullWidth={false}
              loading={upsertPlaceM.isPending}
            />
          </View>
        ) : null}

        <View style={[styles.searchBox, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Feather name="search" size={18} color={c.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("driverDestination.searchPlaceholder", {
              defaultValue: "Search address",
            })}
            placeholderTextColor={c.mutedForeground}
            style={[styles.searchInput, { color: c.foreground, fontFamily: fonts.medium }]}
            autoCorrect={false}
            editable={!busy && remaining > 0 && !active}
          />
          {searching ? <ActivityIndicator size="small" color={c.primary} /> : null}
        </View>

        {pendingSavePick ? (
          <View style={[styles.pendingCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.pendingHeader}>
              <Feather name="map-pin" size={18} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                  {pendingSavePick.label || pendingSavePick.address}
                </Text>
                <Text style={[styles.rowSub, { color: c.mutedForeground, fontFamily: fonts.medium }]} numberOfLines={1}>
                  {pendingSavePick.address}
                </Text>
              </View>
              <Button
                label={t("driverDestination.go", { defaultValue: "Go" })}
                onPress={() => {
                  const p = pendingSavePick;
                  setPendingSavePick(null);
                  activateWith(p);
                }}
                loading={activateM.isPending}
                fullWidth={false}
              />
              <Pressable onPress={() => setPendingSavePick(null)} hitSlop={8}>
                <Feather name="x" size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            <View style={styles.saveRow}>
              <Button
                label={t("driverDestination.saveHome", { defaultValue: "Save as Home" })}
                variant={places?.home ? "ghost" : "secondary"}
                onPress={() => saveAs("home")}
                fullWidth={false}
                loading={upsertPlaceM.isPending}
              />
              <Button
                label={t("driverDestination.saveWork", { defaultValue: "Save as Work" })}
                variant={places?.work ? "ghost" : "secondary"}
                onPress={() => saveAs("work")}
                fullWidth={false}
                loading={upsertPlaceM.isPending}
              />
            </View>
          </View>
        ) : null}

        {query.trim().length >= 2 ? (
          <FlatList
            data={results}
            keyExtractor={(r) => r.placeId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPickAutocomplete(item)}
                disabled={busy}
                style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
              >
                <View style={[styles.rowIcon, { backgroundColor: c.primarySoft }]}>
                  <Feather name="map-pin" size={18} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                    {item.primary}
                  </Text>
                  {item.secondary ? (
                    <Text style={[styles.rowSub, { color: c.mutedForeground, fontFamily: fonts.medium }]} numberOfLines={1}>
                      {item.secondary}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              !searching ? (
                <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("driverDestination.noResults", { defaultValue: "No matches" })}
                </Text>
              ) : null
            }
          />
        ) : (
          <FlatList
            data={places?.recents ?? []}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListHeaderComponent={
              <View>
                {places?.home ? renderPlaceRow(places.home, "home") : null}
                {places?.work ? renderPlaceRow(places.work, "briefcase") : null}
                {(places?.recents.length ?? 0) > 0 ? (
                  <Text style={[styles.sectionTitle, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                    {t("driverDestination.recent", { defaultValue: "Recent" })}
                  </Text>
                ) : null}
              </View>
            }
            renderItem={({ item }) => renderPlaceRow(item, "clock")}
            ListEmptyComponent={
              !places?.home && !places?.work ? (
                <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("driverDestination.startTyping", {
                    defaultValue: "Search for an address to set your destination.",
                  })}
                </Text>
              ) : null
            }
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={[styles.backBtn, { backgroundColor: c.surface }]}>
        <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={20} color={c.foreground} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.bold }]}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, gap: 12 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18 },
  toggleCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { fontSize: 12, marginBottom: 2 },
  toggleValue: { fontSize: 16, marginBottom: 4 },
  toggleSub: { fontSize: 12 },
  saveRow: { flexDirection: "row", gap: 8 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15 },
  pendingCard: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14 },
  rowSub: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 12, marginTop: 16, marginBottom: 4, marginStart: 4, textTransform: "uppercase" },
  empty: { fontSize: 13, padding: 20, textAlign: "center" },
  disabledBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  disabledText: { fontSize: 14, textAlign: "center" },
  warningCard: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#fef3c7",
    borderColor: "#fcd34d",
  },
  warningTitle: { fontSize: 14, color: "#92400e", marginBottom: 4 },
  warningBody: { fontSize: 12, color: "#92400e", marginTop: 2 },
});
