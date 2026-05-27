import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
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

import { ClosestDriverPin, type ClosestDriverPinStatus } from "@/components/ClosestDriverPin";
import { useRide, usePlaces } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { closestDriverEtaMinutes, useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import { useConfig } from "@/lib/config";
import { locationToPickup, useCurrentLocation } from "@/lib/location";
import { pickupStore } from "@/lib/pickupStore";
import {
  fetchAutocomplete,
  fetchPlaceDetails,
  newSessionToken,
  type AutocompleteResult,
} from "@/lib/maps";
import type { Place, SavedPlace } from "@/lib/types";

export default function DestinationScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { saveLabel, deletePlaceId } = useLocalSearchParams<{ saveLabel?: string; deletePlaceId?: string }>();
  const { setPendingRide } = useRide();
  const {
    savedPlaces: rawSavedPlaces,
    recentPlaces: rawRecentPlaces,
    addSavedPlace,
    deleteSavedPlace,
  } = usePlaces();
  const savedPlaces = rawSavedPlaces ?? [];
  const recentPlaces = rawRecentPlaces ?? [];
  const { location, error: locationError } = useCurrentLocation();
  const cfg = useConfig({ refreshOnMount: true });
  const { t } = useTranslation();

  const autocompleteAvailable =
    cfg.mapProviderAutocomplete === "osm" || cfg.hasServerMapsKey;
  const geocodeAvailable =
    cfg.mapProviderGeocode === "osm" || cfg.hasServerMapsKey;
  const mapsConfigured = autocompleteAvailable && geocodeAvailable;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AutocompleteResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPickup, setCustomPickup] = useState(() => pickupStore.get());
  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setCustomPickup(pickupStore.get());
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));
  const fonts = useFontFamily();

  // Same closest-driver ETA pipeline as the home screen, anchored to the
  // rider's chosen pickup (custom pickup wins over GPS fix when set).
  const driverCenter = useMemo(() => {
    if (customPickup?.lat != null && customPickup?.lng != null) {
      return { lat: customPickup.lat, lng: customPickup.lng };
    }
    if (location) return { lat: location.lat, lng: location.lng };
    return null;
  }, [customPickup, location]);
  const {
    drivers: nearbyDrivers,
    loading: driversLoading,
    sourceStatus: driversSourceStatus,
  } = useNearbyDrivers(driverCenter, screenFocused);
  const driverEtaMinutes = closestDriverEtaMinutes(driverCenter, nearbyDrivers);
  const driverPinStatus: ClosestDriverPinStatus = (() => {
    if (locationError === "permission" || locationError === "unknown" || locationError === "timeout") {
      if (!driverCenter) return "unavailable";
    }
    if (!driverCenter) return "loading";
    if (driversLoading || driversSourceStatus === "loading") return "loading";
    if (driversSourceStatus === "unavailable") return "unavailable";
    if (driverEtaMinutes != null) return "ready";
    return "empty";
  })();
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

  const submit = useCallback(
    async (place: Place) => {
      const customPickup = pickupStore.get();
      const pickup = customPickup ?? (location ? locationToPickup(location) : null);
      if (!pickup) {
        if (locationError === "timeout") {
          setError(t("destination.errorGpsTimeout"));
        } else if (locationError === "permission") {
          setError(t("destination.errorGpsPermission"));
        } else {
          setError(t("destination.errorGpsWaiting"));
        }
        return;
      }
      try {
        await setPendingRide(pickup, place);
        router.replace("/(rider)/confirm-ride");
      } catch {
        setError(t("destination.errorLoadDest"));
      }
    },
    [location, locationError, setPendingRide, router, t],
  );

  const onSelectAutocomplete = async (r: AutocompleteResult) => {
    setBusyId(r.placeId);
    const details = await fetchPlaceDetails(r.placeId, sessionRef.current);
    setBusyId(null);
    sessionRef.current = newSessionToken();
    if (!details) {
      setError(t("destination.errorFetchDest"));
      return;
    }
    const place: Place = {
      label: r.primary,
      address: details.address,
      lat: details.lat,
      lng: details.lng,
      googlePlaceId: details.placeId,
    };
    if (saveLabel) {
      try {
        await addSavedPlace({
          label: saveLabel,
          address: place.address,
          lat: place.lat!,
          lng: place.lng!,
          googlePlaceId: place.googlePlaceId,
        });
        // When editing an existing saved place, remove the old one after the
        // new one has been created so the label slot is cleanly replaced.
        if (deletePlaceId) {
          await deleteSavedPlace(deletePlaceId).catch(() => {});
        }
      } catch {
        // non-fatal — proceed to book even if save fails
      }
    }
    await submit(place);
  };

  const onSelectSaved = (p: SavedPlace) =>
    submit({
      label: p.label || t("destination.savedPlace"),
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      googlePlaceId: p.googlePlaceId,
    });

  const saveRecent = (p: SavedPlace) => {
    const finish = async (label: string) => {
      try {
        await addSavedPlace({
          label: label.trim() || p.address.split(",")[0],
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          googlePlaceId: p.googlePlaceId,
        });
      } catch {
        setError(t("destination.errorSavePlace"));
      }
    };
    if (Platform.OS === "ios" && (Alert as { prompt?: unknown }).prompt) {
      Alert.prompt(
        t("destination.saveThisPlace"),
        p.address,
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.save"), onPress: (text?: string) => finish(text ?? "") },
        ],
        "plain-text",
        t("destination.home"),
      );
    } else {
      Alert.alert(t("destination.saveThisPlace"), p.address, [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.save"), onPress: () => finish("") },
      ]);
    }
  };

  const removeSaved = (p: SavedPlace) => {
    Alert.alert(t("destination.removePlace"), p.label || p.address, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSavedPlace(p.id);
          } catch {
            setError(t("destination.errorRemovePlace"));
          }
        },
      },
    ]);
  };

  const pickupLabel = customPickup?.address
    ?? location?.address
    ?? (locationError === "timeout"
      ? t("destination.errorGpsTimeout")
      : locationError === "permission"
        ? t("destination.locationDenied")
        : t("destination.findingLocation"));

  const showSearchResults = query.trim().length >= 2;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("destination.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.inputs}>
        <View style={styles.pickupRow}>
          <Pressable
            onPress={() => router.push("/(rider)/pickup")}
            style={[styles.inputWrap, { flex: 1, backgroundColor: c.surface, borderColor: customPickup ? c.accent : c.border }]}
          >
            <View style={[styles.dot, { backgroundColor: customPickup ? c.accent : "#ccc" }]} />
            <Text style={[styles.fixedPickup, { color: c.foreground, fontFamily: fonts.medium }]} numberOfLines={1}>
              {pickupLabel}
            </Text>
            <Feather name="edit-2" size={14} color={c.mutedForeground} />
          </Pressable>
          <View style={styles.driverPinSlot}>
            <ClosestDriverPin
              status={driverPinStatus}
              etaMinutes={driverEtaMinutes ?? undefined}
            />
          </View>
        </View>
        <View style={[styles.connector, { backgroundColor: c.border }]} />
        <View style={[styles.inputWrap, { backgroundColor: c.surface, borderColor: c.primary }]}>
          <View style={[styles.dotSquare, { backgroundColor: c.primary }]} />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setError(null);
            }}
            placeholder={t("destination.searchPlaceholder")}
            placeholderTextColor={c.mutedForeground}
            style={[styles.input, { color: c.foreground, fontFamily: fonts.medium }]}
            autoFocus
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={c.primary} />}
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
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {!mapsConfigured && (
          <View style={[styles.errorBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Feather name="alert-triangle" size={14} color={c.primary} />
            <Text style={[styles.errorText, { color: c.foreground, fontFamily: fonts.medium }]}>
              {t("destination.mapsNotConfigured")}
            </Text>
          </View>
        )}
        {showSearchResults ? (
          !mapsConfigured ? null : searchError ? (
            <Pressable onPress={() => { setSearchError(false); setRetryCount((n) => n + 1); }}>
              <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("destination.searchFailed")}
              </Text>
            </Pressable>
          ) : results.length === 0 && !searching ? (
            <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("destination.noMatches")}
            </Text>
          ) : (
            results.map((r) => (
              <AutocompleteRow
                key={r.placeId}
                result={r}
                busy={busyId === r.placeId}
                onPress={() => onSelectAutocomplete(r)}
              />
            ))
          )
        ) : (
          <>
            {savedPlaces.length > 0 && (
              <>
                <SectionHeader label={t("destination.saved")} />
                {savedPlaces.map((p) => (
                  <PlaceRow
                    key={p.id}
                    place={p}
                    saved
                    onPress={() => onSelectSaved(p)}
                    onLongPress={() => removeSaved(p)}
                    onAction={() => removeSaved(p)}
                  />
                ))}
              </>
            )}
            {recentPlaces.length > 0 && (
              <>
                <SectionHeader label={t("destination.recent")} />
                {recentPlaces.map((p) => (
                  <PlaceRow
                    key={p.id}
                    place={p}
                    onPress={() => onSelectSaved(p)}
                    onLongPress={() => saveRecent(p)}
                    onAction={() => saveRecent(p)}
                  />
                ))}
              </>
            )}
            {savedPlaces.length === 0 && recentPlaces.length === 0 && (
              <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {mapsConfigured
                  ? t("destination.startTyping")
                  : t("destination.mapsUnavailable")}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SectionHeader({ label }: { label: string }) {
  const c = useColors();
  const fonts = useFontFamily();
  return <Text style={[styles.section, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{label}</Text>;
}

function AutocompleteRow({
  result,
  busy,
  onPress,
}: {
  result: AutocompleteResult;
  busy: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? c.surface : "transparent", opacity: busy ? 0.6 : 1 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: c.surface }]}>
        <Feather name="map-pin" size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
          {result.primary}
        </Text>
        <Text style={[styles.rowAddress, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={1}>
          {result.secondary}
        </Text>
      </View>
      {busy && <ActivityIndicator size="small" color={c.primary} />}
    </Pressable>
  );
}

function PlaceRow({
  place,
  saved,
  onPress,
  onLongPress,
  onAction,
}: {
  place: SavedPlace;
  saved?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onAction?: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? c.surface : "transparent" },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: c.surface }]}>
        <Feather name={saved ? "bookmark" : "clock"} size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
          {place.label || place.address.split(",")[0]}
        </Text>
        <Text style={[styles.rowAddress, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={1}>
          {place.address}
        </Text>
      </View>
      {onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather
            name={saved ? "trash-2" : "bookmark"}
            size={18}
            color={c.mutedForeground}
          />
        </Pressable>
      )}
    </Pressable>
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
  inputs: { paddingHorizontal: 20, paddingBottom: 16 },
  pickupRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  driverPinSlot: { width: 64, alignItems: "center", justifyContent: "center" },
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
  dotSquare: { width: 12, height: 12, borderRadius: 3 },
  connector: { width: 1, height: 12, marginStart: 36, marginVertical: 4 },
  fixedPickup: { flex: 1, fontSize: 15 },
  input: { flex: 1, fontSize: 16, height: "100%" },
  section: {
    fontSize: 11,
    letterSpacing: 1.2,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 6,
  },
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
  actionBtn: { padding: 6, marginStart: 4 },
});
