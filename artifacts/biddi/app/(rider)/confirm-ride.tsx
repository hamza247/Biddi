import { Feather } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTranslation } from "react-i18next";

import { AppMap } from "@/components/AppMap";
import { ClosestDriverPin, type ClosestDriverPinStatus } from "@/components/ClosestDriverPin";
import { Sheet } from "@/components/Sheet";
import { useRide } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { closestDriverEtaMinutes, useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import {
  useAvailableVehicleTypes,
  type RemoteVehicleType,
} from "@/hooks/useVehicleTypes";
import {
  useFareEstimates,
  type FareBreakdown,
} from "@/hooks/useFareEstimate";
import { useCurrentLocation } from "@/lib/location";
import { api, ApiError } from "@/lib/api";
import { useConfig, type PublicConfig } from "@/lib/config";
import { formatDisplayAmount, formatUsdAmount } from "@/lib/formatCurrency";

interface AppliedCoupon {
  couponId: string;
  code: string;
  discount: number;
}

/** Per-classKey multiplier used to anchor the recommended fare. Backend
 *  categories don't currently expose a multiplier so we derive one from the
 *  classKey when available, defaulting to 1.0 for new tiers. */
const CLASS_MULTIPLIER: Record<string, number> = {
  ride: 1.0,
  comfort: 1.25,
  moto: 0.75,
};

const FALLBACK_TYPES: RemoteVehicleType[] = [
  { id: "fallback-ride",    name: "Ride",    classKey: "ride",    classLabel: null, classColorHex: null, iconUrl: null, active: true, displayOrder: 0 },
  { id: "fallback-comfort", name: "Comfort", classKey: "comfort", classLabel: null, classColorHex: null, iconUrl: null, active: true, displayOrder: 1 },
  { id: "fallback-moto",    name: "Moto",    classKey: "moto",    classLabel: null, classColorHex: null, iconUrl: null, active: true, displayOrder: 2 },
];

function multiplierFor(t: RemoteVehicleType): number {
  if (t.classKey && CLASS_MULTIPLIER[t.classKey] != null) {
    return CLASS_MULTIPLIER[t.classKey];
  }
  return 1.0;
}

function fallbackIcon(t: RemoteVehicleType): React.ComponentProps<typeof Feather>["name"] {
  if (t.classKey === "moto" || t.vehicleCategory === "moto") return "zap";
  if (t.wheelchairAccess) return "user-check";
  if (t.poolEnabled) return "users";
  if (t.classKey === "comfort") return "star";
  return "navigation";
}

function ClassCard({
  opt,
  active,
  c,
  fonts,
  price,
  badges,
  cfg,
  onPress,
}: {
  opt: RemoteVehicleType;
  active: boolean;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
  price: number;
  badges: string[];
  cfg: PublicConfig;
  onPress: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    setIconFailed(false);
  }, [opt.iconUrl]);
  const showImage = !!opt.iconUrl && !iconFailed;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.classCard,
        {
          backgroundColor: active ? c.primarySoft : c.surface,
          borderColor: active ? c.primary : c.border,
        },
      ]}
    >
      <View
        style={[
          styles.classIcon,
          {
            backgroundColor: showImage
              ? "transparent"
              : opt.classColorHex
                ? opt.classColorHex + "33"
                : active ? c.primary : c.background,
          },
        ]}
      >
        {showImage ? (
          <ExpoImage
            source={{ uri: opt.iconUrl as string }}
            style={{ width: 36, height: 36 }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Feather
            name={fallbackIcon(opt)}
            size={18}
            color={opt.classColorHex ?? (active ? c.primaryForeground : c.foreground)}
          />
        )}
      </View>
      <Text
        style={[
          styles.className,
          { color: active ? c.primary : c.foreground, fontFamily: fonts.semiBold },
        ]}
        numberOfLines={1}
      >
        {opt.name}
      </Text>
      {opt.classLabel ? (
        <View
          style={[
            styles.classKeyPill,
            {
              backgroundColor: opt.classColorHex ? opt.classColorHex + "22" : c.surface,
              borderColor: opt.classColorHex ?? c.border,
            },
          ]}
        >
          <Text
            style={[
              styles.classKeyText,
              { color: opt.classColorHex ?? c.mutedForeground, fontFamily: fonts.medium },
            ]}
            numberOfLines={1}
          >
            {opt.classLabel}
          </Text>
        </View>
      ) : null}
      <Text
        style={[styles.classPrice, { color: c.foreground, fontFamily: fonts.bold }]}
        numberOfLines={1}
      >
        {formatUsdAmount(price, cfg)}
      </Text>
      {badges.length > 0 && (
        <Text style={styles.classBadges} numberOfLines={1}>
          {badges.join(" ")}
        </Text>
      )}
    </Pressable>
  );
}

