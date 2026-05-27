import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useColors } from "@/hooks/useColors";
import { useConfig } from "@/lib/config";
import { useCurrentLocation } from "@/lib/location";
import {
  fetchAutocomplete,
  fetchPlaceDetails,
  newSessionToken,
  type AutocompleteResult,
} from "@/lib/maps";
import { pickupStore } from "@/lib/pickupStore";
import { useFontFamily } from "@/hooks/useFontFamily";

export default function PickupScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { location, error: locationError } = useCurrentLocation();
  const cfg = useConfig({ refreshOnMount: true });
  const { t } = useTranslation();
  const fonts = useFontFamily();

  const autocompleteAvailable =
    cfg.mapProviderAutocomplete === "osm" || cfg.hasServerMapsKey;
  const geocodeAvailable =
    cfg.mapProviderGeocode === "osm" || cfg.hasServerMapsKey;
  const mapsConfigured = autocompleteAvailable && geocodeAvailable;

  const initial = pickupStore.get()?.address ?? location?.address ?? "";
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<AutocompleteResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);
  const sessionRef = useRef<string>(newSessionToken());

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
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
        setSearchError(false);
      } catch {
        if (myToken !== tokenRef.current) return;
        setResults([]);
        setSearchError(true);
      } finally {
        if (myToken === tokenRef.current) setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, location, retryCount]);

  const useGps = useCallback(() => {
    pickupStore.clear();
    router.back();
  }, [router]);

  const onSelectAutocomplete = async (r: AutocompleteResult) => {
    setBusyId(r.placeId);
    const details = await fetchPlaceDetails(r.placeId, sessionRef.current);
    setBusyId(null);
    sessionRef.current = newSessionToken();
    if (!details) {
      setError(t("pickup.errorFetch"));
      return;
    }
    pickupStore.set({
      label: r.primary,
      address: details.address,
      lat: details.lat,
      lng: details.lng,
      googlePlaceId: details.placeId,
    });
    router.back();
  };

  const showSearchResults = query.trim().length >= 2;

  const gpsLabel = location?.address
    ?? (locationError === "timeout"
      ? t("pickup.errorGpsTimeout")
      : locationError === "permission"
        ? t("pickup.locationDenied")
        : t("pickup.findingLocation"));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("pickup.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.inputArea}>
        <View style={[styles.inputWrap, { backgroundColor: c.surface, borderColor: c.primary }]}>
          <View style={[styles.dot, { backgroundColor: c.accent }]} />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setError(null);
            }}
            placeholder={t("pickup.searchPlaceholder")}
            placeholderTextColor={c.mutedForeground}
            style={[styles.input, { color: c.foreground, fontFamily: fonts.medium }]}
            autoFocus
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={c.primary} />}
          {query.length > 0 && !searching && (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Feather name="x-circle" size={18} color={c.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {error && (
        <View style={[styles.errorBox, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Feather name="alert-circle" size={14} color={c.primary} />
          <Text style={[styles.errorText, { color: c.foreground, fontFamily: fonts.medium }]}>{error}</Text>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={useGps}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: pressed ? c.surface : "transparent" },
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: c.primarySoft ?? c.surface }]}>
            <Feather name="crosshair" size={18} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: c.primary, fontFamily: fonts.semiBold }]}>{t("pickup.useCurrentLocation")}</Text>
            <Text style={[styles.rowAddress, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={1}>
              {gpsLabel}
            </Text>
          </View>
        </Pressable>

        {!mapsConfigured && (
          <View style={[styles.errorBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Feather name="alert-triangle" size={14} color={c.primary} />
            <Text style={[styles.errorText, { color: c.foreground, fontFamily: fonts.medium }]}>
              {t("pickup.mapsNotConfigured")}
            </Text>
          </View>
        )}

        {showSearchResults && mapsConfigured && (
          searchError ? (
            <Pressable onPress={() => { setSearchError(false); setRetryCount((n) => n + 1); }}>
              <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("pickup.searchFailed")}
              </Text>
            </Pressable>
          ) : results.length === 0 && !searching ? (
            <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("pickup.noMatches")}
            </Text>
          ) : (
            results.map((r) => (
              <Pressable
                key={r.placeId}
                onPress={() => onSelectAutocomplete(r)}
                disabled={!!busyId}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? c.surface : "transparent", opacity: busyId === r.placeId ? 0.6 : 1 },
                ]}
              >
                <View style={[styles.rowIcon, { backgroundColor: c.surface }]}>
                  <Feather name="map-pin" size={18} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                    {r.primary}
                  </Text>
                  <Text style={[styles.rowAddress, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={1}>
                    {r.secondary}
                  </Text>
                </View>
                {busyId === r.placeId && <ActivityIndicator size="small" color={c.primary} />}
              </Pressable>
            ))
          )
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17 },
  inputArea: { paddingHorizontal: 20, paddingBottom: 12 },
  inputWrap: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12,
    borderWidth: 1.5,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  input: { flex: 1, fontSize: 16, height: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 15 },
  rowAddress: { fontSize: 13, marginTop: 2 },
  empty: { textAlign: "center", marginTop: 40 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13 },
});
