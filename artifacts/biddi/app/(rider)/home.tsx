import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { AppMap, type AppMapHandle } from "@/components/AppMap";
import { ClosestDriverEtaBadge } from "@/components/ClosestDriverEtaBadge";
import { DriverLoadingBadge } from "@/components/DriverLoadingBadge";
import { QuickBookChips } from "@/components/QuickBookChips";
import { VoiceBookingSheet } from "@/components/VoiceBookingSheet";
import { useRide, usePlaces } from "@/context/AppContext";
import { ClosestDriverPin } from "@/components/ClosestDriverPin";
import { useClosestDriverEta, useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import {
  useAvailableVehicleTypes,
  type RemoteVehicleType,
} from "@/hooks/useVehicleTypes";
import { fetchReverseGeocode } from "@/lib/maps";
import { useCurrentLocation } from "@/lib/location";
import { pickupStore } from "@/lib/pickupStore";
import { useFontFamily } from "@/hooks/useFontFamily";
import type { Place, SavedPlace } from "@/lib/types";

const VEHICLE_ITEM_WIDTH = 84;
const VEHICLE_ICON_SIZE = 44;

function fallbackIconName(
  t: RemoteVehicleType,
): React.ComponentProps<typeof Feather>["name"] {
  if (t.classKey === "moto" || t.vehicleCategory === "moto") return "zap";
  if (t.wheelchairAccess) return "user-check";
  if (t.poolEnabled) return "users";
  if (t.classKey === "comfort") return "star";
  return "navigation";
}

function VehicleIcon({ type }: { type: RemoteVehicleType }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [type.iconUrl]);
  const showImage = !!type.iconUrl && !failed;
  return (
    <View style={styles.vehicleIcon}>
      {showImage ? (
        <ExpoImage
          source={{ uri: type.iconUrl as string }}
          style={styles.vehicleIconImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setFailed(true)}
        />
      ) : (
        <Feather name={fallbackIconName(type)} size={26} color="#444" />
      )}
    </View>
  );
}

