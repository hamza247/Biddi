export type AppMode = "rider" | "driver";
export type DriverStatus =
  | "not_applied"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";

export type RideStatus =
  | "idle"
  | "bidding"
  | "driver_arriving"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "queued"
  | "assigned_next";

export interface User {
  id: string;
  phone: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  hasPassword?: boolean;
  referralCode?: string | null;
  appMode: AppMode;
  driverStatus: DriverStatus;
  walletBalance?: string;
  photoUrl?: string | null;
  driverRating?: number | null;
  driverRatingCount?: number | null;
  customerRating?: number | null;
  customerRatingCount?: number | null;
}

export interface Vehicle {
  make: string;
  model: string;
  year: string;
  color: string;
  plate: string;
}

export interface Place {
  id?: string;
  label: string;
  address: string;
  lat?: number;
  lng?: number;
  googlePlaceId?: string;
}

export interface SavedPlace extends Place {
  id: string;
  lat: number;
  lng: number;
}

export interface DriverBid {
  id: string;
  driverName: string;
  driverInitial: string;
  driverPhotoUrl?: string | null;
  rating: number;
  trips: number;
  vehicle: string;
  plate: string;
  etaMin: number;
  amount: number;
  currency: string;
  /** Server-converted display envelope (symbol + already-converted amount).
   * When present, prefer rendering `displaySymbol` + `displayAmount`
   * directly; do not perform client-side currency math. */
  amountDisplay?: {
    amountUsd: number;
    displayAmount: number;
    displayCurrency: string;
    displaySymbol: string;
  };
}

/** Free-form category key. Historically constrained to "ride" | "comfort" |
 *  "moto", but the backend now accepts arbitrary operator-defined keys
 *  (pool, wheelchair, pet, assist, …). Kept as `string` so adding a new
 *  category in the admin doesn't require a mobile release. The canonical
 *  identifier is `vehicleTypeId`; this string is for compatibility only. */
export type VehicleClass = string;

/** Capability flags the rider asked for at request time. Each flag is only
 *  honoured when the chosen vehicle category supports it (see backend). */
export interface RideCapabilities {
  isShared?: boolean;
  seatsRequested?: number;
  wheelchairRequested?: boolean;
  petRequested?: boolean;
  assistRequested?: boolean;
}

export interface FareBreakdown {
  currency: string;
  base: number;
  distance: number;
  distanceKm: number;
  pricePerKm: number;
  time: number;
  durationMin: number;
  pricePerMin: number;
  peakMultiplier: number;
  peakSurcharge: number;
  weatherSurcharge?: number;
  weatherMultiplier?: number;
  weatherReason?: string;
  weatherRuleName?: string;
  airportPickupSurcharge?: number;
  airportDropoffSurcharge?: number;
  airportPickupName?: string;
  airportDropoffName?: string;
  nightMultiplier: number;
  nightSurcharge: number;
  subtotal: number;
  minimumFare: number;
  minimumApplied: boolean;
  waitingMin: number;
  waitingFee: number;
  fareModel: "incremental" | "fixed";
  pool: boolean;
  total: number;
  /** Bid amount the rider and driver agreed on. Recorded for audit;
   * the metered `total` is what the rider actually pays. */
  agreedBid?: number;
  /** Coupon discount applied at completion, in fare currency.
   * Subtracted from the metered subtotal before the minimum-fare floor. */
  couponDiscount?: number;
  /** Coupon code applied at completion. Snapshotted onto the breakdown so
   * the receipt remains stable even if the underlying code is later edited. */
  couponCode?: string;
}

export interface RideRequest {
  id: string;
  pickup: Place;
  dropoff: Place;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  routePolyline?: string;
  status: RideStatus;
  bids: DriverBid[];
  acceptedBidId?: string;
  createdAt: number;
  finalAmount?: number;
  initialFare?: number;
  vehicleClass?: VehicleClass;
  vehicleTypeId?: string | null;
  vehicleTypeName?: string | null;
  isShared?: boolean;
  // Server-computed wait estimate when this ride is in `queued` /
  // `assigned_next` status (the matched driver is finishing another trip
  // first). Equals the previous trip's remaining estimated duration.
  queuedEtaMin?: number;
  seatsRequested?: number;
  wheelchairRequested?: boolean;
  petRequested?: boolean;
  assistRequested?: boolean;
  sharedGroupId?: string | null;
  /** Total number of riders sharing this trip (including self). 1 if not matched yet. */
  sharedRidersCount?: number;
  fareBreakdown?: FareBreakdown;
  /** Parallel fare breakdown with values already converted into the
   * platform's display currency. Render line items from this object;
   * `displaySymbol` carries the symbol to pair with each value. */
  fareBreakdownDisplay?: FareBreakdown & { displaySymbol: string };
  /** Final paid amount as a server-converted display envelope. */
  finalAmountDisplay?: {
    amountUsd: number;
    displayAmount: number;
    displayCurrency: string;
    displaySymbol: string;
  };
  cancellationFee?: number;
}

/** A single stop in a multi-rider shared trip. */
export interface TripStop {
  type: "pickup" | "dropoff";
  rideId: string;
  riderName: string;
  label: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
}

export interface DriverIncomingRequest {
  id: string;
  riderName: string;
  riderRating: number;
  /** Rider's customer rating (averaged from driver-submitted ratings).
   * `null`/omitted when the rider has no rating yet. */
  riderCustomerRating?: number | null;
  riderCustomerRatingCount?: number | null;
  pickup: Place;
  dropoff: Place;
  distanceKm: number;
  durationMin: number;
  suggestedFare: number;
  /** Rider's offered fare (inDrive-style). When present, drivers see this
   * as the rider's offer instead of the algorithmic suggestion. */
  initialFare?: number | null;
  vehicleClass?: VehicleClass | null;
  vehicleTypeId?: string | null;
  vehicleTypeName?: string | null;
  isShared?: boolean | null;
  seatsRequested?: number | null;
  sharedGroupId?: string | null;
  /** Ordered multi-stop list for shared group rides. Null for solo rides. */
  stops?: TripStop[] | null;
  wheelchairRequested?: boolean | null;
  petRequested?: boolean | null;
  assistRequested?: boolean | null;
  routePolyline?: string;
  /** Fare model for this ride. When "fixed" the driver must bid the exact suggested fare. */
  fareModel?: "incremental" | "fixed" | null;
  receivedAt: number;
}

export interface DriverTrip {
  id: string;
  riderName: string;
  riderPhotoUrl?: string | null;
  riderPhone?: string | null;
  /** Rider's customer rating (averaged from driver-submitted ratings).
   * `null`/omitted when the rider has no rating yet. */
  riderCustomerRating?: number | null;
  riderCustomerRatingCount?: number | null;
  pickup: Place;
  dropoff: Place;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  amount: number;
  status: "driver_arriving" | "in_progress" | "completed";
  routePolyline?: string;
  distanceKm?: number;
  durationMin?: number;
  isShared?: boolean | null;
  sharedGroupId?: string | null;
  /** Ordered stop list for shared trips: pickups then dropoffs. Null for solo rides. */
  stops?: TripStop[] | null;
  /** Per-minute fee charged for in-transit waiting (from the vehicle type config). */
  waitingFeePerMin?: number | null;
}

export interface EarningsEntry {
  id: string;
  rideId: string;
  date: number;
  amount: number;
  riderName: string;
  pickup: string;
  dropoff: string;
}
