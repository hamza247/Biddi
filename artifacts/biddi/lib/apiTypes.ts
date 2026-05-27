import type {
  AppMode,
  DriverBid,
  DriverIncomingRequest,
  DriverStatus,
  DriverTrip,
  EarningsEntry,
  FareBreakdown,
  Place,
  RideRequest,
  TripStop,
  Vehicle,
} from "./types";

export interface ApiUser {
  id: string;
  phone: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  hasPassword?: boolean;
  referralCode?: string | null;
  referredByCode?: string | null;
  appMode: AppMode;
  driverStatus: DriverStatus;
  driverOnline: boolean;
  rating: number;
  driverRatingCount?: number | null;
  trips: number;
  customerRating?: number | null;
  customerRatingCount?: number | null;
  photoUrl?: string | null;
  /** Server-computed driver acceptance rate (0–100). `null` when fewer
   *  than 5 ride requests have been dispatched to this driver. */
  acceptanceRate?: number | null;
  /** Server-computed driver cancellation rate (0–100). `null` when fewer
   *  than 5 rides have been accepted by this driver. */
  cancellationRate?: number | null;
  submittedDocs: Array<{ type: string; url: string; status?: "pending" | "approved" | "rejected"; rejectionReason?: string }>;
}

export interface ApiDisplayAmount {
  amountUsd: number;
  displayAmount: number;
  displayCurrency: string;
  displaySymbol: string;
}

export interface ApiBid {
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
  status: string;
  /** Server-converted display envelope. Render `displaySymbol` + `displayAmount`
   * directly — do not multiply or convert client-side. */
  amountDisplay?: ApiDisplayAmount;
}

export interface ApiRide {
  id: string;
  riderId: string;
  pickupLabel: string;
  pickupAddress: string;
  dropoffLabel: string;
  dropoffAddress: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  routePolyline?: string | null;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  status: "bidding" | "driver_arriving" | "in_progress" | "completed" | "cancelled";
  acceptedBidId: string | null;
  acceptedDriverId: string | null;
  finalAmount: number | null;
  ratingScore: number | null;
  initialFare?: number | null;
  vehicleClass?: "ride" | "comfort" | "moto" | null;
  vehicleTypeId?: string | null;
  vehicleTypeName?: string | null;
  isShared?: boolean | null;
  seatsRequested?: number | null;
  wheelchairRequested?: boolean | null;
  petRequested?: boolean | null;
  assistRequested?: boolean | null;
  sharedGroupId?: string | null;
  sharedRidersCount?: number | null;
  fareBreakdown?: FareBreakdown | null;
  /** Parallel breakdown with line items already converted into the platform
   * display currency. Carries `currency` + `displaySymbol` for rendering. */
  fareBreakdownDisplay?: (FareBreakdown & { displaySymbol: string }) | null;
  /** Final paid amount as a server-converted display envelope. */
  finalAmountDisplay?: ApiDisplayAmount | null;
  cancellationFee?: number | null;
  createdAt: string;
  bids: ApiBid[];
}

export function rideToView(ride: ApiRide): RideRequest {
  return {
    id: ride.id,
    pickup: {
      label: ride.pickupLabel,
      address: ride.pickupAddress,
      lat: ride.pickupLat ?? undefined,
      lng: ride.pickupLng ?? undefined,
    },
    dropoff: {
      label: ride.dropoffLabel,
      address: ride.dropoffAddress,
      lat: ride.dropoffLat ?? undefined,
      lng: ride.dropoffLng ?? undefined,
    },
    estimatedDistanceKm: ride.estimatedDistanceKm,
    estimatedDurationMin: ride.estimatedDurationMin,
    routePolyline: ride.routePolyline ?? undefined,
    status: ride.status,
    bids: ride.bids.map(toViewBid),
    acceptedBidId: ride.acceptedBidId ?? undefined,
    createdAt: new Date(ride.createdAt).getTime(),
    finalAmount: ride.finalAmount ?? undefined,
    initialFare: ride.initialFare ?? undefined,
    vehicleClass: ride.vehicleClass ?? undefined,
    vehicleTypeId: ride.vehicleTypeId ?? null,
    vehicleTypeName: ride.vehicleTypeName ?? null,
    isShared: !!ride.isShared,
    seatsRequested: ride.seatsRequested ?? 1,
    wheelchairRequested: !!ride.wheelchairRequested,
    petRequested: !!ride.petRequested,
    assistRequested: !!ride.assistRequested,
    sharedGroupId: ride.sharedGroupId ?? null,
    sharedRidersCount: ride.sharedRidersCount ?? 1,
    fareBreakdown: ride.fareBreakdown ?? undefined,
    fareBreakdownDisplay: ride.fareBreakdownDisplay ?? undefined,
    finalAmountDisplay: ride.finalAmountDisplay ?? undefined,
    cancellationFee: ride.cancellationFee ?? undefined,
  };
}

export function toViewBid(b: ApiBid): DriverBid {
  return {
    id: b.id,
    driverName: b.driverName,
    driverInitial: b.driverInitial,
    driverPhotoUrl: b.driverPhotoUrl ?? null,
    rating: b.rating,
    trips: b.trips,
    vehicle: b.vehicle,
    plate: b.plate,
    etaMin: b.etaMin,
    amount: b.amount,
    currency: b.currency,
    amountDisplay: b.amountDisplay,
  };
}

export type Place_ = Place;
export type Vehicle_ = Vehicle;
export type DriverIncomingRequest_ = DriverIncomingRequest;
export type DriverTrip_ = DriverTrip;
export type EarningsEntry_ = EarningsEntry;
