import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Animated, AppState, type AppStateStatus, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { AppMap } from "@/components/AppMap";
import { Sheet } from "@/components/Sheet";
import { TripChatSheet } from "@/components/TripChatSheet";
import { useAuth, useDriver } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useConfig, type PublicConfig } from "@/lib/config";
import { formatUsdAmount } from "@/lib/formatCurrency";
import type { TripStop } from "@/lib/types";
import { api } from "@/lib/api";
import { connectSocket, getSocket } from "@/lib/socket";
import { formatPhoneDisplay } from "@/lib/formatPhone";
import { checkNavApps, openNavApp } from "@/lib/maps";
import { getJSON, setJSON } from "@/lib/storage";

/** Speed in m/s below which the vehicle is considered stopped (~7 km/h). */
const STOP_SPEED_MS = 2.0;

/** Trip action timeout in milliseconds (~15 seconds). */
const TRIP_ACTION_TIMEOUT_MS = 15_000;

class TripActionTimeoutError extends Error {}

function withTripTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TripActionTimeoutError()),
      TRIP_ACTION_TIMEOUT_MS,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
/**
 * Grace period in ms before a stop starts accumulating waiting time.
 * Ignores brief pauses like traffic lights (30 s).
 */
const STOP_GRACE_MS = 30_000;

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Tracks how long the driver has been stopped (speed below threshold) during a
 * trip. Returns the current display seconds and a function to get the total
 * fractional minutes for submission.
 *
 * Background handling: when the driver switches away from the app the GPS
 * subscription may be paused by the OS, so new speed callbacks stop arriving.
 * We listen to AppState changes to bridge that gap:
 *  - On background: if a stop session is active, stash its start timestamp
 *    in stopStartBeforeBackgroundRef and clear stopStartRef. We do NOT flush
 *    into billedMsRef yet — that would apply the grace period too early.
 *  - On foreground return: credit the combined interval (original stop-start
 *    through now) with the 30 s grace applied once, then clear the stash.
 *    The next GPS callback determines whether the driver is still stopped.
 */
function useWaitingTracker(active: boolean) {
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [isStopped, setIsStopped] = useState(false);
  const [latestPosition, setLatestPosition] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const stopStartRef = useRef<number | null>(null);
  const billedMsRef = useRef(0);
  // When the app backgrounds during an active stop, we save the original
  // stop-start timestamp here instead of flushing to billedMsRef early.
  // On foreground return the combined interval (pre-background + backgrounded)
  // is credited with the grace period applied exactly once.
  const stopStartBeforeBackgroundRef = useRef<number | null>(null);

  const getWaitingMinutes = useCallback(() => {
    let totalMs = billedMsRef.current;
    if (stopStartRef.current !== null) {
      totalMs += Math.max(0, Date.now() - stopStartRef.current - STOP_GRACE_MS);
    }
    return totalMs / 60_000;
  }, []);

  useEffect(() => {
    if (!active) {
      stopStartRef.current = null;
      billedMsRef.current = 0;
      stopStartBeforeBackgroundRef.current = null;
      setDisplaySeconds(0);
      setIsStopped(false);
      return;
    }

    let sub: Location.LocationSubscription | null = null;

    const ticker = setInterval(() => {
      let totalMs = billedMsRef.current;
      if (stopStartRef.current !== null) {
        totalMs += Math.max(0, Date.now() - stopStartRef.current - STOP_GRACE_MS);
      }
      setDisplaySeconds(Math.floor(Math.max(0, totalMs) / 1000));
    }, 1000);

    let cancelled = false;

    // ── AppState listener ─────────────────────────────────────────────────
    // Track app foreground/background transitions so we don't lose waiting
    // time if the driver briefly switches to another app mid-trip.
    const onAppStateChange = (next: AppStateStatus) => {
      const isActive = next === "active";
      if (!isActive) {
        // App leaving foreground. If the driver was already stopped, stash the
        // original stop-start time (do NOT flush into billedMsRef yet) so that
        // the grace period can be applied once across the full combined
        // interval (pre-background + backgrounded) on foreground return.
        // If they were not stopped, nothing to preserve.
        if (stopStartRef.current !== null) {
          stopStartBeforeBackgroundRef.current = stopStartRef.current;
          stopStartRef.current = null;
        }
      } else {
        // App returned to foreground. If the driver was stopped when we
        // backgrounded, credit the combined elapsed time (from original stop
        // start through now) with the grace period applied exactly once.
        // This avoids both under-counting and the double-grace bug.
        if (stopStartBeforeBackgroundRef.current !== null) {
          const totalElapsed = Date.now() - stopStartBeforeBackgroundRef.current;
          billedMsRef.current += Math.max(0, totalElapsed - STOP_GRACE_MS);
          stopStartBeforeBackgroundRef.current = null;
        }
        // Reset isStopped to unknown until the next GPS update arrives.
        setIsStopped(false);
      }
    };

    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
    try {
      appStateSub = AppState.addEventListener("change", onAppStateChange);
    } catch {
      /* AppState unavailable in some environments — ignore */
    }
    // ─────────────────────────────────────────────────────────────────────

    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled || perm.status !== "granted") return;
        const newSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 0 },
          (pos) => {
            const speed = pos.coords.speed;
            const stopped = speed != null && speed >= 0 && speed < STOP_SPEED_MS;
            setIsStopped(stopped);
            setLatestPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading ?? null });
            if (stopped) {
              // Only start a new stop session if one is not already running.
              if (stopStartRef.current === null) stopStartRef.current = Date.now();
            } else {
              // Driver is moving: flush any active stop into billedMsRef.
              if (stopStartRef.current !== null) {
                const elapsed = Date.now() - stopStartRef.current;
                billedMsRef.current += Math.max(0, elapsed - STOP_GRACE_MS);
                stopStartRef.current = null;
              }
            }
          },
        );
        if (cancelled) {
          try { newSub.remove(); } catch { /* ignore */ }
        } else {
          sub = newSub;
        }
      } catch {
        /* GPS unavailable — waiting tracker silently disabled */
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(ticker);
      if (appStateSub) {
        try { appStateSub.remove(); } catch { /* ignore */ }
      }
      if (sub) {
        try { sub.remove(); } catch { /* ignore */ }
      }
    };
  }, [active]);

  return { displaySeconds, isStopped, getWaitingMinutes, latestPosition };
}