export default function ConfirmRideScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const { pendingRide, requestRide, clearPendingRide } = useRide();
  const { error: locationError } = useCurrentLocation();
  const cfg = useConfig();

  // If we landed here without a composed ride, bounce back to the entry
  // screen instead of rendering a broken state.
  useEffect(() => {
    if (!pendingRide) router.replace("/(rider)/home");
  }, [pendingRide, router]);

  const { location } = useCurrentLocation();
  const { types: remoteTypes, loading: typesLoading, error: typesError } = useAvailableVehicleTypes(
    pendingRide?.pickup.lat ?? location?.lat,
    pendingRide?.pickup.lng ?? location?.lng,
  );
  // While loading, keep the list empty so a skeleton is shown instead of
  // the hardcoded fallbacks. FALLBACK_TYPES are only substituted after both
  // the geo-filtered and location-free retries have completed with a network
  // error — distinguishing "API unreachable" from "no types configured".
  const types: RemoteVehicleType[] = typesLoading
    ? []
    : remoteTypes.length > 0
      ? remoteTypes
      : typesError
        ? FALLBACK_TYPES
        : [];

  const [vehicleTypeId, setVehicleTypeId] = useState<string | null>(null);
  const [autoAccept, setAutoAccept] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [scrollViewHeight, setScrollViewHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Optional capability requests. Each is gated on the chosen category
  // actually offering it — we hide the toggle when not supported and reset
  // it when the user switches to a category that doesn't support it.
  const [isShared, setIsShared] = useState(false);
  const [seatsRequested, setSeatsRequested] = useState(1);
  const [wheelchairRequested, setWheelchairRequested] = useState(false);
  const [petRequested, setPetRequested] = useState(false);
  const [assistRequested, setAssistRequested] = useState(false);
  // Optional rider-applied coupon. Validated against the server before being
  // attached so the rider sees the same outcome the booking POST will see.
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponSheetOpen, setCouponSheetOpen] = useState(false);

  // Pick a default once the type list arrives. Prefers the previous
  // selection if it's still available, otherwise the first card.
  useEffect(() => {
    if (types.length === 0) return;
    if (vehicleTypeId && types.some((t) => t.id === vehicleTypeId)) return;
    setVehicleTypeId(types[0].id);
  }, [types, vehicleTypeId]);

  const selectedType: RemoteVehicleType | null = useMemo(
    () => types.find((t) => t.id === vehicleTypeId) ?? null,
    [types, vehicleTypeId],
  );

  // Fetch server-computed fare estimates for all available vehicle types.
  const vehicleTypeIds = useMemo(() => types.map((t) => t.id), [types]);
  const { estimates, error: estimateError } = useFareEstimates(
    vehicleTypeIds,
    pendingRide?.estimatedDistanceKm ?? 0,
    pendingRide?.estimatedDurationMin ?? 0,
    pendingRide?.pickup.lat,
    pendingRide?.pickup.lng,
  );

  // Drop any capability flags the new category doesn't offer, so we never
  // submit a request the backend will silently strip.
  useEffect(() => {
    if (!selectedType) return;
    if (!selectedType.poolEnabled && isShared) setIsShared(false);
    if (!selectedType.wheelchairAccess && wheelchairRequested) setWheelchairRequested(false);
    if (!selectedType.petFriendly && petRequested) setPetRequested(false);
    if (!selectedType.assistAvailable && assistRequested) setAssistRequested(false);
    const cap = selectedType.personCapacity ?? 4;
    if (seatsRequested > cap) setSeatsRequested(cap);
  }, [selectedType, isShared, wheelchairRequested, petRequested, assistRequested, seatsRequested]);

  // Recommended fare per class. Use the server-computed estimate when
  // available; fall back to the multiplier-anchored suggestion so the screen
  // never shows zero while the API round-trip is in flight.
  const recommended = useMemo(() => {
    if (!pendingRide) return 0;
    const serverTotal = vehicleTypeId ? estimates[vehicleTypeId]?.total : undefined;
    if (serverTotal != null && serverTotal > 0) return Math.round(serverTotal);
    const m = selectedType ? multiplierFor(selectedType) : 1.0;
    return Math.max(5, Math.round(pendingRide.suggestedFare * m));
  }, [pendingRide, selectedType, vehicleTypeId, estimates]);

  const [fare, setFare] = useState<number>(0);
  // Reset the rider's offer to the recommended amount whenever the route or
  // vehicle class changes — riders almost always want to start near the
  // anchor and tweak from there rather than carry over a stale number.
  useEffect(() => {
    setFare(recommended);
  }, [recommended]);

  // Compute pickup coord up front so the closest-driver hooks below run
  // unconditionally and don't violate the Rules of Hooks when pendingRide
  // is briefly null (e.g. after cancel() before navigation completes).
  const pickupCoord =
    pendingRide?.pickup.lat !== undefined && pendingRide?.pickup.lng !== undefined
      ? { lat: pendingRide.pickup.lat, lng: pendingRide.pickup.lng }
      : null;
  const dropoffCoord =
    pendingRide?.dropoff.lat !== undefined && pendingRide?.dropoff.lng !== undefined
      ? { lat: pendingRide.dropoff.lat, lng: pendingRide.dropoff.lng }
      : null;

  // Same closest-driver ETA pipeline as the home screen, anchored to the
  // chosen pickup so the rider can see how long the wait will be while
  // tweaking vehicle class and fare. Must be called before any early
  // return to keep hook ordering stable across renders.
  const {
    drivers: nearbyDrivers,
    loading: driversLoading,
    sourceStatus: driversSourceStatus,
  } = useNearbyDrivers(pickupCoord);
  // Filter by the selected vehicle category so the ETA reflects drivers
  // that can actually fulfill the booking — matches the home screen's
  // semantics where the ETA tracks the chosen class.
  const selectedCategory = selectedType?.vehicleCategory ?? null;
  const etaDrivers = selectedCategory
    ? nearbyDrivers.filter((d) => d.vehicleCategory === selectedCategory)
    : nearbyDrivers;
  const driverEtaMinutes = closestDriverEtaMinutes(pickupCoord, etaDrivers);
  const driverPinStatus: ClosestDriverPinStatus = (() => {
    if (locationError === "permission" || locationError === "unknown" || locationError === "timeout") {
      if (!pickupCoord) return "unavailable";
    }
    if (!pickupCoord) return "loading";
    if (driversLoading || driversSourceStatus === "loading") return "loading";
    if (driversSourceStatus === "unavailable") return "unavailable";
    if (driverEtaMinutes != null) return "ready";
    return "empty";
  })();

  if (!pendingRide) return null;

  const showScrollHint =
    contentHeight > scrollViewHeight + 4 &&
    scrollOffset + scrollViewHeight < contentHeight - 20;

  const step = recommended >= 100 ? 5 : 1;
  const minFare = Math.max(5, Math.round(recommended * 0.6));
  const maxFare = Math.max(minFare + 1, Math.round(recommended * 2));

  const adjust = (delta: number) =>
    setFare((v) => Math.min(maxFare, Math.max(minFare, v + delta)));

  const submit = async () => {
    if (submitting) return;
    if (fare <= 0) return;
    setSubmitting(true);
    setBookingError(null);
    try {
      await requestRide(pendingRide.pickup, pendingRide.dropoff, {
        initialFare: fare,
        vehicleClass: selectedType?.classKey ?? undefined,
        // Only send the type id if it's a real DB row — fallback ids are
        // synthetic and would 404 the lookup.
        vehicleTypeId:
          selectedType && !selectedType.id.startsWith("fallback-")
            ? selectedType.id
            : undefined,
        isShared,
        seatsRequested,
        wheelchairRequested,
        petRequested,
        assistRequested,
        couponId: appliedCoupon?.couponId,
      });
      router.replace("/(rider)/bidding");
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.message === "pickup_restricted") {
          setBookingError(t("confirmRide.pickupRestricted"));
        } else if (err.message === "dropoff_restricted") {
          setBookingError(t("confirmRide.dropoffRestricted"));
        } else {
          setBookingError(t("confirmRide.somethingWentWrong"));
        }
      } else {
        setBookingError(t("confirmRide.somethingWentWrong"));
      }
    }
  };

  const cancel = () => {
    clearPendingRide();
    router.replace("/(rider)/home");
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Map fills the area above the sheet so the route is the visual anchor. */}
      <AppMap
        pickup={pickupCoord}
        dropoff={dropoffCoord}
        routePolyline={pendingRide.routePolyline ?? undefined}
        fit
      />

      {/* Top-left back button only — header pills sit on the sheet itself. */}
      <Pressable
        accessibilityLabel="Back"
        onPress={cancel}
        style={[
          styles.backBtn,
          { top: insets.top + 12, backgroundColor: c.background },
        ]}
      >
        <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={20} color={c.foreground} />
      </Pressable>

      {/* Closest-driver ETA pin — same component / state machine the rider
          sees on the home screen, so it stays consistent while they're
          choosing a vehicle and fare. */}
      <View
        pointerEvents="none"
        style={[styles.driverPinSlot, { top: insets.top + 12 }]}
      >
        <ClosestDriverPin
          status={driverPinStatus}
          etaMinutes={driverEtaMinutes ?? undefined}
        />
      </View>

      <View style={{ flex: 1 }} />

      <Sheet>
        <View style={{ position: "relative" }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          style={{ maxHeight: Dimensions.get("window").height * 0.62 }}
          contentContainerStyle={{ paddingBottom: 8 }}
          onLayout={(e) => setScrollViewHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => setContentHeight(h)}
          onScroll={(e) => setScrollOffset(e.nativeEvent.contentOffset.y)}
        >
        {locationError === "timeout" && !pickupCoord && (
          <View style={[styles.locationWarning, { backgroundColor: "#FFF3CD", borderColor: "#FBBF24" }]}>
            <Feather name="alert-triangle" size={15} color="#B45309" />
            <Text style={[styles.locationWarningText, { fontFamily: fonts.medium }]}>
              {t("confirmRide.locationWarning")}
            </Text>
          </View>
        )}

        {/* Stacked address pills: tappable so the rider can re-pick on map. */}
        <View style={styles.addressBlock}>
          <AddressPill
            color={c.pickupGreen}
            label={pendingRide.pickup.label || t("confirmRide.pickup")}
            address={pendingRide.pickup.address}
            etaMin={Math.max(1, Math.round(pendingRide.estimatedDurationMin * 0.15))}
            onPress={() =>
              router.push({
                pathname: "/(rider)/pick-on-map",
                params: { role: "pickup" },
              })
            }
          />
          <View style={[styles.connector, { backgroundColor: c.border }]} />
          <AddressPill
            color={c.dropoffRed}
            squareDot
            label={pendingRide.dropoff.label || t("confirmRide.dropoff")}
            address={pendingRide.dropoff.address}
            etaMin={pendingRide.estimatedDurationMin}
            onPress={() =>
              router.push({
                pathname: "/(rider)/pick-on-map",
                params: { role: "dropoff" },
              })
            }
          />
          {/* Add-stop button styled like inDrive's "+" icon. Functional
              support for multi-stop is a follow-up; this is UI only. */}
          <Pressable
            accessibilityLabel="Add stop (coming soon)"
            disabled
            style={[styles.addStop, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Feather name="plus" size={18} color={c.mutedForeground} />
          </Pressable>
        </View>

        {/* Promo banner — opens a bottom sheet to enter/validate a code. */}
        <Pressable
          accessibilityLabel="Promo code"
          onPress={() => setCouponSheetOpen(true)}
          style={[styles.promo, { backgroundColor: c.primarySoft }]}
        >
          <Feather name="gift" size={16} color={c.primary} />
          {appliedCoupon ? (
            <View style={{ flex: 1 }}>
              <Text style={[styles.promoText, { color: c.primary, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                {t("confirmRide.couponApplied", { code: appliedCoupon.code })}
              </Text>
              <Text style={[{ fontSize: 11, color: c.primary, fontFamily: fonts.medium }]} numberOfLines={1}>
                {t("confirmRide.couponDiscount", {
                  amount: formatUsdAmount(appliedCoupon.discount, cfg),
                })}
              </Text>
            </View>
          ) : (
            <Text style={[styles.promoText, { color: c.primary, fontFamily: fonts.semiBold }]}>
              {t("confirmRide.addPromoCode")}
            </Text>
          )}
          <Feather
            name={fonts.isRTL ? "chevron-left" : "chevron-right"}
            size={16}
            color={c.primary}
            style={{ marginStart: "auto" }}
          />
        </Pressable>

        <CouponSheet
          open={couponSheetOpen}
          onClose={() => setCouponSheetOpen(false)}
          applied={appliedCoupon}
          onApply={(c) => {
            setAppliedCoupon(c);
            setCouponSheetOpen(false);
          }}
          onRemove={() => {
            setAppliedCoupon(null);
            setCouponSheetOpen(false);
          }}
          vehicleTypeId={
            selectedType && !selectedType.id.startsWith("fallback-")
              ? selectedType.id
              : null
          }
          vehicleClass={selectedType?.classKey ?? null}
          estimatedDistanceKm={pendingRide.estimatedDistanceKm}
          estimatedDurationMin={pendingRide.estimatedDurationMin}
          estimatedSubtotal={vehicleTypeId ? estimates[vehicleTypeId]?.total : undefined}
        />
        {/* Re-validate the existing coupon whenever the selected service /
            estimate changes so an applied promo doesn't silently become
            invalid (e.g. category restriction). */}
        <CouponRevalidator
          couponId={appliedCoupon?.couponId ?? null}
          code={appliedCoupon?.code ?? null}
          vehicleTypeId={
            selectedType && !selectedType.id.startsWith("fallback-")
              ? selectedType.id
              : null
          }
          vehicleClass={selectedType?.classKey ?? null}
          estimatedDistanceKm={pendingRide.estimatedDistanceKm}
          estimatedDurationMin={pendingRide.estimatedDurationMin}
          estimatedSubtotal={vehicleTypeId ? estimates[vehicleTypeId]?.total : undefined}
          onUpdate={(next) => setAppliedCoupon(next)}
          onInvalid={() => setAppliedCoupon(null)}
        />

        {/* Vehicle class selector — horizontal scroll so we don't crowd the
            sheet when the operator enables several categories. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.classRow}
        >
          {types.map((opt) => {
            const active = opt.id === vehicleTypeId;
            const serverEst = estimates[opt.id]?.total;
            const price = serverEst != null && serverEst > 0
              ? Math.round(serverEst)
              : Math.max(5, Math.round(pendingRide.suggestedFare * multiplierFor(opt)));
            const badges: string[] = [];
            if (opt.poolEnabled) badges.push("👥");
            if (opt.wheelchairAccess) badges.push("♿");
            if (opt.petFriendly) badges.push("🐾");
            if (opt.assistAvailable) badges.push("✋");
            return (
              <ClassCard
                key={opt.id}
                opt={opt}
                active={active}
                c={c}
                fonts={fonts}
                price={price}
                badges={badges}
                cfg={cfg}
                onPress={() => setVehicleTypeId(opt.id)}
              />
            );
          })}
          {typesLoading && [0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.classCard, { backgroundColor: c.surface, borderColor: c.border, opacity: 1 - i * 0.15 }]}
            >
              <View style={[styles.classIcon, { backgroundColor: c.border }]} />
              <View style={{ width: 52, height: 10, borderRadius: 5, backgroundColor: c.border, marginTop: 2 }} />
              <View style={{ width: 36, height: 10, borderRadius: 5, backgroundColor: c.border, marginTop: 2 }} />
            </View>
          ))}
        </ScrollView>

        {/* Fare breakdown for the selected vehicle type — updates whenever
            the rider changes class or the route changes. */}
        {vehicleTypeId && estimates[vehicleTypeId] && (
          <FareBreakdownPanel breakdown={estimates[vehicleTypeId]} c={c} cfg={cfg} />
        )}
        {estimateError && !estimates[vehicleTypeId ?? ""] && (
          <Text style={[styles.estimateUnavailable, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {t("confirmRide.estimateUnavailable")}
          </Text>
        )}

        {/* Capability options — only the toggles supported by the chosen
            category are shown so the rider never picks something the
            operator hasn't enabled. */}
        {selectedType && (
          (selectedType.poolEnabled ||
            selectedType.wheelchairAccess ||
            selectedType.petFriendly ||
            selectedType.assistAvailable ||
            (selectedType.personCapacity ?? 0) > 1) && (
            <View style={[styles.optionsBlock, { borderColor: c.border }]}>
              {selectedType.poolEnabled && (
                <ToggleRow
                  icon="users"
                  label={t("confirmRide.shareRide")}
                  hint={t("confirmRide.shareRideHint")}
                  value={isShared}
                  onChange={setIsShared}
                  c={c}
                />
              )}
              {(selectedType.personCapacity ?? 0) > 1 && (
                <SeatsRow
                  value={seatsRequested}
                  max={selectedType.personCapacity ?? 4}
                  onChange={setSeatsRequested}
                  c={c}
                />
              )}
              {selectedType.wheelchairAccess && (
                <ToggleRow
                  icon="user-check"
                  label={t("confirmRide.wheelchairAccessible")}
                  value={wheelchairRequested}
                  onChange={setWheelchairRequested}
                  c={c}
                />
              )}
              {selectedType.petFriendly && (
                <ToggleRow
                  icon="heart"
                  label={t("confirmRide.withPet")}
                  value={petRequested}
                  onChange={setPetRequested}
                  c={c}
                />
              )}
              {selectedType.assistAvailable && (
                <ToggleRow
                  icon="help-circle"
                  label={t("confirmRide.driverAssistance")}
                  hint={t("confirmRide.driverAssistanceHint")}
                  value={assistRequested}
                  onChange={setAssistRequested}
                  c={c}
                />
              )}
            </View>
          )
        )}

        {/* Fare picker: −/+ around the rider's offered amount. */}
        <View style={[styles.fareRow, { backgroundColor: c.surface }]}>
          <Pressable
            accessibilityLabel="Lower fare"
            onPress={() => adjust(-step)}
            style={[styles.fareBtn, { borderColor: c.border }]}
          >
            <Feather name="minus" size={20} color={c.foreground} />
          </Pressable>
          <View style={styles.fareCenter}>
            <Text style={[styles.fareLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
              {t("confirmRide.yourOffer")}
            </Text>
            <Text style={[styles.fareValue, { color: c.foreground, fontFamily: fonts.bold }]}>
              {formatUsdAmount(fare, cfg)}
            </Text>
            <Text style={[styles.fareHint, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("confirmRide.recommended")} {formatUsdAmount(recommended, cfg)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Raise fare"
            onPress={() => adjust(step)}
            style={[styles.fareBtn, { borderColor: c.border }]}
          >
            <Feather name="plus" size={20} color={c.foreground} />
          </Pressable>
        </View>

        {/* Auto-accept toggle (UI only — bidding screen will surface bids). */}
        <View style={styles.autoRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.autoTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
              {t("confirmRide.autoAcceptTitle")}
            </Text>
            <Text style={[styles.autoSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {t("confirmRide.autoAcceptSub")}
            </Text>
          </View>
          <Switch
            value={autoAccept}
            onValueChange={setAutoAccept}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor={Platform.OS === "android" ? "#fff" : undefined}
          />
        </View>

        </ScrollView>
        {showScrollHint && (
          <LinearGradient
            colors={[c.background + "00", c.background]}
            style={styles.scrollFadeHint}
            pointerEvents="none"
          />
        )}
        </View>

        {bookingError && (
          <View style={[styles.bookingErrorBanner, { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" }]}>
            <Feather name="alert-circle" size={15} color="#B91C1C" />
            <Text style={[styles.bookingErrorText, { color: "#B91C1C", fontFamily: fonts.medium }]}>{bookingError}</Text>
          </View>
        )}

        {/* Lime CTA — pinned at the bottom, always tappable. */}
        <View style={[styles.ctaWrapper, { borderTopColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={submitting || fare <= 0}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: c.cta,
              opacity: submitting || fare <= 0 ? 0.6 : pressed ? 0.92 : 1,
              transform: [{ scale: pressed && !submitting && fare > 0 ? 0.985 : 1 }],
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={c.ctaForeground} />
          ) : (
            <Text style={[styles.ctaLabel, { color: c.ctaForeground, fontFamily: fonts.bold }]}>
              {t("confirmRide.findDriver")}
            </Text>
          )}
        </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  value,
  onChange,
  c,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  c: ReturnType<typeof useColors>;
}) {
  const fonts = useFontFamily();
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.optionRow}>
      <View style={[styles.optionIconWrap, { backgroundColor: c.background }]}>
        <Feather name={icon} size={16} color={c.foreground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.optionHint, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: c.border, true: c.primary }}
      />
    </Pressable>
  );
}

function SeatsRow({
  value,
  max,
  onChange,
  c,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  c: ReturnType<typeof useColors>;
}) {
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const dec = () => onChange(Math.max(1, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View style={styles.optionRow}>
      <View style={[styles.optionIconWrap, { backgroundColor: c.background }]}>
        <Feather name="user" size={16} color={c.foreground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("confirmRide.seats")}</Text>
        <Text style={[styles.optionHint, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
          {t("confirmRide.upToRiders", { max })}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Fewer seats"
        onPress={dec}
        style={[styles.seatsBtn, { borderColor: c.border }]}
      >
        <Feather name="minus" size={16} color={c.foreground} />
      </Pressable>
      <Text style={[styles.seatsValue, { color: c.foreground, fontFamily: fonts.bold }]}>{value}</Text>
      <Pressable
        accessibilityLabel="More seats"
        onPress={inc}
        style={[styles.seatsBtn, { borderColor: c.border }]}
      >
        <Feather name="plus" size={16} color={c.foreground} />
      </Pressable>
    </View>
  );
}

function FareBreakdownPanel({
  breakdown,
  c,
  cfg,
}: {
  breakdown: FareBreakdown;
  c: ReturnType<typeof useColors>;
  cfg: PublicConfig;
}) {
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const hasPeak = breakdown.peakSurcharge > 0;
  const hasNight = breakdown.nightSurcharge > 0;
  const hasWeather = (breakdown.weatherSurcharge ?? 0) > 0;
  const hasLines = hasPeak || hasNight || hasWeather || breakdown.minimumApplied;

  return (
    <View
      style={[
        styles.breakdownPanel,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      <View style={styles.breakdownRow}>
        <Text style={[styles.breakdownLabel, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
          {t("confirmRide.baseFare")}
        </Text>
        <Text style={[styles.breakdownValue, { color: c.foreground, fontFamily: fonts.medium }]}>
          {formatUsdAmount(breakdown.base, cfg)}
        </Text>
      </View>
      <View style={styles.breakdownRow}>
        <Text style={[styles.breakdownLabel, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
          {t("confirmRide.distance", { km: breakdown.distanceKm.toFixed(1), amount: formatUsdAmount(breakdown.pricePerKm, cfg) })}
        </Text>
        <Text style={[styles.breakdownValue, { color: c.foreground, fontFamily: fonts.medium }]}>
          {formatUsdAmount(breakdown.distance, cfg)}
        </Text>
      </View>
      {breakdown.pricePerMin > 0 && (
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownLabel, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {t("confirmRide.time", { min: breakdown.durationMin, amount: formatUsdAmount(breakdown.pricePerMin, cfg) })}
          </Text>
          <Text style={[styles.breakdownValue, { color: c.foreground, fontFamily: fonts.medium }]}>
            {formatUsdAmount(breakdown.time, cfg)}
          </Text>
        </View>
      )}
      {hasPeak && (
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownLabel, { color: "#B45309", fontFamily: fonts.regular }]}>
            {t("confirmRide.peakSurcharge", { mult: breakdown.peakMultiplier.toFixed(2) })}
          </Text>
          <Text style={[styles.breakdownValue, { color: "#B45309", fontFamily: fonts.medium }]}>
            +{formatUsdAmount(breakdown.peakSurcharge, cfg)}
          </Text>
        </View>
      )}
      {hasNight && (
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownLabel, { color: "#4F46E5", fontFamily: fonts.regular }]}>
            {t("confirmRide.nightSurcharge", { mult: breakdown.nightMultiplier.toFixed(2) })}
          </Text>
          <Text style={[styles.breakdownValue, { color: "#4F46E5", fontFamily: fonts.medium }]}>
            +{formatUsdAmount(breakdown.nightSurcharge, cfg)}
          </Text>
        </View>
      )}
      {hasWeather && (
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownLabel, { color: "#0E7490", fontFamily: fonts.regular }]}>
            {t("confirmRide.weatherSurcharge", {
              reason: breakdown.weatherReason
                ? t(`confirmRide.weatherReason.${breakdown.weatherReason}`, {
                    defaultValue: breakdown.weatherReason,
                  })
                : "",
            })}
          </Text>
          <Text style={[styles.breakdownValue, { color: "#0E7490", fontFamily: fonts.medium }]}>
            +{formatUsdAmount(breakdown.weatherSurcharge ?? 0, cfg)}
          </Text>
        </View>
      )}
      {breakdown.minimumApplied && (
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownLabel, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {t("confirmRide.minimumFareApplied")}
          </Text>
          <Text style={[styles.breakdownValue, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {formatUsdAmount(breakdown.minimumFare, cfg)}
          </Text>
        </View>
      )}
      {hasLines && (
        <View style={[styles.breakdownDivider, { backgroundColor: c.border }]} />
      )}
      <View style={styles.breakdownRow}>
        <Text style={[styles.breakdownLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          {t("confirmRide.estimatedTotal")}
        </Text>
        <Text style={[styles.breakdownTotal, { color: c.primary, fontFamily: fonts.bold }]}>
          {formatUsdAmount(breakdown.total, cfg)}
        </Text>
      </View>
    </View>
  );
}

function CouponRevalidator({
  couponId,
  code,
  vehicleTypeId,
  vehicleClass,
  estimatedDistanceKm,
  estimatedDurationMin,
  estimatedSubtotal,
  onUpdate,
  onInvalid,
}: {
  couponId: string | null;
  code: string | null;
  vehicleTypeId: string | null;
  vehicleClass: string | null;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedSubtotal?: number;
  onUpdate: (c: AppliedCoupon) => void;
  onInvalid: () => void;
}) {
  useEffect(() => {
    if (!couponId || !code) return;
    let cancelled = false;
    api<{ couponId: string; code: string; discount: number }>("/coupons/validate", {
      method: "POST",
      json: {
        code,
        vehicleTypeId: vehicleTypeId ?? undefined,
        vehicleClass: vehicleClass ?? undefined,
        estimatedDistanceKm: estimatedDistanceKm > 0 ? estimatedDistanceKm : undefined,
        estimatedDurationMin: estimatedDurationMin > 0 ? estimatedDurationMin : undefined,
        estimatedSubtotal: estimatedSubtotal && estimatedSubtotal > 0 ? estimatedSubtotal : undefined,
      },
    })
      .then((r) => {
        if (cancelled) return;
        onUpdate({ couponId: r.couponId, code: r.code, discount: r.discount });
      })
      .catch(() => {
        if (cancelled) return;
        onInvalid();
      });
    return () => {
      cancelled = true;
    };
  }, [couponId, code, vehicleTypeId, vehicleClass, estimatedDistanceKm, estimatedDurationMin, estimatedSubtotal, onUpdate, onInvalid]);
  return null;
}

function CouponSheet({
  open,
  onClose,
  applied,
  onApply,
  onRemove,
  vehicleTypeId,
  vehicleClass,
  estimatedDistanceKm,
  estimatedDurationMin,
  estimatedSubtotal,
}: {
  open: boolean;
  onClose: () => void;
  applied: AppliedCoupon | null;
  onApply: (c: AppliedCoupon) => void;
  onRemove: () => void;
  vehicleTypeId: string | null;
  vehicleClass: string | null;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedSubtotal?: number;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const cfg = useConfig();
  const [code, setCode] = useState(applied?.code ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode(applied?.code ?? "");
      setError(null);
    }
  }, [open, applied?.code]);

  const apply = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<{ couponId: string; code: string; discount: number }>("/coupons/validate", {
        method: "POST",
        json: {
          code: trimmed,
          vehicleTypeId: vehicleTypeId ?? undefined,
          vehicleClass: vehicleClass ?? undefined,
          estimatedDistanceKm: estimatedDistanceKm > 0 ? estimatedDistanceKm : undefined,
          estimatedDurationMin: estimatedDurationMin > 0 ? estimatedDurationMin : undefined,
          estimatedSubtotal: estimatedSubtotal && estimatedSubtotal > 0 ? estimatedSubtotal : undefined,
        },
      });
      onApply({ couponId: r.couponId, code: r.code, discount: r.discount });
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : "generic";
      const key = `couponSheet.errors.${reason}`;
      const fallback = t("couponSheet.errors.generic");
      const translated = t(key);
      setError(translated === key ? fallback : translated);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.couponBackdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.couponSheetWrap}
      >
        <View style={[styles.couponSheet, { backgroundColor: c.background }]}>
          <View style={styles.couponHandle} />
          <Text style={[styles.couponTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
            {t("couponSheet.title")}
          </Text>
          <View style={[styles.couponInputRow, { borderColor: c.border, backgroundColor: c.surface }]}>
            <Feather name="tag" size={16} color={c.mutedForeground} />
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
              placeholder={t("couponSheet.placeholder")}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
              style={[styles.couponInput, { color: c.foreground, fontFamily: fonts.semiBold }]}
            />
          </View>
          {applied && applied.code === code.trim() && (
            <Text style={[styles.couponSavings, { color: c.primary, fontFamily: fonts.semiBold }]}>
              {t("couponSheet.savings", { amount: formatUsdAmount(applied.discount, cfg) })}
            </Text>
          )}
          {error && (
            <Text style={[styles.couponError, { fontFamily: fonts.medium }]}>{error}</Text>
          )}
          <View style={styles.couponActions}>
            {applied && (
              <Pressable
                onPress={onRemove}
                disabled={submitting}
                style={[styles.couponBtn, { borderColor: c.border, backgroundColor: c.surface }]}
              >
                <Text style={[styles.couponBtnText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                  {t("couponSheet.remove")}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={apply}
              disabled={submitting || code.trim().length === 0}
              style={[
                styles.couponBtn,
                {
                  backgroundColor: c.cta,
                  opacity: submitting || code.trim().length === 0 ? 0.6 : 1,
                  flex: 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={c.ctaForeground} />
              ) : (
                <Text style={[styles.couponBtnText, { color: c.ctaForeground, fontFamily: fonts.bold }]}>
                  {t("couponSheet.apply")}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AddressPill({
  color,
  label,
  address,
  etaMin,
  squareDot,
  onPress,
}: {
  color: string;
  label: string;
  address: string;
  etaMin: number;
  squareDot?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.addressPill,
        {
          backgroundColor: c.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.addressDot,
          { backgroundColor: color, borderRadius: squareDot ? 3 : 6 },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.addressLabel, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.addressSub, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={1}>
          {address}
        </Text>
      </View>
      <View style={[styles.etaPill, { backgroundColor: c.background }]}>
        <Text style={[styles.etaText, { color: c.foreground, fontFamily: fonts.semiBold }]}>{etaMin} min</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    position: "absolute",
    start: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  driverPinSlot: {
    position: "absolute",
    end: 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },
  addressBlock: {
    position: "relative",
    marginBottom: 14,
  },
  addressPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 6,
  },
  addressDot: { width: 12, height: 12 },
  addressLabel: { fontSize: 15 },
  addressSub: { fontSize: 12, marginTop: 2 },
  connector: {
    position: "absolute",
    start: 25,
    top: 38,
    bottom: 38,
    width: 2,
    borderRadius: 1,
  },
  etaPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  etaText: { fontSize: 12 },
  addStop: {
    position: "absolute",
    end: -2,
    top: "50%",
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  promo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 14,
    marginBottom: 14,
  },
  promoText: { fontSize: 13 },
  classRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
    paddingEnd: 4,
  },
  classCard: {
    width: 102,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
    borderWidth: 1.5,
  },
  classIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  className: { fontSize: 13 },
  classPrice: { fontSize: 14 },
  classBadges: {
    fontSize: 11,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  classKeyPill: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignSelf: "center",
  },
  classKeyText: {
    fontSize: 10,
    letterSpacing: 0.3,
  },
  optionsBlock: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  optionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLabel: { fontSize: 14 },
  optionHint: { fontSize: 11, marginTop: 1 },
  seatsBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  seatsValue: { fontSize: 16, minWidth: 22, textAlign: "center" },
  fareRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 18,
    marginBottom: 14,
  },
  fareBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  fareCenter: { flex: 1, alignItems: "center", gap: 2 },
  fareLabel: {
    fontSize: 11,
    letterSpacing: 1,
  },
  fareValue: { fontSize: 28 },
  fareHint: { fontSize: 11 },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  autoTitle: { fontSize: 14 },
  autoSub: { fontSize: 12, marginTop: 2 },
  scrollFadeHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 48,
    pointerEvents: "none",
  },
  ctaWrapper: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  cta: {
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: { fontSize: 16, letterSpacing: 0.2 },
  locationWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  locationWarningText: {
    flex: 1,
    fontSize: 13,
    color: "#92400E",
    lineHeight: 18,
  },
  bookingErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  bookingErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  breakdownPanel: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    gap: 6,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  breakdownLabel: {
    flex: 1,
    fontSize: 12,
  },
  breakdownValue: {
    fontSize: 12,
  },
  breakdownDivider: {
    height: 1,
    marginVertical: 4,
  },
  breakdownTotal: {
    fontSize: 14,
  },
  estimateUnavailable: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 14,
    opacity: 0.7,
  },
  couponBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  couponSheetWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  couponSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
  },
  couponHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginBottom: 6,
  },
  couponTitle: { fontSize: 18 },
  couponInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  couponInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  couponSavings: { fontSize: 13 },
  couponError: { fontSize: 13, color: "#B91C1C" },
  couponActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  couponBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "transparent",
  },
  couponBtnText: { fontSize: 15 },
});
