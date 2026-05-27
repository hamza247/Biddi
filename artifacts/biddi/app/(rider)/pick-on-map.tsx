import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { ClosestDriverPin } from "@/components/ClosestDriverPin";
import { DriverLoadingBadge } from "@/components/DriverLoadingBadge";
import { MapPicker, type MapPickerHandle } from "@/components/MapPicker";
import { useRide } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import {
  closestDriverEtaMinutes,
  useNearbyDrivers,
} from "@/hooks/useNearbyDrivers";
import { useCurrentLocation } from "@/lib/location";
import { fetchReverseGeocode } from "@/lib/maps";
import type { Place } from "@/lib/types";

type PickRole = "pickup" | "dropoff";

export default function PickOnMapScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: PickRole = params.role === "pickup" ? "pickup" : "dropoff";
  const { t } = useTranslation();

  const { pendingRide, setPendingRide, clearPendingRide } = useRide();
  const { location, error } = useCurrentLocation();

  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  const showLocationWarning = !location && error === "timeout";

  const seed = pendingRide
    ? role === "pickup"
      ? pendingRide.pickup
      : pendingRide.dropoff
    : null;
  const initialLat =
    seed?.lat ?? pendingRide?.dropoff.lat ?? location?.lat ?? 33.5731;
  const initialLng =
    seed?.lng ?? pendingRide?.dropoff.lng ?? location?.lng ?? -7.5898;

  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: initialLat,
    lng: initialLng,
  });
  const [address, setAddress] = useState<string>(seed?.address ?? "");
  const [primary, setPrimary] = useState<string>(seed?.label ?? "");
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { isRTL, ...fonts } = useFontFamily();

  const { drivers, loading: driversLoading } = useNearbyDrivers(center, screenFocused);
  const etaMinutes = closestDriverEtaMinutes(center, drivers);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveAt = useCallback((lat: number, lng: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setResolving(true);
      const r = await fetchReverseGeocode(lat, lng);
      setResolving(false);
      if (r) {
        setAddress(r.address);
        setPrimary(r.primary);
      } else {
        setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        setPrimary(t("pickOnMap.pinnedLocation"));
      }
    }, 350);
  }, [t]);

  useEffect(() => {
    if (!address) resolveAt(center.lat, center.lng);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRegionChangeComplete = (lat: number, lng: number) => {
    setCenter({ lat, lng });
    resolveAt(lat, lng);
  };

  const handleDone = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const picked: Place = {
        label: primary || (role === "pickup" ? t("pickOnMap.pickupPoint") : t("pickOnMap.dropoffPoint")),
        address: address || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`,
        lat: center.lat,
        lng: center.lng,
      };

      if (!pendingRide) {
        if (location) {
          await setPendingRide(
            {
              label: location.primary || t("pickOnMap.currentLocation"),
              address: location.address,
              lat: location.lat,
              lng: location.lng,
            },
            picked,
          );
          router.replace("/(rider)/confirm-ride");
        } else {
          router.back();
        }
        return;
      }

      const nextPickup = role === "pickup" ? picked : pendingRide.pickup;
      const nextDropoff = role === "dropoff" ? picked : pendingRide.dropoff;
      await setPendingRide(nextPickup, nextDropoff);
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  const mapRef = useRef<MapPickerHandle | null>(null);
  const recenterToMe = () => {
    if (!location) return;
    mapRef.current?.animateToCenter(location.lat, location.lng);
  };

  const titleText = role === "pickup" ? t("pickOnMap.setPickup") : t("pickOnMap.setDestination");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <MapPicker
        initialLat={initialLat}
        initialLng={initialLng}
        onRegionChangeComplete={onRegionChangeComplete}
        innerRef={mapRef}
      />

      <View pointerEvents="none" style={styles.pinWrap}>
        <ClosestDriverPin etaMinutes={etaMinutes} />
      </View>

      <View
        pointerEvents="none"
        style={[styles.driverLoadingWrap, { top: insets.top + 68 }]}
      >
        <DriverLoadingBadge visible={driversLoading} />
      </View>

      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Pressable
          accessibilityLabel={t("common.back")}
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: c.background }]}
        >
          <Feather name={isRTL ? "arrow-right" : "arrow-left"} size={20} color={c.foreground} />
        </Pressable>
        <View style={[styles.titlePill, { backgroundColor: c.background }]}>
          <Text style={[styles.titleText, { color: c.foreground, fontFamily: fonts.bold }]}>
            {titleText}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={t("pickOnMap.useCurrentLocation")}
          onPress={recenterToMe}
          style={[styles.iconBtn, { backgroundColor: c.background }]}
        >
          <Feather name="crosshair" size={20} color={c.primary} />
        </Pressable>
      </View>

      <View
        style={[
          styles.calloutWrap,
          { bottom: 200 + Math.max(insets.bottom, 12) },
        ]}
        pointerEvents="none"
      >
        <View style={[styles.callout, { backgroundColor: c.foreground }]}>
          {resolving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={[styles.calloutText, { color: "#fff", fontFamily: fonts.semiBold }]} numberOfLines={2}>
              {primary || address || t("pickOnMap.moveMap")}
            </Text>
          )}
        </View>
        <View style={[styles.calloutTail, { borderTopColor: c.foreground }]} />
      </View>

      <View
        style={[
          styles.bottomCard,
          {
            backgroundColor: c.background,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: c.border }]} />

        {showLocationWarning && (
          <View
            style={[
              styles.locationWarning,
              { backgroundColor: "#FFF3CD", borderColor: "#FBBF24" },
            ]}
          >
            <Feather name="alert-triangle" size={15} color="#B45309" />
            <Text style={[styles.locationWarningText, { fontFamily: fonts.medium }]}>
              {t("pickOnMap.locationWarning")}
            </Text>
          </View>
        )}

        <Text style={[styles.helper, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
          {Platform.OS === "web"
            ? t("pickOnMap.helperWeb")
            : t("pickOnMap.helperNative")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleDone}
          disabled={submitting || !address}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: c.cta,
              opacity: submitting || !address ? 0.6 : pressed ? 0.92 : 1,
            },
          ]}
        >
          <Text style={[styles.ctaLabel, { color: c.ctaForeground, fontFamily: fonts.bold }]}>{t("common.done")}</Text>
        </Pressable>

        {!pendingRide && (
          <Pressable
            onPress={() => {
              clearPendingRide();
              router.back();
            }}
            style={styles.cancelBtn}
          >
            <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
              {t("common.cancel")}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 5,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  titlePill: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  titleText: { fontSize: 14 },
  pinWrap: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 80,
    height: 83,
    marginLeft: -40,
    marginTop: -83,
    alignItems: "center",
    zIndex: 4,
  },
  calloutWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
    zIndex: 3,
  },
  callout: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    maxWidth: "90%",
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  calloutText: {
    fontSize: 13,
    textAlign: "center",
  },
  calloutTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  bottomCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  helper: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 14,
  },
  cta: {
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: { fontSize: 16, letterSpacing: 0.2 },
  cancelBtn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  cancelText: { fontSize: 14 },
  locationWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  locationWarningText: {
    flex: 1,
    fontSize: 13,
    color: "#92400E",
    lineHeight: 18,
  },
  driverLoadingWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 6,
  },
});