/**
 * Tracks the driver's current GPS position while the trip screen is active.
 * Used to render the driver's own marker on the map. Only subscribes during
 * the driver_arriving phase; the in_progress phase uses the position already
 * tracked by useWaitingTracker to avoid a second GPS subscription.
 */
function useDriverPosition(active: boolean) {
  const [position, setPosition] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);

  useEffect(() => {
    if (!active) {
      setPosition(null);
      return;
    }
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled || perm.status !== "granted") return;
        const newSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 5 },
          (pos) => {
            if (!cancelled) {
              setPosition({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading: pos.coords.heading ?? null,
              });
            }
          },
        );
        if (cancelled) {
          try { newSub.remove(); } catch { /* ignore */ }
        } else {
          sub = newSub;
        }
      } catch {
        /* GPS unavailable — driver marker silently disabled */
      }
    })();

    return () => {
      cancelled = true;
      if (sub) {
        try { sub.remove(); } catch { /* ignore */ }
      }
    };
  }, [active]);

  return position;
}

export default function DriverTrip() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { driverTrip, driverArrived, driverEndTrip, driverCancelTrip } = useDriver();
  const { user } = useAuth();
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const cfg = useConfig();
  const [showChat, setShowChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const handleChatRead = useCallback(() => setUnreadCount(0), []);

  const tripIdForChat = driverTrip?.id ?? null;
  useEffect(() => {
    if (!tripIdForChat) return;
    let cancelled = false;
    const refetchUnread = () => {
      api<{ unread: number; byTrip: Record<string, number> }>(
        "/chat/unread-count",
      )
        .then((res) => {
          if (cancelled) return;
          const tripUnread = res.byTrip?.[tripIdForChat] ?? 0;
          setUnreadCount(tripUnread);
        })
        .catch(() => {});
    };
    refetchUnread();

    const onUnreadUpdate = (payload: { tripId: string; unread: number }) => {
      if (cancelled) return;
      if (payload.tripId === tripIdForChat) setUnreadCount(payload.unread);
    };
    let attachedSocket: ReturnType<typeof getSocket> | null = null;
    connectSocket().then((sock) => {
      if (cancelled || !sock) return;
      attachedSocket = sock;
      sock.on("chat:unread:update", onUnreadUpdate);
      sock.on("connect", refetchUnread);
    });

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") refetchUnread();
    });

    return () => {
      cancelled = true;
      if (attachedSocket) {
        attachedSocket.off("chat:unread:update", onUnreadUpdate);
        attachedSocket.off("connect", refetchUnread);
      }
      appStateSub.remove();
    };
  }, [tripIdForChat]);

  const isArriving = !!driverTrip && driverTrip.status === "driver_arriving";
  const isInProgress = !!driverTrip && driverTrip.status === "in_progress";

  const { displaySeconds, isStopped, getWaitingMinutes, latestPosition: inProgressPosition } = useWaitingTracker(isInProgress);
  // Only subscribe to a separate position stream during driver_arriving.
  // During in_progress, the waiting tracker's GPS callback already captures position.
  const arrivingPosition = useDriverPosition(isArriving);
  // Persist the last known position across phase transitions so the map marker
  // does not briefly disappear when status flips from driver_arriving to in_progress.
  const lastKnownPositionRef = useRef<{ lat: number; lng: number; heading: number | null } | null>(null);
  // Preserve the last non-null heading separately so the marker never snaps back
  // to north when GPS temporarily reports null heading (e.g. at low speed).
  const lastKnownHeadingRef = useRef<number>(0);
  const rawPosition = isInProgress ? inProgressPosition : arrivingPosition;
  if (rawPosition !== null) {
    if (rawPosition.heading !== null) lastKnownHeadingRef.current = rawPosition.heading;
    lastKnownPositionRef.current = {
      ...rawPosition,
      heading: rawPosition.heading ?? lastKnownHeadingRef.current,
    };
  }
  const driverPosition = lastKnownPositionRef.current;

  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [pendingWaitMins, setPendingWaitMins] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successAmount, setSuccessAmount] = useState(0);
  const [tripActionError, setTripActionError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [showCallSheet, setShowCallSheet] = useState(false);
  const [safetyActive, setSafetyActive] = useState(false);
  const [showSafetySheet, setShowSafetySheet] = useState(false);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [showCancelSheet, setShowCancelSheet] = useState(false);
  const [cancelReasons, setCancelReasons] = useState<{ id: string; text: string }[]>([]);
  const [cancelReasonsLoading, setCancelReasonsLoading] = useState(false);
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [otherReasonSelected, setOtherReasonSelected] = useState(false);
  const [otherReasonText, setOtherReasonText] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showNavModal, setShowNavModal] = useState(false);
  const [navApps, setNavApps] = useState<{ google: boolean; apple: boolean; waze: boolean } | null>(null);
  const [navPreference, setNavPreference] = useState<"google" | "apple" | "waze" | null>(null);

  useEffect(() => {
    checkNavApps().then(setNavApps).catch(() => {});
    getJSON<"google" | "apple" | "waze">("nav_preference").then((v) => {
      if (v === "google" || v === "apple" || v === "waze") setNavPreference(v);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!driverTrip && !showSuccess) router.replace("/(driver)/home");
  }, [driverTrip, router, showSuccess]);

  // ---- Queued ride requests (back-to-back trips) ----
  // While the driver is on an active trip we periodically poll the server
  // for a queued candidate. The endpoint only returns a candidate once the
  // driver is close enough to the dropoff (admin-configured threshold).
  const [queuedCandidate, setQueuedCandidate] = useState<{
    rideId: string;
    riderName: string;
    pickupAddress: string;
    distanceFromCurrentDropoffKm: number;
    suggestedFare: number;
    expiresAtMs: number;
  } | null>(null);
  const [queuedAccepted, setQueuedAccepted] = useState<{
    rideId: string;
    pickupAddress: string;
    suggestedFare: number;
  } | null>(null);
  const [queuedActionLoading, setQueuedActionLoading] = useState(false);

  // Live ticker so the candidate countdown updates every second.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!queuedCandidate) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [queuedCandidate]);

  // Auto-clear an expired candidate so the card disappears when its window ends.
  useEffect(() => {
    if (!queuedCandidate) return;
    const remaining = queuedCandidate.expiresAtMs - Date.now();
    if (remaining <= 0) {
      setQueuedCandidate(null);
      return;
    }
    const id = setTimeout(() => setQueuedCandidate(null), remaining);
    return () => clearTimeout(id);
  }, [queuedCandidate]);

  useEffect(() => {
    if (!driverTrip || driverTrip.status === "completed") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await api<{
          candidates: {
            rideId: string;
            riderName: string;
            pickupAddress: string;
            distanceFromCurrentDropoffKm: number;
            suggestedFare: number;
            expiresAtMs: number;
          }[];
          queued: {
            rideId: string;
            pickupAddress: string;
            suggestedFare: number;
          } | null;
        }>("/driver/queued-requests");
        if (cancelled) return;
        setQueuedAccepted(r.queued ?? null);
        if (!r.queued && r.candidates.length > 0) {
          setQueuedCandidate(r.candidates[0]);
        } else if (r.queued || r.candidates.length === 0) {
          setQueuedCandidate(null);
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 10_000);
    // Real-time push: when the server signals this driver has just become
    // eligible for a queued candidate (lead-distance/time threshold crossed,
    // or a brand-new ride matched their dropoff), refetch immediately so the
    // offer card surfaces without waiting for the next 10s poll. Polling is
    // kept as a fallback for socket outages.
    const sock = getSocket();
    const onPush = () => { void tick(); };
    sock?.on("queuedRideRequest", onPush);
    return () => {
      cancelled = true;
      clearInterval(id);
      sock?.off("queuedRideRequest", onPush);
    };
  }, [driverTrip?.id, driverTrip?.status]);

  const handleAcceptQueued = useCallback(async () => {
    if (!queuedCandidate || queuedActionLoading) return;
    setQueuedActionLoading(true);
    try {
      const r = await api<{
        ok: boolean;
        ride: {
          rideId: string;
          pickupAddress: string;
          suggestedFare: number;
          initialFare?: number | null;
        };
      }>(`/driver/queued-requests/${queuedCandidate.rideId}/accept`, { method: "POST" });
      if (r.ok) {
        setQueuedAccepted({
          rideId: r.ride.rideId,
          pickupAddress: r.ride.pickupAddress,
          suggestedFare: r.ride.suggestedFare ?? queuedCandidate.suggestedFare,
        });
        setQueuedCandidate(null);
      }
    } catch {
      Alert.alert(
        t("driverTrip.queuedAcceptFailed", { defaultValue: "Could not queue ride" }),
        t("driverTrip.queuedAcceptFailedSub", {
          defaultValue: "Another driver may have accepted it first.",
        }),
      );
    } finally {
      setQueuedActionLoading(false);
    }
  }, [queuedCandidate, queuedActionLoading, t]);

  const handleDeclineQueued = useCallback(async () => {
    if (!queuedCandidate) return;
    const id = queuedCandidate.rideId;
    setQueuedCandidate(null);
    try {
      await api(`/driver/queued-requests/${id}/decline`, { method: "POST" });
    } catch {
      /* ignore */
    }
  }, [queuedCandidate]);

  const navDest = (() => {
    if (!driverTrip) return null;
    if (isArriving && driverTrip.pickupLat != null && driverTrip.pickupLng != null) {
      return { lat: driverTrip.pickupLat, lng: driverTrip.pickupLng, label: driverTrip.pickup.address };
    }
    if (isInProgress && driverTrip.dropoffLat != null && driverTrip.dropoffLng != null) {
      return { lat: driverTrip.dropoffLat, lng: driverTrip.dropoffLng, label: driverTrip.dropoff.address };
    }
    return null;
  })();

  const showNavButton = !!navApps && (navApps.google || navApps.apple || navApps.waze) && !!navDest;

  const saveNavPreference = (app: "google" | "apple" | "waze") => {
    setNavPreference(app);
    setJSON("nav_preference", app).catch(() => {});
  };

  const showNavPicker = () => {
    if (!navDest || !navApps) return;
    if (Platform.OS === "ios") {
      const options: string[] = [];
      const appKeys: ("google" | "apple" | "waze")[] = [];
      if (navApps.google) { options.push(t("driverTrip.navGoogleMaps")); appKeys.push("google"); }
      if (navApps.apple) { options.push(t("driverTrip.navAppleMaps")); appKeys.push("apple"); }
      if (navApps.waze) { options.push(t("driverTrip.navWaze")); appKeys.push("waze"); }
      if (options.length === 0) return;
      options.push(t("common.cancel"));
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, title: t("driverTrip.navigateWith") },
        (idx) => {
          if (idx < appKeys.length) {
            saveNavPreference(appKeys[idx]);
            openNavApp(appKeys[idx], navDest).catch(() => {});
          }
        },
      );
    } else {
      setShowNavModal(true);
    }
  };

  const navLongPressedRef = useRef(false);

  const handleNavigate = () => {
    if (navLongPressedRef.current) {
      navLongPressedRef.current = false;
      return;
    }
    if (!navDest || !navApps) return;
    const preferred = navPreference;
    if (preferred && navApps[preferred]) {
      openNavApp(preferred, navDest).catch(() => {});
    } else {
      showNavPicker();
    }
  };

  const handleNavigateWithPicker = () => {
    navLongPressedRef.current = true;
    showNavPicker();
  };

  const completedRideId = useRef<string | null>(null);
  useEffect(() => {
    if (driverTrip?.status === "completed") {
      completedRideId.current = driverTrip.id;
    }
  }, [driverTrip?.status, driverTrip?.id]);

  if (showSuccess) {
    const rideId = completedRideId.current;
    const riderName = driverTrip?.riderName ?? "";
    return (
      <TripSuccessView
        amount={successAmount}
        onDone={() => {
          if (rideId) {
            router.replace({ pathname: "/(driver)/rate", params: { rideId, riderName } });
          } else {
            router.replace("/(driver)/home");
          }
        }}
        c={c}
        fonts={fonts}
        t={t}
        cfg={cfg}
      />
    );
  }

  const isSharedTrip = !!driverTrip!.stops && driverTrip!.stops.length > 2;
  const target = isArriving ? driverTrip!.pickup : driverTrip!.dropoff;

  const waitingFeePerMin = driverTrip!.waitingFeePerMin ?? 0;

  const handleEnd = async () => {
    if (isActionLoading) return;
    const mins = getWaitingMinutes();
    if (mins > 0) {
      setPendingWaitMins(mins);
      setShowConfirmSheet(true);
      return;
    }
    const amount = driverTrip!.amount;
    setTripActionError(null);
    setIsActionLoading(true);
    try {
      const result = await withTripTimeout(driverEndTrip(undefined));
      // When a queued ride is activated server-side the driver should
      // transition straight into the next pickup flow — refreshDriverState
      // (already called inside driverEndTrip) will swap driverTrip to the
      // newly-activated ride, so we just skip the success modal.
      if (result?.queuedActivated) return;
      setSuccessAmount(amount);
      setShowSuccess(true);
    } catch (err) {
      setTripActionError(
        err instanceof TripActionTimeoutError
          ? t("driverTrip.timeoutError")
          : t("driverTrip.actionError"),
      );
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmEnd = async () => {
    if (isActionLoading) return;
    setShowConfirmSheet(false);
    const amount = driverTrip!.amount;
    setTripActionError(null);
    setIsActionLoading(true);
    try {
      const result = await withTripTimeout(driverEndTrip(pendingWaitMins));
      if (result?.queuedActivated) return;
      setSuccessAmount(amount);
      setShowSuccess(true);
    } catch (err) {
      setTripActionError(
        err instanceof TripActionTimeoutError
          ? t("driverTrip.timeoutError")
          : t("driverTrip.actionError"),
      );
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleArrived = async () => {
    if (isActionLoading) return;
    setTripActionError(null);
    setIsActionLoading(true);
    try {
      await withTripTimeout(driverArrived());
    } catch (err) {
      setTripActionError(
        err instanceof TripActionTimeoutError
          ? t("driverTrip.timeoutError")
          : t("driverTrip.actionError"),
      );
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSafetyPress = async () => {
    if (safetyActive) {
      setShowSafetySheet(true);
      return;
    }
    if (!driverTrip) return;
    setSafetyLoading(true);
    try {
      await api(`/rides/${driverTrip.id}/safety-alert`, { method: "POST" });
      setSafetyActive(true);
      setShowSafetySheet(true);
    } catch {
      Alert.alert(t("common.error"), t("common.tryAgain"));
    } finally {
      setSafetyLoading(false);
    }
  };

  const openCancelSheet = async () => {
    setShowCancelSheet(true);
    setCancelError(null);
    setSelectedReasonId(null);
    setOtherReasonSelected(false);
    setOtherReasonText("");
    if (cancelReasons.length > 0) return;
    setCancelReasonsLoading(true);
    try {
      const data = await api<{ reasons: { id: string; text: string }[] }>(
        "/cancellation-reasons?role=driver",
      );
      setCancelReasons(Array.isArray(data?.reasons) ? data.reasons : []);
    } catch {
      setCancelReasons([]);
    } finally {
      setCancelReasonsLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (cancelLoading) return;
    const otherText = otherReasonText.trim();
    if (otherReasonSelected && !otherText) {
      setCancelError(t("driverTrip.selectReason"));
      return;
    }
    if (!otherReasonSelected && !selectedReasonId && cancelReasons.length > 0) {
      setCancelError(t("driverTrip.selectReason"));
      return;
    }
    setCancelError(null);
    setCancelLoading(true);
    try {
      await withTripTimeout(
        driverCancelTrip(
          otherReasonSelected
            ? { reasonText: otherText }
            : selectedReasonId
              ? { reasonId: selectedReasonId }
              : {},
        ),
      );
      setShowCancelSheet(false);
      router.replace("/(driver)/home");
    } catch {
      setCancelError(t("driverTrip.cancelFailed"));
    } finally {
      setCancelLoading(false);
    }
  };

  const handleCancelSafety = async () => {
    if (!driverTrip) return;
    setSafetyLoading(true);
    try {
      await api(`/rides/${driverTrip.id}/safety-alert`, { method: "DELETE" });
      setSafetyActive(false);
      setShowSafetySheet(false);
    } catch {
      Alert.alert(t("common.error"), t("common.tryAgain"));
    } finally {
      setSafetyLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <AppMap
          pickup={
            driverTrip.pickupLat != null && driverTrip.pickupLng != null
              ? { lat: driverTrip.pickupLat, lng: driverTrip.pickupLng }
              : null
          }
          dropoff={
            driverTrip.dropoffLat != null && driverTrip.dropoffLng != null
              ? { lat: driverTrip.dropoffLat, lng: driverTrip.dropoffLng }
              : null
          }
          routePolyline={driverTrip.routePolyline ?? null}
          selfDriver={driverPosition}
        />
      </View>

      {/* ---- Queued ride card (back-to-back trips) ---- */}
      {/* Queued-ride card is visible during BOTH driver_arriving and
          in_progress phases of the current trip — the spec requires the
          driver to be able to receive/accept a queued ride at any point
          while they have an active trip, not only after pickup. */}
      {(queuedAccepted || queuedCandidate) &&
        (driverTrip.status === "driver_arriving" || isInProgress) && (
        <View
          style={{
            position: "absolute",
            top: insets.top + 80,
            left: 12,
            right: 12,
            backgroundColor: c.surface,
            borderColor: queuedAccepted ? c.primary : c.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            zIndex: 10,
          }}
        >
          {queuedAccepted ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="check-circle" size={16} color={c.primary} />
                <Text style={{ color: c.foreground, fontFamily: fonts.bold, fontSize: 13 }}>
                  {t("driverTrip.nextRideQueued", { defaultValue: "Next ride queued" })}
                </Text>
              </View>
              <Text
                style={{ color: c.mutedForeground, fontFamily: fonts.medium, fontSize: 12, marginTop: 4 }}
                numberOfLines={2}
              >
                {queuedAccepted.pickupAddress}
              </Text>
              <Text style={{ color: c.foreground, fontFamily: fonts.semiBold, fontSize: 12, marginTop: 2 }}>
                {formatUsdAmount(queuedAccepted.suggestedFare, cfg)}
              </Text>
            </>
          ) : queuedCandidate ? (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: c.foreground, fontFamily: fonts.bold, fontSize: 13 }}>
                  {t("driverTrip.queueNextRide", { defaultValue: "Queue another ride?" })}
                </Text>
                <View
                  style={{
                    backgroundColor: c.muted,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: c.foreground, fontFamily: fonts.semiBold, fontSize: 11 }}>
                    {Math.max(0, Math.ceil((queuedCandidate.expiresAtMs - Date.now()) / 1000))}s
                  </Text>
                </View>
              </View>
              <Text
                style={{ color: c.mutedForeground, fontFamily: fonts.medium, fontSize: 12, marginTop: 4 }}
                numberOfLines={2}
              >
                {queuedCandidate.pickupAddress} · {queuedCandidate.distanceFromCurrentDropoffKm} km from your dropoff
              </Text>
              <Text style={{ color: c.foreground, fontFamily: fonts.semiBold, fontSize: 12, marginTop: 2 }}>
                {formatUsdAmount(queuedCandidate.suggestedFare, cfg)}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={handleDeclineQueued}
                  disabled={queuedActionLoading}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: c.border,
                    alignItems: "center",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ color: c.mutedForeground, fontFamily: fonts.semiBold, fontSize: 13 }}>
                    {t("common.decline", { defaultValue: "Decline" })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleAcceptQueued}
                  disabled={queuedActionLoading}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: c.primary,
                    alignItems: "center",
                    opacity: pressed || queuedActionLoading ? 0.6 : 1,
                  })}
                >
                  <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 13 }}>
                    {t("common.accept", { defaultValue: "Accept" })}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      )}

      <View style={[styles.statusBanner, { top: insets.top + 12, backgroundColor: c.foreground }]}>
        <View
          style={[
            styles.statusIcon,
            { backgroundColor: isArriving ? c.accent : c.primary },
          ]}
        >
          <Feather name={isArriving ? "navigation" : "flag"} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { fontFamily: fonts.bold }]}>
            {isArriving ? t("driverTrip.driveToPickup") : t("driverTrip.driveToDropoff")}
          </Text>
          <Text style={[styles.statusSub, { fontFamily: fonts.medium }]} numberOfLines={1}>
            {target.address}
          </Text>
        </View>
        {isSharedTrip && (
          <View style={[styles.sharedBadge, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.sharedBadgeText, { color: c.primary, fontFamily: fonts.bold }]}>{t("driverTrip.shared")}</Text>
          </View>
        )}
      </View>

      <View style={{ flex: 1 }} />

      <Sheet>
        <View style={styles.row}>
          <Avatar initial={driverTrip.riderName.charAt(0)} size={52} photoUrl={driverTrip.riderPhotoUrl} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rider, { color: c.foreground, fontFamily: fonts.bold }]}>{driverTrip.riderName}</Text>
            {driverTrip!.riderCustomerRating != null ? (
              <View style={styles.riderRatingRow}>
                <Feather name="star" size={12} color={c.accent} />
                <Text style={[styles.riderRatingText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {driverTrip!.riderCustomerRating.toFixed(1)}
                  {driverTrip!.riderCustomerRatingCount
                    ? ` (${driverTrip!.riderCustomerRatingCount})`
                    : ""}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.fare, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {isSharedTrip
                ? t("driverTrip.fareCashCombined", { amount: formatUsdAmount(driverTrip.amount, cfg) })
                : t("driverTrip.fareCash", { amount: formatUsdAmount(driverTrip.amount, cfg) })}
            </Text>
          </View>
          <View style={styles.driverActions}>
            <Pressable
              style={({ pressed }) => [
                styles.callBtn,
                { backgroundColor: c.primarySoft, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={() => setShowCallSheet(true)}
            >
              <Feather name="phone" size={18} color={c.primary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.callBtn,
                { backgroundColor: c.primarySoft, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={() => { setUnreadCount(0); setShowChat(true); }}
            >
              <Feather name="message-circle" size={18} color={c.primary} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={[styles.badgeText, { fontFamily: fonts.bold }]}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.callBtn,
                {
                  backgroundColor: safetyActive ? "#FEE2E2" : c.surface,
                  opacity: pressed || safetyLoading ? 0.7 : 1,
                },
              ]}
              onPress={handleSafetyPress}
              disabled={safetyLoading}
            >
              <Feather name="shield" size={18} color={safetyActive ? "#EF4444" : c.mutedForeground} />
            </Pressable>
            {showNavButton && (
              <Pressable
                style={({ pressed }) => [
                  styles.callBtn,
                  { backgroundColor: c.primarySoft, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={handleNavigate}
                onLongPress={handleNavigateWithPicker}
                delayLongPress={500}
              >
                <Feather name="navigation" size={18} color={c.primary} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Multi-stop display for shared trips */}
        {isSharedTrip && driverTrip.stops ? (
          <SharedStopList stops={driverTrip.stops} c={c} />
        ) : (
          <View style={[styles.routeBlock, { backgroundColor: c.surface }]}>
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: c.accent }]} />
              <Text style={[styles.routeText, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                {driverTrip.pickup.address}
              </Text>
            </View>
            <View style={[styles.routeConnector, { backgroundColor: c.border }]} />
            <View style={styles.routeRow}>
              <View style={[styles.dotSquare, { backgroundColor: c.primary }]} />
              <Text style={[styles.routeText, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
                {driverTrip.dropoff.address}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Feather name="map" size={13} color={c.mutedForeground} />
              <Text style={[styles.metaText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {driverTrip.distanceKm} km · {driverTrip.durationMin} min
              </Text>
            </View>
          </View>
        )}

        {/* Waiting indicator — shown while the trip is in progress */}
        {isInProgress && (
          <View style={[styles.waitingRow, {
            backgroundColor: isStopped && displaySeconds === 0
              ? c.surface
              : displaySeconds > 0 ? c.primarySoft : c.surface,
            borderColor: c.border,
          }]}>
            <Feather
              name="clock"
              size={14}
              color={displaySeconds > 0 ? c.primary : c.mutedForeground}
            />
            <Text style={[
              styles.waitingText,
              { color: displaySeconds > 0 ? c.primary : c.mutedForeground, fontFamily: fonts.medium },
            ]}>
              {displaySeconds > 0
                ? t("driverTrip.waiting", { time: formatWait(displaySeconds) })
                : isStopped
                  ? t("driverTrip.stoppedWaiting")
                  : t("driverTrip.waitingTracked")}
            </Text>
          </View>
        )}

        {isArriving ? (
          <Button
            label={t("driverTrip.arrivedStartTrip")}
            onPress={handleArrived}
            loading={isActionLoading}
            disabled={isActionLoading}
          />
        ) : (
          <Button
            label={t("driverTrip.completeTrip")}
            onPress={handleEnd}
            loading={isActionLoading}
            disabled={isActionLoading}
          />
        )}
        {isArriving && (
          <Pressable
            style={({ pressed }) => [styles.cancelTripBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={openCancelSheet}
            disabled={isActionLoading}
          >
            <Text style={[styles.cancelTripText, { color: c.destructive, fontFamily: fonts.semiBold }]}>
              {t("driverTrip.cancelTrip")}
            </Text>
          </Pressable>
        )}
        {tripActionError ? (
          <Text style={[styles.actionErrorText, { color: c.destructive, fontFamily: fonts.medium }]}>
            {tripActionError}
          </Text>
        ) : null}
      </Sheet>

      {/* Waiting time confirmation sheet */}
      {showConfirmSheet && (
        <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.45)" }]}>
          <Sheet>
            <View style={styles.confirmHeader}>
              <View style={[styles.confirmIconWrap, { backgroundColor: c.primarySoft }]}>
                <Feather name="clock" size={22} color={c.primary} />
              </View>
              <Text style={[styles.confirmTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
                {t("driverTrip.waitingSummary")}
              </Text>
              <Text style={[styles.confirmSub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("driverTrip.waitingCharges")}
              </Text>
            </View>

            <View style={[styles.confirmCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.confirmRow}>
                <Text style={[styles.confirmLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("driverTrip.waitingTime")}
                </Text>
                <Text style={[styles.confirmValue, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                  {Math.ceil(pendingWaitMins)} min
                </Text>
              </View>
              <View style={[styles.confirmDivider, { backgroundColor: c.border }]} />
              <View style={styles.confirmRow}>
                <Text style={[styles.confirmLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("driverTrip.rate")}
                </Text>
                <Text style={[styles.confirmValue, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                  {waitingFeePerMin > 0 ? `${formatUsdAmount(waitingFeePerMin, cfg)} / min` : t("driverTrip.noExtraCharge")}
                </Text>
              </View>
              <View style={[styles.confirmDivider, { backgroundColor: c.border }]} />
              <View style={styles.confirmRow}>
                <Text style={[styles.confirmLabel, { color: c.foreground, fontFamily: fonts.bold }]}>
                  {t("driverTrip.extraCharge")}
                </Text>
                <Text style={[styles.confirmValue, { color: waitingFeePerMin > 0 ? c.primary : c.mutedForeground, fontFamily: fonts.bold }]}>
                  +{formatUsdAmount(Math.ceil(pendingWaitMins) * waitingFeePerMin, cfg)}
                </Text>
              </View>
            </View>

            <Button
              label={t("driverTrip.confirmCompleteTrip")}
              onPress={handleConfirmEnd}
              loading={isActionLoading}
              disabled={isActionLoading}
            />
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowConfirmSheet(false)}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
          </Sheet>
        </View>
      )}

      {user && driverTrip && (driverTrip.status === "driver_arriving" || driverTrip.status === "in_progress") && (
        <TripChatSheet
          tripId={driverTrip.id}
          userId={user.id}
          peerName={driverTrip.riderName}
          isOpen={showChat}
          onClose={() => setShowChat(false)}
          onChatRead={handleChatRead}
          role="driver"
        />
      )}

      {/* Call sheet */}
      <Modal
        visible={showCallSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCallSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("driverTrip.riderContactTitle")}
            </Text>
            <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {driverTrip?.riderName ?? "Rider"}
            </Text>
            {driverTrip?.riderPhone ? (
              <>
                <View style={[styles.phoneBox, { backgroundColor: c.surface }]}>
                  <Feather name="phone" size={18} color={c.primary} />
                  <Text style={[styles.phoneNumber, { color: c.foreground, fontFamily: fonts.bold }]}>
                    {formatPhoneDisplay(driverTrip.riderPhone!)}
                  </Text>
                </View>
                <Button
                  label={t("driverTrip.callNow")}
                  onPress={() => {
                    Linking.openURL(`tel:${driverTrip!.riderPhone}`);
                    setShowCallSheet(false);
                  }}
                />
              </>
            ) : (
              <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("driverTrip.phoneUnavailable")}
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowCallSheet(false)}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Navigate modal (Android) */}
      <Modal
        visible={showNavModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNavModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("driverTrip.navigateWith")}
            </Text>
            {navDest && (
              <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={2}>
                {navDest.label}
              </Text>
            )}
            {navApps?.google && (
              <Pressable
                style={({ pressed }) => [
                  styles.navOptionBtn,
                  { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => {
                  setShowNavModal(false);
                  saveNavPreference("google");
                  if (navDest) openNavApp("google", navDest).catch(() => {});
                }}
              >
                <Feather name="map" size={20} color={c.primary} />
                <Text style={[styles.navOptionText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                  {t("driverTrip.navGoogleMaps")}
                </Text>
                <Feather name={fonts.isRTL ? "chevron-left" : "chevron-right"} size={18} color={c.mutedForeground} />
              </Pressable>
            )}
            {navApps?.apple && (
              <Pressable
                style={({ pressed }) => [
                  styles.navOptionBtn,
                  { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => {
                  setShowNavModal(false);
                  saveNavPreference("apple");
                  if (navDest) openNavApp("apple", navDest).catch(() => {});
                }}
              >
                <Feather name="map" size={20} color={c.primary} />
                <Text style={[styles.navOptionText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                  {t("driverTrip.navAppleMaps")}
                </Text>
                <Feather name={fonts.isRTL ? "chevron-left" : "chevron-right"} size={18} color={c.mutedForeground} />
              </Pressable>
            )}
            {navApps?.waze && (
              <Pressable
                style={({ pressed }) => [
                  styles.navOptionBtn,
                  { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => {
                  setShowNavModal(false);
                  saveNavPreference("waze");
                  if (navDest) openNavApp("waze", navDest).catch(() => {});
                }}
              >
                <Feather name="navigation" size={20} color={c.primary} />
                <Text style={[styles.navOptionText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                  {t("driverTrip.navWaze")}
                </Text>
                <Feather name={fonts.isRTL ? "chevron-left" : "chevron-right"} size={18} color={c.mutedForeground} />
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowNavModal(false)}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Cancel-ride sheet */}
      <Modal
        visible={showCancelSheet}
        transparent
        animationType="slide"
        onRequestClose={() => (cancelLoading ? null : setShowCancelSheet(false))}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("driverTrip.cancelTripTitle")}
            </Text>
            <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {t("driverTrip.cancelTripPrompt")}
            </Text>

            <ScrollView style={styles.cancelReasonList} keyboardShouldPersistTaps="handled">
              {cancelReasonsLoading ? (
                <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
                  {t("common.loading")}
                </Text>
              ) : (
                <>
                  {cancelReasons.map((r) => {
                    const selected = !otherReasonSelected && selectedReasonId === r.id;
                    return (
                      <Pressable
                        key={r.id}
                        style={({ pressed }) => [
                          styles.reasonRow,
                          {
                            backgroundColor: selected ? c.primarySoft : c.surface,
                            borderColor: selected ? c.primary : c.border,
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                        onPress={() => {
                          setSelectedReasonId(r.id);
                          setOtherReasonSelected(false);
                          setCancelError(null);
                        }}
                      >
                        <Feather
                          name={selected ? "check-circle" : "circle"}
                          size={18}
                          color={selected ? c.primary : c.mutedForeground}
                        />
                        <Text
                          style={[
                            styles.reasonText,
                            {
                              color: selected ? c.primary : c.foreground,
                              fontFamily: fonts.semiBold,
                            },
                          ]}
                        >
                          {r.text}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    style={({ pressed }) => [
                      styles.reasonRow,
                      {
                        backgroundColor: otherReasonSelected ? c.primarySoft : c.surface,
                        borderColor: otherReasonSelected ? c.primary : c.border,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    onPress={() => {
                      setOtherReasonSelected(true);
                      setSelectedReasonId(null);
                      setCancelError(null);
                    }}
                  >
                    <Feather
                      name={otherReasonSelected ? "check-circle" : "circle"}
                      size={18}
                      color={otherReasonSelected ? c.primary : c.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.reasonText,
                        {
                          color: otherReasonSelected ? c.primary : c.foreground,
                          fontFamily: fonts.semiBold,
                        },
                      ]}
                    >
                      {t("driverTrip.otherReason")}
                    </Text>
                  </Pressable>
                  {otherReasonSelected && (
                    <TextInput
                      value={otherReasonText}
                      onChangeText={setOtherReasonText}
                      placeholder={t("driverTrip.otherReasonPlaceholder")}
                      placeholderTextColor={c.mutedForeground}
                      style={[
                        styles.reasonInput,
                        {
                          color: c.foreground,
                          backgroundColor: c.surface,
                          borderColor: c.border,
                          fontFamily: fonts.regular,
                        },
                      ]}
                      multiline
                      maxLength={200}
                      editable={!cancelLoading}
                    />
                  )}
                </>
              )}
            </ScrollView>

            {cancelError ? (
              <Text style={[styles.actionErrorText, { color: c.destructive, fontFamily: fonts.medium }]}>
                {cancelError}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.cancelAlertBtn,
                { backgroundColor: "#FEE2E2", opacity: pressed || cancelLoading ? 0.7 : 1 },
              ]}
              onPress={handleConfirmCancel}
              disabled={cancelLoading}
            >
              <Text style={[styles.cancelAlertText, { fontFamily: fonts.semiBold }]}>
                {cancelLoading ? t("driverTrip.cancelling") : t("driverTrip.confirmCancel")}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowCancelSheet(false)}
              disabled={cancelLoading}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("driverTrip.keepRide")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Safety sheet */}
      <Modal
        visible={showSafetySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSafetySheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <View style={[styles.safetyIconWrap, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="shield" size={28} color="#EF4444" />
            </View>
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {safetyActive ? t("driverTrip.safetyAlertActive") : t("driverTrip.safetyAlertTitle")}
            </Text>
            <Text style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {t("driverTrip.safetyAlertDesc")}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.cancelAlertBtn,
                { backgroundColor: "#FEE2E2", opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={handleCancelSafety}
              disabled={safetyLoading}
            >
              <Text style={[styles.cancelAlertText, { fontFamily: fonts.semiBold }]}>
                {t("driverTrip.safetyFalseAlarm")}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setShowSafetySheet(false)}
            >
              <Text style={[styles.cancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.close")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SharedStopList({
  stops,
  c,
}: {
  stops: TripStop[];
  c: ReturnType<typeof useColors>;
}) {
  const { t } = useTranslation();
  const fonts = useFontFamily();
  const pickups = stops.filter((s) => s.type === "pickup");
  const dropoffs = stops.filter((s) => s.type === "dropoff");

  return (
    <ScrollView
      style={[styles.stopList, { backgroundColor: c.surface }]}
      scrollEnabled={false}
    >
      {pickups.map((stop, idx) => (
        <React.Fragment key={`pickup-${stop.rideId}`}>
          <View style={styles.stopRow}>
            <View style={styles.stopIconCol}>
              <View style={[styles.stopDot, { backgroundColor: c.accent }]} />
              {idx < pickups.length - 1 && (
                <View style={[styles.stopLine, { backgroundColor: c.border }]} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.stopType, { color: c.mutedForeground, fontFamily: fonts.bold }]}>
                {t("driverTrip.pickupLabel", { name: stop.riderName }).toUpperCase()}
              </Text>
              <Text style={[styles.stopAddress, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={2}>
                {stop.address}
              </Text>
            </View>
          </View>
          {idx < pickups.length - 1 && <View style={{ height: 4 }} />}
        </React.Fragment>
      ))}

      {/* Divider between pickups and dropoffs */}
      <View style={[styles.stopDivider, { borderColor: c.border }]} />

      {dropoffs.map((stop, idx) => (
        <React.Fragment key={`dropoff-${stop.rideId}`}>
          <View style={styles.stopRow}>
            <View style={styles.stopIconCol}>
              <View style={[styles.stopSquare, { backgroundColor: c.primary }]} />
              {idx < dropoffs.length - 1 && (
                <View style={[styles.stopLine, { backgroundColor: c.border }]} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.stopType, { color: c.mutedForeground, fontFamily: fonts.bold }]}>
                {t("driverTrip.dropoffLabel", { name: stop.riderName }).toUpperCase()}
              </Text>
              <Text style={[styles.stopAddress, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={2}>
                {stop.address}
              </Text>
            </View>
          </View>
          {idx < dropoffs.length - 1 && <View style={{ height: 4 }} />}
        </React.Fragment>
      ))}
    </ScrollView>
  );
}

function TripSuccessView({
  amount,
  onDone,
  c,
  fonts,
  t,
  cfg,
}: {
  amount: number;
  onDone: () => void;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  cfg: PublicConfig;
}) {
  const iconScale = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(iconScale, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.06,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 420,
            useNativeDriver: true,
          }),
        ]),
        { iterations: 2 },
      ).start(onDone);
    });
  }, [iconScale, pulseScale, textOpacity, textTranslateY, onDone]);

  return (
    <View style={[styles.successContainer, { backgroundColor: c.background }]}>
      <Animated.View
        style={[
          styles.successIcon,
          { backgroundColor: c.primarySoft, transform: [{ scale: iconScale }, { scale: pulseScale }] },
        ]}
      >
        <Feather name="check-circle" size={56} color={c.primary} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.successTitle,
          {
            color: c.foreground,
            fontFamily: fonts.bold,
            opacity: textOpacity,
            transform: [{ translateY: textTranslateY }],
          },
        ]}
      >
        {t("driverTrip.successTitle")}
      </Animated.Text>
      <Animated.Text
        style={[
          styles.successEarnings,
          {
            color: c.primary,
            fontFamily: fonts.bold,
            opacity: textOpacity,
            transform: [{ translateY: textTranslateY }],
          },
        ]}
      >
        {t("driverTrip.successEarnings", { amount: formatUsdAmount(amount, cfg) })}
      </Animated.Text>
      <Animated.Text
        style={[
          styles.successSub,
          {
            color: c.mutedForeground,
            fontFamily: fonts.regular,
            opacity: textOpacity,
            transform: [{ translateY: textTranslateY }],
          },
        ]}
      >
        {t("driverTrip.successSub")}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusBanner: {
    position: "absolute",
    start: 16,
    end: 16,
    padding: 14,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: { color: "#fff", fontSize: 15 },
  statusSub: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    marginTop: 2,
  },
  sharedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  sharedBadgeText: { fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  rider: { fontSize: 17 },
  riderRatingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  riderRatingText: { fontSize: 12 },
  fare: { fontSize: 13, marginTop: 2 },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -4,
    end: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#E53E3E",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    lineHeight: 12,
  },
  routeBlock: { borderRadius: 16, padding: 14, marginBottom: 18, gap: 4 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  routeText: { flex: 1, fontSize: 14 },
  routeConnector: { width: 1, height: 14, marginStart: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotSquare: { width: 10, height: 10, borderRadius: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingStart: 22 },
  metaText: { fontSize: 12 },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
  },
  waitingText: {
    fontSize: 13,
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 100,
  },
  confirmHeader: {
    alignItems: "center",
    marginBottom: 20,
    gap: 8,
  },
  confirmIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  confirmTitle: {
    fontSize: 18,
    textAlign: "center",
  },
  confirmSub: {
    fontSize: 13,
    textAlign: "center",
  },
  confirmCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 18,
    gap: 0,
  },
  confirmRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  confirmLabel: {
    fontSize: 14,
  },
  confirmValue: {
    fontSize: 14,
  },
  confirmDivider: {
    height: 1,
    marginHorizontal: -16,
  },
  cancelTripBtn: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  cancelTripText: { fontSize: 14 },
  cancelReasonList: { maxHeight: 280, marginTop: 4 },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  reasonText: { fontSize: 14, flex: 1 },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 72,
    textAlignVertical: "top",
    fontSize: 14,
    marginBottom: 8,
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  cancelText: {
    fontSize: 15,
  },
  actionErrorText: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 8,
  },
  // Shared stop list styles
  stopList: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stopIconCol: {
    alignItems: "center",
    width: 12,
    marginTop: 3,
  },
  stopDot: { width: 12, height: 12, borderRadius: 6 },
  stopSquare: { width: 12, height: 12, borderRadius: 3 },
  stopLine: { width: 2, flex: 1, marginTop: 4, minHeight: 12 },
  stopType: {
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  stopAddress: { fontSize: 13 },
  stopDivider: {
    borderTopWidth: 1,
    marginVertical: 12,
  },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  successIcon: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  successTitle: {
    fontSize: 28,
    textAlign: "center",
    marginBottom: 10,
  },
  successEarnings: {
    fontSize: 40,
    textAlign: "center",
    marginBottom: 12,
  },
  successSub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  driverActions: {
    flexDirection: "row",
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    alignItems: "center",
    gap: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, textAlign: "center" },
  modalSub: { fontSize: 14, textAlign: "center", marginBottom: 4 },
  phoneBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
    justifyContent: "center",
    marginVertical: 8,
  },
  phoneNumber: { fontSize: 20, letterSpacing: 1 },
  safetyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  cancelAlertBtn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
    marginTop: 4,
  },
  cancelAlertText: {
    color: "#EF4444",
    fontSize: 15,
  },
  navOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  navOptionText: {
    flex: 1,
    fontSize: 15,
  },
});