export default function RiderHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ride, setPendingRide } = useRide();
  const {
    recentPlaces: rawRecent,
    savedPlaces: rawSaved,
    deleteSavedPlace,
    addSavedPlace,
  } = usePlaces();
  const recentDest = (rawRecent ?? [])[0] ?? null;
  const savedPlaces = rawSaved ?? [];
  const { location, loading, error } = useCurrentLocation();
  const { types: vehicleTypes, loading: vehicleTypesLoading } = useAvailableVehicleTypes(
    location?.lat,
    location?.lng,
  );
  const { t } = useTranslation();
  const { isRTL, ...fonts } = useFontFamily();

  const mapRef = useRef<AppMapHandle>(null);
  const hasAutoZoomed = useRef(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const addressFade = useRef(new Animated.Value(1)).current;
  const addressTranslate = useRef(new Animated.Value(0)).current;
  const handleScale = useRef(new Animated.Value(1)).current;
  /** Settle bounce for the centre pickup pin: scales up slightly then springs
   *  back whenever the rider drags the map to a new pickup point so the pin
   *  feels like it "lands" rather than just teleports under the cursor. */
  const pinScale = useRef(new Animated.Value(1)).current;
  const lastAddressRef = useRef<string>("");
  const lastPinCenterRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (vehicleTypes.length === 0) return;
    if (selectedVehicleId && vehicleTypes.some((v) => v.id === selectedVehicleId)) return;
    setSelectedVehicleId(vehicleTypes[0].id);
  }, [vehicleTypes, selectedVehicleId]);

  const [busyDest, setBusyDest] = useState(false);
  const [showVoice, setShowVoice] = useState(false);

  // Undo snackbar for deleted saved places
  const [undoPlace, setUndoPlace] = useState<SavedPlace | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoFade = useRef(new Animated.Value(0)).current;
  const [pinCenter, setPinCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [pinAddress, setPinAddress] = useState<string>("");
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    count: nearbyCount,
    drivers: nearbyDrivers,
    loading: driversLoading,
    sourceStatus: driversSourceStatus,
  } = useNearbyDrivers(pinCenter ?? location);

  useFocusEffect(
    useCallback(() => {
      const stored = pickupStore.get();
      if (stored && stored.lat != null && stored.lng != null) {
        setPinCenter({ lat: stored.lat!, lng: stored.lng! });
        setPinAddress(stored.address);
      }
    }, []),
  );

  useEffect(() => {
    if (location && !hasAutoZoomed.current) {
      hasAutoZoomed.current = true;
      setTimeout(() => {
        mapRef.current?.recenter(location.lat, location.lng, 0.01);
      }, 350);
      if (!pinCenter) {
        setPinCenter({ lat: location.lat, lng: location.lng });
        setPinAddress(location.address ?? "");
      }
    }
  }, [location, pinCenter]);

  useEffect(() => {
    if (!ride) return;
    if (ride.status === "bidding") router.replace("/(rider)/bidding");
    else if (
      ride.status === "driver_arriving" ||
      ride.status === "in_progress" ||
      ride.status === "completed" ||
      ride.status === "queued" ||
      ride.status === "assigned_next"
    )
      router.replace("/(rider)/trip");
  }, [ride, router]);

  // Animate the floating address card whenever its text changes so the new
  // resolved address slides up + fades in smoothly instead of replacing in
  // place.
  useEffect(() => {
    if (!pinAddress) return;
    if (pinAddress === lastAddressRef.current) return;
    lastAddressRef.current = pinAddress;
    addressFade.setValue(0);
    addressTranslate.setValue(6);
    Animated.parallel([
      Animated.timing(addressFade, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(addressTranslate, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [pinAddress, addressFade, addressTranslate]);

  // Subtle settle bounce on the centre pickup pin whenever the rider moves
  // the map to a new pickup location.
  useEffect(() => {
    if (!pinCenter) return;
    const last = lastPinCenterRef.current;
    if (
      last &&
      Math.abs(last.lat - pinCenter.lat) < 1e-6 &&
      Math.abs(last.lng - pinCenter.lng) < 1e-6
    ) {
      return;
    }
    lastPinCenterRef.current = { lat: pinCenter.lat, lng: pinCenter.lng };
    pinScale.setValue(1);
    Animated.sequence([
      Animated.timing(pinScale, {
        toValue: 1.18,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(pinScale, {
        toValue: 1,
        friction: 4,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pinCenter, pinScale]);

  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setPinCenter({ lat, lng });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setResolving(true);
      const r = await fetchReverseGeocode(lat, lng);
      setResolving(false);
      if (r) {
        setPinAddress(r.primary || r.address);
      } else {
        setPinAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    }, 400);
  }, []);

  const handleSearchPress = async () => {
    const pickupLat = pinCenter?.lat ?? location?.lat;
    const pickupLng = pinCenter?.lng ?? location?.lng;
    const pickupAddr = pinAddress || location?.address || "";
    if (pickupLat != null && pickupLng != null) {
      pickupStore.set({
        label: pickupAddr.split(",")[0] || "Pickup",
        address: pickupAddr,
        lat: pickupLat,
        lng: pickupLng,
      });
    }
    router.push("/(rider)/destination");
  };

  const handleBookToPlace = useCallback(
    async (place: Place) => {
      const pickupLat = pinCenter?.lat ?? location?.lat;
      const pickupLng = pinCenter?.lng ?? location?.lng;
      const pickupAddr = pinAddress || location?.address || "";
      if (pickupLat == null || pickupLng == null) {
        router.push("/(rider)/destination");
        return;
      }
      setBusyDest(true);
      try {
        await setPendingRide(
          {
            label: pickupAddr.split(",")[0] || "Pickup",
            address: pickupAddr,
            lat: pickupLat,
            lng: pickupLng,
          },
          {
            label: place.label,
            address: place.address,
            lat: place.lat!,
            lng: place.lng!,
            googlePlaceId: place.googlePlaceId,
          },
        );
        router.push("/(rider)/confirm-ride");
      } catch {
        router.push("/(rider)/destination");
      } finally {
        setBusyDest(false);
      }
    },
    [pinCenter, location, pinAddress, setPendingRide, router],
  );

  const handleRecenter = () => {
    if (location) {
      mapRef.current?.recenter(location.lat, location.lng, 0.01);
      setPinCenter({ lat: location.lat, lng: location.lng });
      setPinAddress(location.address ?? "");
    }
  };

  const showUndo = useCallback((place: SavedPlace) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoPlace(place);
    Animated.timing(undoFade, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    undoTimer.current = setTimeout(() => {
      Animated.timing(undoFade, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setUndoPlace(null));
    }, 4000);
  }, [undoFade]);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    Animated.timing(undoFade, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => setUndoPlace(null));
  }, [undoFade]);

  const handleDeleteFavorite = useCallback(
    async (place: SavedPlace) => {
      showUndo(place);
      try {
        await deleteSavedPlace(place.id);
      } catch {
        // non-fatal; places will refresh regardless
      }
    },
    [deleteSavedPlace, showUndo],
  );

  const handleUndoDelete = useCallback(async () => {
    if (!undoPlace) return;
    const place = undoPlace;
    dismissUndo();
    try {
      await addSavedPlace({
        label: place.label,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.googlePlaceId,
      });
    } catch {
      // non-fatal
    }
  }, [undoPlace, dismissUndo, addSavedPlace]);

  const handleEditFavorite = useCallback(
    (place: SavedPlace) => {
      const pickupLat = pinCenter?.lat ?? location?.lat;
      const pickupLng = pinCenter?.lng ?? location?.lng;
      const pickupAddr = pinAddress || location?.address || "";
      if (pickupLat != null && pickupLng != null) {
        pickupStore.set({
          label: pickupAddr.split(",")[0] || "Pickup",
          address: pickupAddr,
          lat: pickupLat,
          lng: pickupLng,
        });
      }
      router.push({
        pathname: "/(rider)/destination",
        params: { saveLabel: place.label, deletePlaceId: place.id },
      });
    },
    [pinCenter, location, pinAddress, router],
  );

  const handleQuickDest = async () => {
    if (!recentDest) {
      handleSearchPress();
      return;
    }
    const pickupLat = pinCenter?.lat ?? location?.lat;
    const pickupLng = pinCenter?.lng ?? location?.lng;
    const pickupAddr = pinAddress || location?.address || "";
    if (pickupLat == null || pickupLng == null) {
      router.push("/(rider)/destination");
      return;
    }
    setBusyDest(true);
    try {
      await setPendingRide(
        {
          label: pickupAddr.split(",")[0] || "Pickup",
          address: pickupAddr,
          lat: pickupLat,
          lng: pickupLng,
        },
        {
          label: recentDest.label || recentDest.address.split(",")[0],
          address: recentDest.address,
          lat: recentDest.lat,
          lng: recentDest.lng,
          googlePlaceId: recentDest.googlePlaceId,
        },
      );
      router.push("/(rider)/confirm-ride");
    } catch {
      router.push("/(rider)/destination");
    } finally {
      setBusyDest(false);
    }
  };

  const closestCenter = pinCenter ?? location;
  const selectedVehicle = vehicleTypes.find((v) => v.id === selectedVehicleId) ?? null;
  const selectedCategory = selectedVehicle?.vehicleCategory ?? null;
  const etaDrivers = selectedCategory
    ? nearbyDrivers.filter((d) => d.vehicleCategory === selectedCategory)
    : nearbyDrivers;
  const etaMinutes = useClosestDriverEta(closestCenter, etaDrivers);
  const closestPinStatus: "loading" | "ready" | "empty" | "unavailable" = (() => {
    // Permission denied / GPS unavailable / location timeout → we have no
    // valid center to anchor an ETA on, so the circle should clearly say
    // "ETA unavailable" instead of pretending the area is empty.
    if (error === "permission" || error === "unknown" || error === "timeout") {
      return "unavailable";
    }
    if (loading || !closestCenter) return "loading";
    if (driversLoading || driversSourceStatus === "loading") return "loading";
    if (driversSourceStatus === "unavailable") return "unavailable";
    if (etaMinutes != null) return "ready";
    return "empty";
  })();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "web" ? 34 : 16) + 8;

  const pickupLabelText = resolving
    ? t("riderHome.locating")
    : pinAddress || (loading
        ? t("riderHome.findingLocation")
        : error === "permission"
        ? t("riderHome.locationDenied")
        : t("riderHome.moveMapSetPickup"));

  return (
    <View style={{ flex: 1 }}>
      <View style={StyleSheet.absoluteFill}>
        <AppMap
          ref={mapRef}
          pickup={pinCenter}
          centerPin
          onCenterChange={handleCenterChange}
          fit={false}
          drivers={nearbyDrivers}
        />
      </View>

      <View style={[StyleSheet.absoluteFill, styles.pinOverlay]} pointerEvents="none">
        <View style={styles.pinStack}>
          <View style={{ alignItems: "center" }}>
            <Animated.View
              style={[
                styles.pickupLabel,
                {
                  opacity: addressFade,
                  transform: [{ translateY: addressTranslate }],
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickupLabelHint, { fontFamily: fonts.regular }]}>{t("riderHome.pickupPoint")}</Text>
                <Text style={[styles.pickupLabelText, { fontFamily: fonts.semiBold }]} numberOfLines={2}>
                  {pickupLabelText}
                </Text>
              </View>
              <View style={styles.pickupLabelArrow}>
                {resolving ? (
                  <ActivityIndicator size="small" color="#555" />
                ) : (
                  <Feather name={isRTL ? "chevron-left" : "chevron-right"} size={14} color="#555" />
                )}
              </View>
            </Animated.View>
            <View style={styles.pickupLabelCaret} />
          </View>
          <View style={{ height: 16 }} />
          <Animated.View style={{ transform: [{ scale: pinScale }] }}>
            <ClosestDriverPin
              status={closestPinStatus}
              etaMinutes={etaMinutes ?? undefined}
            />
          </Animated.View>
        </View>
      </View>

      <View
        pointerEvents="none"
        style={[styles.driverLoadingWrap, { top: insets.top + 68 }]}
      >
        <DriverLoadingBadge visible={driversLoading} />
      </View>

      <View style={[styles.topRow, { top: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.push("/profile")}
          style={[styles.floatBtn, { backgroundColor: "#fff" }]}
        >
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.hamburgerLine} />
          ))}
        </Pressable>
      </View>

      <Pressable
        onPress={handleRecenter}
        style={[styles.floatBtn, styles.recenterBtn, { backgroundColor: "#fff" }]}
      >
        <Feather name="navigation" size={18} color={location ? "#3819A6" : "#aaa"} />
      </Pressable>

      <View style={[styles.card, { backgroundColor: "#fff", paddingBottom: bottomPad }]}>
        <Pressable
          onPressIn={() => {
            Animated.spring(handleScale, {
              toValue: 1.4,
              useNativeDriver: true,
              speed: 30,
              bounciness: 10,
            }).start();
            if (Platform.OS !== "web") {
              Haptics.selectionAsync().catch(() => {});
            }
          }}
          onPressOut={() => {
            Animated.spring(handleScale, {
              toValue: 1,
              useNativeDriver: true,
              speed: 20,
              bounciness: 8,
            }).start();
          }}
          hitSlop={12}
          style={styles.handleHit}
        >
          <Animated.View
            style={[
              styles.handle,
              { backgroundColor: "#D8D8D8", transform: [{ scaleX: handleScale }] },
            ]}
          />
        </Pressable>

        <ClosestDriverEtaBadge
          status={closestPinStatus}
          etaMinutes={etaMinutes ?? undefined}
        />

        <QuickBookChips
          savedPlaces={savedPlaces}
          onBookFavorite={handleBookToPlace}
          onAddFavorite={(key, defaultLabel) => {
            const pickupLat = pinCenter?.lat ?? location?.lat;
            const pickupLng = pinCenter?.lng ?? location?.lng;
            const pickupAddr = pinAddress || location?.address || "";
            if (pickupLat != null && pickupLng != null) {
              pickupStore.set({
                label: pickupAddr.split(",")[0] || "Pickup",
                address: pickupAddr,
                lat: pickupLat,
                lng: pickupLng,
              });
            }
            router.push({
              pathname: "/(rider)/destination",
              params: { saveLabel: defaultLabel },
            });
          }}
          onEditFavorite={handleEditFavorite}
          onDeleteFavorite={handleDeleteFavorite}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.vehicleRow}
          style={{ marginBottom: 16 }}
          decelerationRate="fast"
          snapToInterval={VEHICLE_ITEM_WIDTH}
          snapToAlignment="center"
        >
          {vehicleTypesLoading
            ? [0, 1, 2].map((i) => (
                <View key={`skeleton-${i}`} style={styles.vehicleItemSkeleton}>
                  <View style={styles.vehicleIconSkeleton} />
                  <View style={styles.vehicleLabelSkeleton} />
                </View>
              ))
            : vehicleTypes.map((v) => {
                const active = selectedVehicleId
                  ? selectedVehicleId === v.id
                  : false;
                const badges: string[] = [];
                if (v.poolEnabled) badges.push("👥");
                if (v.wheelchairAccess) badges.push("♿");
                if (v.petFriendly) badges.push("🐾");
                if (v.assistAvailable) badges.push("✋");
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => setSelectedVehicleId(v.id)}
                    style={[styles.vehicleItem, active && styles.vehicleItemActive]}
                  >
                    <VehicleIcon type={v} />
                    <Text style={[styles.vehicleLabel, { color: active ? "#1A73E8" : "#444", fontFamily: fonts.semiBold }]}>
                      {v.name}
                    </Text>
                    {badges.length > 0 ? (
                      <Text style={[styles.capabilityRow, { fontFamily: fonts.medium }]}>
                        {badges.join(" ")}
                      </Text>
                    ) : nearbyCount > 0 ? (
                      <Text style={[styles.driverCountText, { fontFamily: fonts.regular }]}>👤 {nearbyCount}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
          <View style={styles.vehicleMore}>
            <Feather name={isRTL ? "chevron-left" : "chevron-right"} size={20} color="#999" />
          </View>
        </ScrollView>

        <View style={styles.searchRow}>
          <Pressable onPress={handleSearchPress} style={[styles.searchBar, { flex: 1 }]}>
            <Feather name="search" size={18} color="#555" />
            <Text style={[styles.searchBarText, { fontFamily: fonts.medium }]}>{t("riderHome.whereToAndHowMuch")}</Text>
            {busyDest && (
              <ActivityIndicator size="small" color="#3819A6" style={{ marginStart: 8 }} />
            )}
          </Pressable>
          <Pressable
            onPress={() => setShowVoice(true)}
            style={styles.micBtn}
            accessibilityLabel={t("riderHome.voiceBook", { defaultValue: "Voice booking" })}
          >
            <Feather name="mic" size={20} color="#3819A6" />
          </Pressable>
        </View>
      </View>

      <VoiceBookingSheet
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        onConfirm={(place) => {
          setShowVoice(false);
          handleBookToPlace(place);
        }}
      />

      {undoPlace && (
        <Animated.View
          style={[
            styles.snackbar,
            { bottom: bottomPad + 80, opacity: undoFade },
          ]}
          pointerEvents="box-none"
        >
          <Text style={[styles.snackbarText, { fontFamily: fonts.regular }]} numberOfLines={1}>
            {t("riderHome.placeRemoved", {
              defaultValue: "{{label}} removed",
              label: undoPlace.label,
            })}
          </Text>
          <Pressable onPress={handleUndoDelete} hitSlop={10}>
            <Text style={[styles.snackbarUndo, { fontFamily: fonts.semiBold }]}>
              {t("common.undo", { defaultValue: "Undo" })}
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 5,
  },
  floatBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  hamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: "#333",
    borderRadius: 2,
    marginVertical: 2,
  },
  recenterBtn: {
    position: "absolute",
    bottom: 300,
    end: 16,
    zIndex: 5,
  },
  pinOverlay: {
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  pinStack: {
    alignItems: "center",
  },
  pickupLabel: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    minWidth: 220,
    maxWidth: 300,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pickupLabelHint: {
    fontSize: 11,
    color: "#999",
    marginBottom: 2,
  },
  pickupLabelText: {
    fontSize: 14,
    color: "#111",
    lineHeight: 20,
  },
  pickupLabelArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pickupLabelCaret: {
    alignSelf: "center",
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#fff",
    marginTop: -1,
  },
  card: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
    zIndex: 20,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  vehicleItem: {
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    paddingTop: 14,
    borderRadius: 16,
    width: VEHICLE_ITEM_WIDTH,
    position: "relative",
  },
  vehicleItemActive: {
    backgroundColor: "#EEF1FB",
    borderWidth: 1,
    borderColor: "#D6DCF2",
  },
  vehicleIcon: {
    width: VEHICLE_ICON_SIZE,
    height: VEHICLE_ICON_SIZE,
    marginBottom: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleIconImage: { width: VEHICLE_ICON_SIZE, height: VEHICLE_ICON_SIZE },
  vehicleLabel: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
    marginBottom: 2,
  },
  driverCountText: {
    fontSize: 10,
    color: "#999",
  },
  capabilityRow: {
    fontSize: 11,
    color: "#666",
    letterSpacing: 0.5,
  },
  vehicleMore: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleItemSkeleton: {
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingTop: 14,
    borderRadius: 14,
    minWidth: 76,
  },
  vehicleIconSkeleton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#E8E8E8",
    marginBottom: 8,
  },
  vehicleLabelSkeleton: {
    width: 36,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#E8E8E8",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F4F5F8",
    borderRadius: 32,
    paddingHorizontal: 22,
    paddingVertical: 18,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  micBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#EEF1FB",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    flexShrink: 0,
  },
  searchBarText: {
    flex: 1,
    fontSize: 16,
    color: "#555",
    letterSpacing: -0.1,
  },
  handleHit: {
    alignSelf: "center",
    paddingVertical: 6,
    marginTop: -4,
  },
  driverLoadingWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 6,
  },
  snackbar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    zIndex: 30,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  snackbarText: {
    flex: 1,
    fontSize: 14,
    color: "#fff",
  },
  snackbarUndo: {
    fontSize: 14,
    color: "#60A5FA",
  },
});
