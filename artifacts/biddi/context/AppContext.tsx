import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Alert, AppState, Platform } from "react-native";
import { useRouter } from "expo-router";

import {
  api,
  ApiError,
  loadAndValidatePersistedApiBase,
  loadToken,
  getTokenSync,
  clearPersistedApiBase,
  persistApiBase,
  setBaseUrl,
  setToken,
  getBaseUrl,
} from "@/lib/api";
import { defaultApiBase, hasEnvApiBase } from "@/lib/apiBase";
import { getActiveVehicleTypes, estimateFare } from "@/hooks/useVehicleTypes";
import {
  type ApiRide,
  type ApiUser,
  rideToView,
} from "@/lib/apiTypes";
import { connectSocket, disconnectSocket, getSessionGeneration, getSocket } from "@/lib/socket";
import { startLocationStream, stopLocationStream } from "@/lib/locationStream";
import { loadConfig } from "@/lib/config";
import type {
  AppMode,
  DriverIncomingRequest,
  DriverStatus,
  DriverTrip,
  EarningsEntry,
  Place,
  RideRequest,
  SavedPlace,
  User,
  Vehicle,
} from "@/lib/types";
import { fetchRoute } from "@/lib/maps";
import i18n from "@/i18n";
import {
  playCategorySound,
  stopCategorySound,
  invalidateSoundManifest,
} from "@/lib/notificationSounds";

/** A ride the rider is composing on the confirm-ride screen but hasn't
 * submitted yet. Holding it in context (rather than route params) lets us
 * render the same map + route on multiple intermediate screens (pin picker)
 * without re-fetching or re-encoding through deep-link params. */
export interface PendingRide {
  pickup: Place;
  dropoff: Place;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  routePolyline: string | null;
  /** Suggested fare derived from the cheapest active vehicle type's
   * base + per-km + per-min rates (with peak/night windows and minimum-fare
   * floor). The confirm-ride screen uses this as the slider's anchor. */
  suggestedFare: number;
}

// ---------------------------------------------------------------------------
// Sub-context interfaces
// ---------------------------------------------------------------------------

export interface AuthState {
  ready: boolean;
  user: User | null;
  submittedDocs: Array<{ type: string; url: string; status?: "pending" | "approved" | "rejected"; rejectionReason?: string }>;
  /** Server-computed driver acceptance rate (0–100). `null` when fewer than
   *  5 ride requests have been dispatched to this driver. */
  acceptanceRate: number | null;
  /** Server-computed driver cancellation rate (0–100). `null` when fewer
   *  than 5 rides have been accepted by this driver. */
  cancellationRate: number | null;
  lastOtpDevCode: string | null;
  authError: string | null;
  requestOtp: (phone: string) => Promise<{ devCode: string | null }>;
  verifyOtp: (
    phone: string,
    code: string,
    firstName?: string,
    countryCode?: string,
  ) => Promise<{ needsProfileCompletion: boolean }>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  completeProfile: (input: {
    firstName: string;
    lastName?: string;
    email: string;
    password: string;
    referredByCode?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (firstName: string, lastName: string) => Promise<void>;
  refreshUser: () => Promise<User | null>;
  switchAppMode: (mode: AppMode) => Promise<void>;
}

export interface SubmittedDoc {
  type: string;
  url: string;
}

export interface SubmittedDocInfo {
  type: string;
  url: string;
  status?: "pending" | "approved" | "rejected";
  rejectionReason?: string;
}

export interface VehicleState {
  vehicle: Vehicle | null;
  submittedDocTypes: string[];
  submittedDocs: SubmittedDocInfo[];
  applyDriver: (vehicle: Vehicle, docs?: SubmittedDoc[]) => Promise<void>;
  updateVehicle: (vehicle: Vehicle) => Promise<void>;
  updateDocs: (docs: SubmittedDoc[]) => Promise<void>;
  setDriverStatus: (status: DriverStatus) => Promise<void>;
}

export interface RideState {
  ride: RideRequest | null;
  pendingRide: PendingRide | null;
  requestRide: (
    pickup: Place,
    dropoff: Place,
    opts?: {
      initialFare?: number;
      vehicleClass?: string;
      vehicleTypeId?: string;
      isShared?: boolean;
      seatsRequested?: number;
      wheelchairRequested?: boolean;
      petRequested?: boolean;
      assistRequested?: boolean;
      couponId?: string | null;
    },
  ) => Promise<void>;
  cancelRide: () => Promise<void>;
  setPendingRide: (pickup: Place, dropoff: Place) => Promise<PendingRide>;
  clearPendingRide: () => void;
  acceptBid: (bidId: string) => Promise<void>;
  startTrip: () => Promise<void>;
  completeTrip: () => Promise<void>;
  rateAndClose: (score: number, comment?: string) => Promise<void>;
}

export interface DriverState {
  earnings: EarningsEntry[];
  earningsStale: boolean;
  driverOnline: boolean;
  driverIncoming: DriverIncomingRequest[];
  driverTrip: DriverTrip | null;
  setDriverOnline: (online: boolean) => Promise<void>;
  placeDriverBid: (requestId: string, amount: number) => Promise<void>;
  declineDriverRequest: (requestId: string) => void;
  driverArrived: () => Promise<void>;
  driverEndTrip: (waitingMinutes?: number) => Promise<{ queuedActivated: boolean }>;
  driverCancelTrip: (input: { reasonId?: string; reasonText?: string }) => Promise<void>;
}

export interface PlacesState {
  savedPlaces: SavedPlace[];
  recentPlaces: SavedPlace[];
  refreshPlaces: () => Promise<void>;
  addSavedPlace: (place: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    googlePlaceId?: string;
  }) => Promise<void>;
  deleteSavedPlace: (id: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Reconnect context
// ---------------------------------------------------------------------------

export interface ReconnectState {
  isReconnecting: boolean;
  attempt: number;
  maxAttempts: number;
  socketConnected: boolean;
  /** Monotonically increments each time the socket successfully reconnects.
   * Components can use this as a stable effect dependency: unlike
   * `socketConnected` (which pulses true then false), this value only ever
   * increases, so it drives a one-shot effect rather than a rising/falling
   * edge pair. */
  reconnectKey: number;
}

// ---------------------------------------------------------------------------
// Context objects
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthState | undefined>(undefined);
const VehicleContext = createContext<VehicleState | undefined>(undefined);
const RideContext = createContext<RideState | undefined>(undefined);
const DriverContext = createContext<DriverState | undefined>(undefined);
export const ReconnectContext = createContext<ReconnectState>({
  isReconnecting: false,
  attempt: 0,
  maxAttempts: 5,
  socketConnected: false,
  reconnectKey: 0,
});
const PlacesContext = createContext<PlacesState | undefined>(undefined);

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function apiUserToUser(u: ApiUser | null | undefined): User | null {
  if (!u) return null;
  return {
    id: u.id,
    phone: u.phone ?? "",
    countryCode: u.countryCode ?? "",
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    email: u.email ?? null,
    hasPassword: !!u.hasPassword,
    referralCode: u.referralCode ?? null,
    appMode: u.appMode,
    driverStatus: u.driverStatus,
    photoUrl: u.photoUrl ?? null,
    driverRating: u.rating ?? null,
    driverRatingCount: u.driverRatingCount ?? 0,
    customerRating: u.customerRating ?? null,
    customerRatingCount: u.customerRatingCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [apiUserState, setApiUserState] = useState<ApiUser | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [ride, setRide] = useState<RideRequest | null>(null);
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [earningsStale, setEarningsStale] = useState(false);
  const [driverOnline, setDriverOnlineState] = useState(false);
  const [driverIncoming, setDriverIncoming] = useState<DriverIncomingRequest[]>([]);
  const [driverTrip, setDriverTrip] = useState<DriverTrip | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [recentPlaces, setRecentPlaces] = useState<SavedPlace[]>([]);
  const [pendingRide, setPendingRideState] = useState<PendingRide | null>(null);
  const [lastOtpDevCode, setLastOtpDevCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [reconnectStatus, setReconnectStatus] = useState<ReconnectState>({
    isReconnecting: false,
    attempt: 0,
    maxAttempts: 5,
    socketConnected: false,
    reconnectKey: 0,
  });
  const socketConnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ridePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const driverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const driverOnlineRef = useRef(false);
  const driverTripRef = useRef<DriverTrip | null>(null);
  // Tracks the most recent rideId that triggered the driver's incoming-bidding
  // modal so reconnect-replay socket events don't stack duplicate modals.
  const biddingModalRideIdRef = useRef<string | null>(null);

  useEffect(() => {
    driverOnlineRef.current = driverOnline;
  }, [driverOnline]);

  useEffect(() => {
    driverTripRef.current = driverTrip;
  }, [driverTrip]);

  // Clear the bidding-modal dedup ref once the tracked request has left the
  // driver's queue (rider accepted, expiry job ran, driver skipped). This
  // bounds the ref to one rideId at a time so it can't accumulate stale ids.
  useEffect(() => {
    const tracked = biddingModalRideIdRef.current;
    if (!tracked) return;
    if (!driverIncoming.some((r) => r.id === tracked)) {
      biddingModalRideIdRef.current = null;
    }
  }, [driverIncoming]);

  // ---- bootstrap: api base + token + restore session ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // When an explicit env URL is configured (EXPO_PUBLIC_API_BASE or
      // EXPO_PUBLIC_DOMAIN), give it unconditional priority so that scanning a
      // production QR code always connects to the production server even if a
      // dev URL was previously cached in SecureStore. Also delete the stale
      // entry so that a future dev build (without env vars) doesn't pick it up.
      let persisted: string | null;
      if (hasEnvApiBase()) {
        await clearPersistedApiBase();
        persisted = null;
      } else {
        persisted = await loadAndValidatePersistedApiBase();
      }
      const base = persisted || defaultApiBase();
      setBaseUrl(`${base}/api`);
      await loadToken();
      // Mirror baseUrl + token into the generated React Query client so
      // hooks from @workspace/api-client-react reach the same backend.
      const { setBaseUrl: setRqBase, setAuthTokenGetter } = await import(
        "@workspace/api-client-react"
      );
      setRqBase(base);
      setAuthTokenGetter(() => getTokenSync());
      try {
        const me = await api<{ user?: ApiUser } | null>("/auth/me");
        if (cancelled) return;
        if (me && me.user) {
          setApiUserState(me.user);
          setUser(apiUserToUser(me.user));
          setDriverOnlineState(!!me.user.driverOnline);
        }
      } catch {
        // not signed in — fine
      }
      // Load public config (Google Maps key) eagerly; ignore errors.
      loadConfig().catch(() => {});
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- helpers ----
  const refreshMe = useCallback(async (): Promise<User | null> => {
    const me = await api<{ user?: ApiUser } | null>("/auth/me");
    if (!me || !me.user) return null;
    const next = me.user;
    setApiUserState((prev) => {
      if (
        prev &&
        prev.id === next.id &&
        prev.phone === next.phone &&
        prev.countryCode === next.countryCode &&
        prev.firstName === next.firstName &&
        prev.lastName === next.lastName &&
        prev.appMode === next.appMode &&
        prev.driverStatus === next.driverStatus &&
        prev.driverOnline === next.driverOnline &&
        prev.rating === next.rating &&
        prev.driverRatingCount === next.driverRatingCount &&
        prev.trips === next.trips &&
        (prev.customerRating ?? null) === (next.customerRating ?? null) &&
        prev.customerRatingCount === next.customerRatingCount &&
        prev.photoUrl === next.photoUrl &&
        (prev.acceptanceRate ?? null) === (next.acceptanceRate ?? null) &&
        (prev.cancellationRate ?? null) === (next.cancellationRate ?? null) &&
        prev.submittedDocs.length === next.submittedDocs.length &&
        prev.submittedDocs.every((d, i) =>
          d.type === next.submittedDocs[i].type &&
          d.url === next.submittedDocs[i].url &&
          d.status === next.submittedDocs[i].status &&
          d.rejectionReason === next.submittedDocs[i].rejectionReason
        )
      )
        return prev;
      return next;
    });
    setUser((prev) => {
      const nextUser = apiUserToUser(next);
      if (
        prev &&
        nextUser &&
        prev.phone === nextUser.phone &&
        prev.countryCode === nextUser.countryCode &&
        prev.firstName === nextUser.firstName &&
        prev.lastName === nextUser.lastName &&
        prev.appMode === nextUser.appMode &&
        prev.driverStatus === nextUser.driverStatus &&
        prev.photoUrl === nextUser.photoUrl &&
        (prev.driverRating ?? null) === (nextUser.driverRating ?? null) &&
        (prev.driverRatingCount ?? 0) === (nextUser.driverRatingCount ?? 0) &&
        (prev.customerRating ?? null) === (nextUser.customerRating ?? null) &&
        (prev.customerRatingCount ?? 0) === (nextUser.customerRatingCount ?? 0)
      )
        return prev;
      return nextUser;
    });
    setDriverOnlineState(!!next.driverOnline);
    return apiUserToUser(next);
  }, []);

  const riderRatingNavigatedRef = useRef<string | null>(null);

  const refreshActiveRide = useCallback(async () => {
    try {
      const r = await api<{ ride: ApiRide | null }>("/rides/active");
      if (!r.ride) {
        setRide((prev) => (prev && prev.status !== "completed" ? null : prev));
        return;
      }
      if (r.ride.status === "completed" && r.ride.ratingScore == null && riderRatingNavigatedRef.current !== r.ride.id) {
        riderRatingNavigatedRef.current = r.ride.id;
        router.push("/(rider)/rate");
      }
      const next = rideToView(r.ride);
      setRide((prev) => {
        if (!prev) return next;
        const key = (ride: typeof next) =>
          `${ride.id}|${ride.status}|${ride.acceptedBidId ?? ""}|${ride.sharedRidersCount ?? 1}|${ride.finalAmount ?? ""}|${ride.bids.map((b) => `${b.id}:${b.amount}`).join(",")}`;
        return key(prev) === key(next) ? prev : next;
      });
    } catch {
      /* ignore */
    }
  }, [router]);

  const driverRatingNavigatedRef = useRef<string | null>(null);

  const refreshDriverState = useCallback(async () => {
    try {
      let earnFailed = false;
      const [reqs, tripResp, ern] = await Promise.all([
        api<{ requests: DriverIncomingRequest[] }>("/driver/requests").catch(() => ({ requests: [] })),
        api<{ trip: DriverTrip | null; pendingCustomerRating?: { rideId: string; riderName: string } | null }>("/driver/trip").catch(() => ({ trip: null, pendingCustomerRating: null })),
        api<{ earnings: EarningsEntry[] }>("/driver/earnings").catch((): { earnings: EarningsEntry[] } | null => {
          earnFailed = true;
          return null;
        }),
      ]);
      const trip = { trip: tripResp?.trip ?? null };
      if (
        tripResp?.pendingCustomerRating &&
        !tripResp?.trip &&
        driverRatingNavigatedRef.current !== tripResp.pendingCustomerRating.rideId
      ) {
        driverRatingNavigatedRef.current = tripResp.pendingCustomerRating.rideId;
        const { rideId, riderName } = tripResp.pendingCustomerRating;
        router.push({ pathname: "/(driver)/rate", params: { rideId, riderName } });
      }
      setDriverIncoming((prev) => {
        const requests = reqs?.requests ?? [];
        const prevKey = prev.map((r) => r.id).join(",");
        const nextKey = requests.map((r) => r.id).join(",");
        return prevKey === nextKey ? prev : requests;
      });
      setDriverTrip((prev) => {
        const next = trip.trip;
        if (!prev || !next) return prev === next ? prev : next;
        const key = (t: DriverTrip) =>
          `${t.id}|${t.status}|${t.amount}|${t.pickupLat ?? ""}|${t.pickupLng ?? ""}|${t.dropoffLat ?? ""}|${t.dropoffLng ?? ""}|${t.waitingFeePerMin ?? ""}|${t.isShared ? 1 : 0}|${t.sharedGroupId ?? ""}|${(t.stops ?? []).map((s) => `${s.type}:${s.rideId}`).join(",")}`;
        return key(prev) === key(next) ? prev : next;
      });
      if (earnFailed || !ern || !Array.isArray(ern.earnings)) {
        setEarningsStale(true);
      } else {
        setEarningsStale(false);
        setEarnings((prev) => {
          const prevKey = prev.map((e) => e.id).join(",");
          const nextKey = ern.earnings.map((e) => e.id).join(",");
          return prevKey === nextKey ? prev : ern.earnings;
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refreshPlaces = useCallback(async () => {
    try {
      const r = await api<{ saved?: SavedPlace[]; recent?: SavedPlace[] }>("/places");
      setSavedPlaces(Array.isArray(r?.saved) ? r.saved : []);
      setRecentPlaces(Array.isArray(r?.recent) ? r.recent : []);
    } catch {
      /* ignore — keep last known good lists */
    }
  }, []);

  const addSavedPlace = useCallback(
    async (place: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      googlePlaceId?: string;
    }) => {
      await api("/places", { method: "POST", json: place });
      await refreshPlaces();
    },
    [refreshPlaces],
  );

  const deleteSavedPlace = useCallback(
    async (id: string) => {
      await api(`/places/${id}`, { method: "DELETE" });
      await refreshPlaces();
    },
    [refreshPlaces],
  );

  const refreshVehicle = useCallback(async () => {
    try {
      const v = await api<{ vehicle: Vehicle | null }>("/drivers/vehicle");
      setVehicle(v.vehicle ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  // ---- in-app ringtone for driver incoming requests ----
  // When the driver sees one or more pending ride requests we loop the
  // admin-configured "newTripRequest" sound until the request is accepted,
  // declined, or expires (i.e. driverIncoming becomes empty). On rider/driver
  // mode flips or sign-out we make sure the sound is stopped.
  useEffect(() => {
    if (!user || user.appMode !== "driver") {
      void stopCategorySound();
      return;
    }
    if (driverIncoming.length > 0) {
      void playCategorySound("newTripRequest", true);
    } else {
      void stopCategorySound();
    }
  }, [user, driverIncoming.length]);

  // Refresh the sound manifest whenever the app comes back to the foreground
  // so that admin changes take effect without waiting out the in-memory TTL.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") invalidateSoundManifest();
    });
    return () => sub.remove();
  }, []);

  // ---- push notification tap handler ----
  // Covers foreground/background taps via the listener, and cold-start
  // (app launched from a killed state by tapping a notification) via
  // getLastNotificationResponseAsync which is checked once on mount.
  useEffect(() => {
    const handleNotificationData = (data: Record<string, unknown> | undefined) => {
      if (data?.type === "driver_rejected") {
        router.push("/reupload-docs");
      }
    };

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        handleNotificationData(data);
      }
    }).catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      handleNotificationData(data);
    });
    return () => subscription.remove();
  }, [router]);

  // ---- push token registration ----
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        if (Platform.OS === "web") return;
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;
        const projectId =
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
            ?.eas?.projectId ??
          (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId ??
          undefined;
        const tokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        await api("/user/push-token", {
          method: "POST",
          json: { token: tokenData.data },
        });
      } catch (err) {
        console.warn("[push] failed to register push token:", err);
      }
    })();
  }, [user?.phone]);

  // ---- socket lifecycle ----
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    let attachedSock: Awaited<ReturnType<typeof connectSocket>> | null = null;
    const sessionGen = getSessionGeneration();

    const onConnectError = (err: Error) => {
      console.warn("[socket] connection error:", err.message);
    };
    const onAny = () => {
      if (user.appMode === "rider") refreshActiveRide();
      else refreshDriverState();
    };
    // When the driver cancels mid-pickup the rider needs a clear, blocking
    // alert in addition to the ride state being cleared, so they understand
    // why the trip screen disappeared and can request a new ride.
    const onRideCancelled = (payload?: { cancelledBy?: string; reason?: string | null }) => {
      onAny();
      if (user.appMode === "rider" && payload?.cancelledBy === "driver") {
        const body = payload.reason
          ? `${i18n.t("riderTrip.rideCancelledByDriverBody")}\n\n${payload.reason}`
          : i18n.t("riderTrip.rideCancelledByDriverBody");
        Alert.alert(i18n.t("riderTrip.rideCancelledByDriverTitle"), body);
      }
    };
    // Reconnect automatically when a network drop causes the socket to
    // disconnect while the app is still in the foreground.
    // Uses exponential back-off: 2 s → 4 s → 8 s → 16 s → 30 s (capped).
    const MAX_RECONNECT_ATTEMPTS = 5;
    const BASE_RECONNECT_DELAY_MS = 2000;
    const MAX_RECONNECT_DELAY_MS = 30000;

    /** Waits up to `timeoutMs` for the socket to either connect or error. */
    function waitForConnect(
      sock: import("socket.io-client").Socket,
      timeoutMs: number,
    ): Promise<boolean> {
      return new Promise((resolve) => {
        let settled = false;
        const settle = (result: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          sock.off("connect", onOk);
          sock.off("connect_error", onErr);
          resolve(result);
        };
        const onOk = () => settle(true);
        const onErr = () => settle(false);
        const timer = setTimeout(() => settle(false), timeoutMs);
        sock.once("connect", onOk);
        sock.once("connect_error", onErr);
      });
    }

    let reconnecting = false;
    const onDisconnect = async (reason: string) => {
      if (!mounted || AppState.currentState !== "active") return;
      if (reason !== "transport error" && reason !== "transport close") return;
      if (reconnecting) return;
      reconnecting = true;

      let newSock: import("socket.io-client").Socket | null = null;

      try {
        for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
          if (!mounted || AppState.currentState !== "active") break;

          if (mounted) {
            setReconnectStatus((prev) => ({
              ...prev,
              isReconnecting: true,
              attempt: attempt + 1,
              maxAttempts: MAX_RECONNECT_ATTEMPTS,
            }));
          }

          const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt),
            MAX_RECONNECT_DELAY_MS,
          );
          console.warn(
            `[socket] network drop – reconnect attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000} s…`,
          );
          await new Promise((r) => setTimeout(r, delay));

          if (!mounted || AppState.currentState !== "active") break;

          const candidate = await connectSocket(sessionGen);
          if (!candidate) break; // session invalidated – give up

          // If the socket was already connected (e.g. reused), accept it.
          if (candidate.connected) {
            newSock = candidate;
            break;
          }

          // Wait up to 8 s to confirm the new connection attempt.
          const connected = await waitForConnect(candidate, 8000);
          if (connected) {
            newSock = candidate;
            break;
          }

          console.warn(`[socket] reconnect attempt ${attempt + 1} failed`);
        }
      } finally {
        reconnecting = false;
        if (mounted) {
          setReconnectStatus((prev) => ({
            ...prev,
            isReconnecting: false,
            attempt: 0,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
          }));
        }
      }

      if (!newSock) {
        console.warn("[socket] all reconnect attempts exhausted");
        if (mounted) {
          Alert.alert(
            "Connection lost",
            "Unable to reconnect to the server. Please check your network and reopen the app.",
          );
        }
        return;
      }

      if (!mounted) return;
      if (socketConnectedTimerRef.current) clearTimeout(socketConnectedTimerRef.current);
      setReconnectStatus((prev) => ({
        ...prev,
        isReconnecting: false,
        attempt: 0,
        socketConnected: true,
        reconnectKey: prev.reconnectKey + 1,
      }));
      socketConnectedTimerRef.current = setTimeout(
        () => setReconnectStatus((prev) => ({ ...prev, socketConnected: false })),
        2000,
      );
      if (newSock === attachedSock) return;
      if (attachedSock) detachListeners(attachedSock);
      attachedSock = newSock;
      attachListeners(newSock);
    };

    // Re-emit "driver:online" whenever the socket (re)connects so the server
    // re-adds the driver to the correct room and syncs driverOnline in the DB.
    //
    // This handler is registered on the socket's "connect" event inside
    // attachListeners, so it fires on:
    //   - The initial connection.
    //   - Any reconnection made by our custom onDisconnect loop (which calls
    //     connectSocket() and then attachListeners() on the new socket).
    //   - Any reconnection triggered by the foreground-resume AppState handler.
    //
    // Dependency on reconnection: false (socket.ts)
    // Socket.IO's built-in reconnection is disabled in socket.ts to keep this
    // logic predictable. If it were ever re-enabled, Socket.IO could silently
    // reconnect at the transport layer while the app is backgrounded. In that
    // case the "connect" event would still fire on the same socket instance
    // that already has this listener attached, so the re-emit WOULD occur —
    // but the full flow (session-generation safety, driverOnlineRef accuracy,
    // and the custom reconnect loop not racing with Socket.IO's built-in one)
    // must be re-verified before enabling reconnection in socket.ts.
    const onSocketConnect = (sock: NonNullable<typeof attachedSock>) => {
      if (user?.driverStatus === "approved" && driverOnlineRef.current) {
        sock.emit("driver:online", true);
      }
    };

    // Latest bidding request ride id surfaced via the modal. Used to dedupe
    // when the server replays the same socket event (e.g. on reconnect) so
    // the driver doesn't get two stacked modals for the same post.
    const onBiddingRequest = (payload: unknown) => {
      onAny();
      if (!user || user.appMode !== "driver") return;
      if (!driverOnlineRef.current) return;
      // Skip the auto-modal if the driver is already in an active trip — the
      // request still shows up in driverIncoming list for awareness once the
      // trip ends, but we don't interrupt navigation.
      const activeTrip = driverTripRef.current;
      if (
        activeTrip &&
        (activeTrip.status === "driver_arriving" || activeTrip.status === "in_progress")
      ) {
        return;
      }
      const rideId =
        typeof payload === "object" && payload !== null && "id" in payload
          ? String((payload as { id: unknown }).id ?? "")
          : "";
      if (!rideId) return;
      if (biddingModalRideIdRef.current === rideId) return;
      biddingModalRideIdRef.current = rideId;
      router.push({
        pathname: "/(driver)/incoming-bidding",
        params: { rideId },
      });
    };

    const onAdminForceOffline = () => {
      setDriverOnlineState(false);
      const sock = getSocket();
      if (sock) sock.emit("driver:online", false);

      const activeTrip = driverTripRef.current;
      const hasActiveTrip =
        activeTrip !== null &&
        (activeTrip.status === "driver_arriving" || activeTrip.status === "in_progress");

      if (hasActiveTrip) {
        Alert.alert(
          "Trip interrupted",
          "An admin has taken you offline while you had an active trip. The ride has been interrupted — please contact support for assistance.",
          [{ text: "OK" }],
        );
      } else {
        Alert.alert(
          "Taken offline",
          "An admin has set you to offline. You will no longer receive new ride requests.",
          [{ text: "OK" }],
        );
      }
    };

    const onAdminSwitchToRider = () => {
      const activeTrip = driverTripRef.current;
      const hasActiveTrip =
        activeTrip !== null &&
        (activeTrip.status === "driver_arriving" || activeTrip.status === "in_progress");

      const doSwitch = async () => {
        await refreshMe();
        setDriverOnlineState(false);
        setDriverIncoming([]);
        setDriverTrip(null);
        router.replace("/(rider)/home");
      };

      if (hasActiveTrip) {
        Alert.alert(
          "Trip interrupted",
          "An admin has switched your account to rider mode while you had an active trip. The ride has been interrupted — please contact support for assistance.",
          [{ text: "OK", onPress: doSwitch }],
        );
      } else {
        Alert.alert(
          "Mode changed",
          "An admin has switched your account to rider mode.",
          [{ text: "OK", onPress: doSwitch }],
        );
      }
    };

    function attachListeners(sock: NonNullable<typeof attachedSock>) {
      sock.on("connect_error", onConnectError);
      sock.on("disconnect", onDisconnect);
      sock.on("ride:new", onAny);
      sock.on("ride:cancelled", onRideCancelled);
      sock.on("ride:accepted", onAny);
      sock.on("ride:status", onAny);
      sock.on("ride:completed", onAny);
      sock.on("bid:new", onAny);
      // inDrive-style bidding events. `bidding:request` fires on drivers
      // when a rider posts a new bidding ride; `bidding:new-offer` /
      // `bidding:accepted` / `bidding:lost` / `bidding:offer-withdrawn`
      // fire on riders + driver(s) as the negotiation progresses.
      sock.on("bidding:request", onBiddingRequest);
      sock.on("bidding:new-offer", onAny);
      sock.on("bidding:offer-withdrawn", onAny);
      sock.on("bidding:accepted", onAny);
      sock.on("bidding:lost", onAny);
      sock.on("bidding:offer-expired", onAny);
      // Queued-ride lifecycle events: refresh the active ride / driver
      // trip state so the queued-ride UI surfaces the new candidate /
      // accepted / activated / declined transition without waiting for the
      // next poll cycle.
      sock.on("queuedRideRequest", onAny);
      sock.on("queuedRideAccepted", onAny);
      sock.on("queuedRideActivated", onAny);
      sock.on("queuedRideDeclined", onAny);
      sock.on("currentTripCompleted", onAny);
      sock.on("user:status_changed", refreshMe);
      sock.on("admin:force_offline", onAdminForceOffline);
      sock.on("admin:switch_to_rider", onAdminSwitchToRider);
      sock.on("connect", () => onSocketConnect(sock));
      if (sock.connected) onSocketConnect(sock);
    }

    function detachListeners(sock: NonNullable<typeof attachedSock>) {
      sock.off("connect_error", onConnectError);
      sock.off("disconnect", onDisconnect);
      sock.off("ride:new", onAny);
      sock.off("ride:cancelled", onRideCancelled);
      sock.off("ride:accepted", onAny);
      sock.off("ride:status", onAny);
      sock.off("ride:completed", onAny);
      sock.off("bid:new", onAny);
      sock.off("bidding:request", onBiddingRequest);
      sock.off("bidding:new-offer", onAny);
      sock.off("bidding:offer-withdrawn", onAny);
      sock.off("bidding:accepted", onAny);
      sock.off("bidding:lost", onAny);
      sock.off("bidding:offer-expired", onAny);
      sock.off("queuedRideRequest", onAny);
      sock.off("queuedRideAccepted", onAny);
      sock.off("queuedRideActivated", onAny);
      sock.off("queuedRideDeclined", onAny);
      sock.off("currentTripCompleted", onAny);
      sock.off("user:status_changed", refreshMe);
      sock.off("admin:force_offline", onAdminForceOffline);
      sock.off("admin:switch_to_rider", onAdminSwitchToRider);
      sock.off("connect");
    }

    (async () => {
      // Pass the captured generation so connectSocket() can detect if logout
      // ran during the token lookup and return null immediately, preventing
      // any orphaned socket from being created for a stale session.
      const sock = await connectSocket(sessionGen);
      if (!sock || !mounted) return;
      attachedSock = sock;
      attachListeners(sock);
      refreshActiveRide();
      refreshVehicle();
      refreshPlaces();
      if (user.appMode === "driver") refreshDriverState();
    })();

    // When the app returns to the foreground, reconnect manually if needed.
    // Because reconnection is disabled in socket.ts, no dangling reconnect
    // timer can fire for a stale session while the app is backgrounded.
    const appStateSub = AppState.addEventListener("change", async (nextState) => {
      if (nextState !== "active") return;
      const newSock = await connectSocket(sessionGen);
      if (!newSock || !mounted) return;
      if (newSock === attachedSock) return;
      if (attachedSock) detachListeners(attachedSock);
      attachedSock = newSock;
      attachListeners(newSock);
    });

    return () => {
      mounted = false;
      appStateSub.remove();
      if (attachedSock) detachListeners(attachedSock);
    };
  }, [user, refreshActiveRide, refreshDriverState, refreshVehicle, refreshPlaces, refreshMe]);

  // ---- polling fallback while screens are open ----
  useEffect(() => {
    if (!user || user.appMode !== "rider") return;
    refreshActiveRide();
    ridePollRef.current = setInterval(refreshActiveRide, 4000);
    return () => {
      if (ridePollRef.current) clearInterval(ridePollRef.current);
    };
  }, [user, refreshActiveRide]);

  useEffect(() => {
    if (!user || user.appMode !== "driver" || user.driverStatus !== "approved") return;
    refreshDriverState();
    driverPollRef.current = setInterval(refreshDriverState, 5000);
    return () => {
      if (driverPollRef.current) clearInterval(driverPollRef.current);
    };
  }, [user, refreshDriverState]);

  // ---- driver GPS streaming for the admin live map ----
  useEffect(() => {
    const shouldStream =
      !!user &&
      user.appMode === "driver" &&
      user.driverStatus === "approved" &&
      (driverOnline || !!driverTrip);
    if (shouldStream) {
      startLocationStream();
    } else {
      stopLocationStream();
    }
    return () => {
      if (!shouldStream) stopLocationStream();
    };
  }, [user, driverOnline, driverTrip]);

  // ---- auth ----
  const requestOtp = useCallback(async (phone: string) => {
    setAuthError(null);
    try {
      const r = await api<{ devCode: string | null }>("/auth/request-otp", {
        method: "POST",
        json: { phone },
      });
      setLastOtpDevCode(r.devCode);
      return { devCode: r.devCode };
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "request_failed";
      setAuthError(msg);
      throw e;
    }
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, code: string, firstName?: string, countryCode?: string) => {
      setAuthError(null);
      const r = await api<{
        token?: string;
        user?: ApiUser;
        needsProfileCompletion?: boolean;
      } | null>(
        "/auth/verify-otp",
        { method: "POST", json: { phone, code, firstName, countryCode } },
      );
      if (!r || !r.token || !r.user) {
        throw new Error("Sign-in did not return a session. Please try again.");
      }
      await setToken(r.token);
      setApiUserState(r.user);
      setUser(apiUserToUser(r.user));
      setDriverOnlineState(!!r.user.driverOnline);
      setLastOtpDevCode(null);
      const base = getBaseUrl().replace(/\/api$/, "");
      if (base) await persistApiBase(base);
      return { needsProfileCompletion: !!r.needsProfileCompletion };
    },
    [],
  );

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const r = await api<{ token?: string; user?: ApiUser } | null>(
      "/auth/login",
      { method: "POST", json: { email, password } },
    );
    if (!r || !r.token || !r.user) {
      throw new Error("Sign-in did not return a session. Please try again.");
    }
    await setToken(r.token);
    setApiUserState(r.user);
    setUser(apiUserToUser(r.user));
    setDriverOnlineState(!!r.user.driverOnline);
    const base = getBaseUrl().replace(/\/api$/, "");
    if (base) await persistApiBase(base);
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setAuthError(null);
    await setToken(token);
    const me = await api<{ user?: ApiUser } | null>("/auth/me");
    if (!me || !me.user) {
      await setToken(null);
      throw new Error("Stored credentials are no longer valid.");
    }
    setApiUserState(me.user);
    setUser(apiUserToUser(me.user));
    setDriverOnlineState(!!me.user.driverOnline);
  }, []);

  const completeProfile = useCallback(
    async (input: {
      firstName: string;
      lastName?: string;
      email: string;
      password: string;
      referredByCode?: string;
    }) => {
      const r = await api<{ user?: ApiUser } | null>("/auth/complete-profile", {
        method: "POST",
        json: input,
      });
      if (r && r.user) {
        setApiUserState(r.user);
        setUser(apiUserToUser(r.user));
      } else {
        await refreshMe();
      }
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    stopLocationStream();
    disconnectSocket();
    await setToken(null);
    // Also clear biometric-stored token so the next user's device doesn't
    // see a leftover Face ID prompt for the previous account.
    try {
      const { disableBiometricLogin } = await import("@/lib/biometric");
      await disableBiometricLogin();
    } catch {
      /* ignore */
    }
    setUser(null);
    setApiUserState(null);
    setRide(null);
    setVehicle(null);
    setEarnings([]);
    setEarningsStale(false);
    setDriverIncoming([]);
    setDriverTrip(null);
    setDriverOnlineState(false);
    biddingModalRideIdRef.current = null;
  }, []);

  // ---- profile ----
  const applyUserResponse = useCallback(
    async (r: { user?: ApiUser } | null | undefined) => {
      if (r && r.user) {
        setApiUserState(r.user);
        setUser(apiUserToUser(r.user));
      } else {
        await refreshMe();
      }
    },
    [refreshMe],
  );

  const updateProfile = useCallback(
    async (firstName: string, lastName: string) => {
      const r = await api<{ user?: ApiUser }>("/users/me", {
        method: "PATCH",
        json: { firstName, lastName },
      });
      await applyUserResponse(r);
    },
    [applyUserResponse],
  );

  const switchAppMode = useCallback(
    async (mode: AppMode) => {
      const r = await api<{ user?: ApiUser }>("/users/me", {
        method: "PATCH",
        json: { appMode: mode },
      });
      // Clear the bidding-modal dedup ref so a request that was previously
      // surfaced in this session can re-trigger after the user returns to
      // driver mode (or the next driver session sees a fresh ref).
      biddingModalRideIdRef.current = null;
      await applyUserResponse(r);
    },
    [applyUserResponse],
  );

  // ---- driver onboarding ----
  const applyDriver = useCallback(
    async (v: Vehicle, docs?: SubmittedDoc[]) => {
      const r = await api<{ user?: ApiUser }>("/drivers/apply", {
        method: "POST",
        json: { ...v, docs },
      });
      setVehicle(v);
      await applyUserResponse(r);
    },
    [applyUserResponse],
  );

  const updateVehicle = useCallback(async (v: Vehicle) => {
    await api("/drivers/vehicle", { method: "PUT", json: v });
    setVehicle(v);
  }, []);

  const updateDocs = useCallback(
    async (docs: SubmittedDoc[]) => {
      const r = await api<{ user?: ApiUser }>("/drivers/documents", {
        method: "PUT",
        json: { docs },
      });
      await applyUserResponse(r);
    },
    [applyUserResponse],
  );

  const setDriverStatusFn = useCallback(
    async (_status: DriverStatus) => {
      await refreshMe();
    },
    [refreshMe],
  );

  // ---- rider flow ----
  const requestRide = useCallback(
    async (
      pickup: Place,
      dropoff: Place,
      opts?: {
        initialFare?: number;
        vehicleClass?: string;
        vehicleTypeId?: string;
        isShared?: boolean;
        seatsRequested?: number;
        wheelchairRequested?: boolean;
        petRequested?: boolean;
        assistRequested?: boolean;
        couponId?: string | null;
      },
    ) => {
      const r = await api<{ ride: ApiRide }>("/rides", {
        method: "POST",
        json: {
          pickupLabel: pickup.label,
          pickupAddress: pickup.address,
          dropoffLabel: dropoff.label,
          dropoffAddress: dropoff.address,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          dropoffGooglePlaceId: dropoff.googlePlaceId,
          initialFare: opts?.initialFare || undefined,
          vehicleClass: opts?.vehicleClass,
          vehicleTypeId: opts?.vehicleTypeId,
          isShared: opts?.isShared,
          seatsRequested: opts?.seatsRequested,
          wheelchairRequested: opts?.wheelchairRequested,
          petRequested: opts?.petRequested,
          assistRequested: opts?.assistRequested,
          couponId: opts?.couponId ?? undefined,
        },
      });
      setRide(rideToView(r.ride));
      setPendingRideState(null);
      refreshPlaces().catch(() => {});
    },
    [refreshPlaces],
  );

  const setPendingRide = useCallback(
    async (pickup: Place, dropoff: Place): Promise<PendingRide> => {
      let distance = 0;
      let duration = 0;
      let polyline: string | null = null;

      if (
        pickup.lat !== undefined &&
        pickup.lng !== undefined &&
        dropoff.lat !== undefined &&
        dropoff.lng !== undefined
      ) {
        const r = await fetchRoute(
          { lat: pickup.lat, lng: pickup.lng },
          { lat: dropoff.lat, lng: dropoff.lng },
        ).catch(() => null);
        if (r) {
          distance = r.distanceKm;
          duration = r.durationMin;
          polyline = r.polyline ?? null;
        } else {
          const toRad = (d: number) => (d * Math.PI) / 180;
          const R = 6371;
          const dLat = toRad(dropoff.lat - pickup.lat);
          const dLng = toRad(dropoff.lng - pickup.lng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(pickup.lat)) *
              Math.cos(toRad(dropoff.lat)) *
              Math.sin(dLng / 2) ** 2;
          distance = Math.round(2 * R * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10;
          duration = Math.max(6, Math.round(distance * 3));
        }
      } else {
        distance = 5;
        duration = 15;
      }

      let suggestedFare = Math.max(5, Math.round((4 + distance * 1.6) * 10) / 10);
      try {
        const types = await getActiveVehicleTypes();
        const cheapest = types
          .map((t) => estimateFare(t, distance, duration))
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b)[0];
        if (cheapest != null) suggestedFare = cheapest;
      } catch {
        /* keep fallback */
      }
      const pending: PendingRide = {
        pickup,
        dropoff,
        estimatedDistanceKm: distance,
        estimatedDurationMin: duration,
        routePolyline: polyline,
        suggestedFare,
      };
      setPendingRideState(pending);
      return pending;
    },
    [],
  );

  const clearPendingRide = useCallback(() => setPendingRideState(null), []);

  const cancelRide = useCallback(async () => {
    if (!ride) return;
    await api(`/rides/${ride.id}/cancel`, { method: "POST" });
    setRide(null);
  }, [ride]);

  const acceptBid = useCallback(
    async (bidId: string) => {
      if (!ride) return;
      // Use the bidding-specific endpoint so the server emits the named
      // bidding:accepted / bidding:lost events alongside ride:accepted —
      // losing drivers need bidding:lost to dismiss their modal.
      const r = await api<{ ride: ApiRide }>(
        `/bidding/posts/${ride.id}/accept-offer`,
        { method: "POST", json: { bidId } },
      );
      setRide(rideToView(r.ride));
    },
    [ride],
  );

  const startTrip = useCallback(async () => {
    if (!ride) return;
    await api(`/rides/${ride.id}/start`, { method: "POST" });
    await refreshActiveRide();
  }, [ride, refreshActiveRide]);

  const completeTrip = useCallback(async () => {
    if (!ride) return;
    await api(`/rides/${ride.id}/complete`, { method: "POST" });
    await refreshActiveRide();
  }, [ride, refreshActiveRide]);

  const rateAndClose = useCallback(
    async (score: number, comment?: string) => {
      if (ride) {
        try {
          await api(`/rides/${ride.id}/rate`, {
            method: "POST",
            json: { score, ...(comment ? { comment } : {}) },
          });
        } catch {
          /* ignore */
        }
      }
      setRide(null);
    },
    [ride],
  );

  // ---- driver flow ----
  const setDriverOnline = useCallback(async (online: boolean) => {
    setDriverOnlineState(online);
    try {
      await api("/driver/online", { method: "POST", json: { online } });
    } catch {
      setDriverOnlineState(!online);
      return;
    }
    const sock = getSocket();
    if (sock?.connected) {
      sock.emit("driver:online", online);
    }
    await refreshDriverState();
  }, [refreshDriverState]);

  const declineDriverRequest = useCallback((requestId: string) => {
    setDriverIncoming((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  const placeDriverBid = useCallback(
    async (requestId: string, amount: number) => {
      try {
        // Use the canonical bidding endpoint so the server emits the named
        // bidding:new-offer event (the legacy /driver/bids path emitted
        // bid:new and has been removed).
        const etaMin = Math.max(2, Math.round(2 + Math.random() * 7));
        await api("/bidding/offers", {
          method: "POST",
          json: { rideId: requestId, amount, etaMin },
        });
      } finally {
        await refreshDriverState();
      }
    },
    [refreshDriverState],
  );

  const driverArrived = useCallback(async () => {
    try {
      if (driverTrip) {
        const resp = await api<{ trip?: DriverTrip | null }>(`/rides/${driverTrip.id}/start`, {
          method: "POST",
        });
        // Apply the server-returned trip immediately so the UI flips to
        // in_progress within the API round-trip. refreshDriverState in
        // `finally` still runs as a safety net.
        if (resp?.trip) setDriverTrip(resp.trip);
      }
    } catch (err) {
      if (!(err instanceof ApiError && (err.message === "invalid_state" || err.status === 409))) throw err;
      // Silently absorb invalid_state — refreshDriverState in finally will self-correct the UI
    } finally {
      await refreshDriverState();
    }
  }, [driverTrip, refreshDriverState]);

  const driverCancelTrip = useCallback(
    async (input: { reasonId?: string; reasonText?: string }) => {
      try {
        if (driverTrip) {
          await api(`/rides/${driverTrip.id}/cancel-driver`, {
            method: "POST",
            json: {
              ...(input.reasonId ? { reasonId: input.reasonId } : {}),
              ...(input.reasonText ? { reasonText: input.reasonText } : {}),
            },
          });
        }
      } finally {
        await refreshDriverState();
      }
    },
    [driverTrip, refreshDriverState],
  );

  const driverEndTrip = useCallback(async (waitingMinutes?: number): Promise<{ queuedActivated: boolean }> => {
    let queuedActivated = false;
    try {
      if (driverTrip) {
        const resp = await api<{
          trip?: DriverTrip | null;
          queuedActivated?: { activatedRideId: string; rideStatus: string } | null;
        }>(`/rides/${driverTrip.id}/complete`, {
          method: "POST",
          json: waitingMinutes != null && waitingMinutes > 0 ? { waitingMinutes } : {},
        });
        // Apply the server-returned trip immediately so the UI reflects the
        // completed state without waiting on /driver/trip.
        if (resp?.trip) setDriverTrip(resp.trip);
        queuedActivated = !!resp?.queuedActivated;
      }
    } catch (err) {
      if (!(err instanceof ApiError && (err.message === "invalid_state" || err.status === 409))) throw err;
      // Silently absorb invalid_state — refreshDriverState below self-corrects the UI
    } finally {
      await refreshDriverState();
    }
    return { queuedActivated };
  }, [driverTrip, refreshDriverState]);

  // ---------------------------------------------------------------------------
  // Memoised sub-context values — each re-renders only its own consumers
  // ---------------------------------------------------------------------------

  const authValue = useMemo<AuthState>(
    () => ({
      ready,
      user,
      submittedDocs: apiUserState?.submittedDocs ?? [],
      acceptanceRate: apiUserState?.acceptanceRate ?? null,
      cancellationRate: apiUserState?.cancellationRate ?? null,
      lastOtpDevCode,
      authError,
      requestOtp,
      verifyOtp,
      loginWithPassword,
      loginWithToken,
      completeProfile,
      logout,
      updateProfile,
      refreshUser: refreshMe,
      switchAppMode,
    }),
    [ready, user, apiUserState?.submittedDocs, apiUserState?.acceptanceRate, apiUserState?.cancellationRate, lastOtpDevCode, authError, requestOtp, verifyOtp, loginWithPassword, loginWithToken, completeProfile, logout, updateProfile, refreshMe, switchAppMode],
  );

  const vehicleValue = useMemo<VehicleState>(
    () => ({
      vehicle,
      submittedDocTypes: (apiUserState?.submittedDocs ?? []).map((d) => d.type),
      submittedDocs: apiUserState?.submittedDocs ?? [],
      applyDriver,
      updateVehicle,
      updateDocs,
      setDriverStatus: setDriverStatusFn,
    }),
    [vehicle, apiUserState, applyDriver, updateVehicle, updateDocs, setDriverStatusFn],
  );

  const rideValue = useMemo<RideState>(
    () => ({
      ride,
      pendingRide,
      requestRide,
      cancelRide,
      setPendingRide,
      clearPendingRide,
      acceptBid,
      startTrip,
      completeTrip,
      rateAndClose,
    }),
    [ride, pendingRide, requestRide, cancelRide, setPendingRide, clearPendingRide, acceptBid, startTrip, completeTrip, rateAndClose],
  );

  const driverValue = useMemo<DriverState>(
    () => ({
      earnings,
      earningsStale,
      driverOnline,
      driverIncoming,
      driverTrip,
      setDriverOnline,
      placeDriverBid,
      declineDriverRequest,
      driverArrived,
      driverEndTrip,
      driverCancelTrip,
    }),
    [earnings, earningsStale, driverOnline, driverIncoming, driverTrip, setDriverOnline, placeDriverBid, declineDriverRequest, driverArrived, driverEndTrip, driverCancelTrip],
  );

  const placesValue = useMemo<PlacesState>(
    () => ({
      savedPlaces,
      recentPlaces,
      refreshPlaces,
      addSavedPlace,
      deleteSavedPlace,
    }),
    [savedPlaces, recentPlaces, refreshPlaces, addSavedPlace, deleteSavedPlace],
  );

  return (
    <ReconnectContext.Provider value={reconnectStatus}>
      <AuthContext.Provider value={authValue}>
        <VehicleContext.Provider value={vehicleValue}>
          <RideContext.Provider value={rideValue}>
            <DriverContext.Provider value={driverValue}>
              <PlacesContext.Provider value={placesValue}>
                {children}
              </PlacesContext.Provider>
            </DriverContext.Provider>
          </RideContext.Provider>
        </VehicleContext.Provider>
      </AuthContext.Provider>
    </ReconnectContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Focused hooks — consumers subscribe only to the slice they need
// ---------------------------------------------------------------------------

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AppProvider");
  return ctx;
}

export function useVehicle(): VehicleState {
  const ctx = useContext(VehicleContext);
  if (!ctx) throw new Error("useVehicle must be used inside AppProvider");
  return ctx;
}

export function useRide(): RideState {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error("useRide must be used inside AppProvider");
  return ctx;
}

export function useDriver(): DriverState {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error("useDriver must be used inside AppProvider");
  return ctx;
}

export function usePlaces(): PlacesState {
  const ctx = useContext(PlacesContext);
  if (!ctx) throw new Error("usePlaces must be used inside AppProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Legacy combined hook — kept for any call-site that needs multiple slices
// at once. Note: it re-renders whenever ANY sub-context changes; prefer the
// focused hooks above for components that only care about one domain.
// ---------------------------------------------------------------------------

export function useReconnect(): ReconnectState {
  return useContext(ReconnectContext);
}

/** @deprecated Prefer the focused hooks: useAuth, useVehicle, useRide, useDriver, usePlaces */
export function useApp() {
  return {
    ...useAuth(),
    ...useVehicle(),
    ...useRide(),
    ...useDriver(),
    ...usePlaces(),
  };
}
