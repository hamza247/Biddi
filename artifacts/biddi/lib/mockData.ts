import type { DriverBid, DriverIncomingRequest } from "./types";

const DRIVER_POOL = [
  { name: "Marcus Lee", vehicle: "Toyota Camry · Silver", plate: "8KDR-921", rating: 4.97, trips: 1248 },
  { name: "Aisha Khan", vehicle: "Honda Accord · White", plate: "PLT-3382", rating: 4.92, trips: 882 },
  { name: "Diego Romero", vehicle: "Hyundai Sonata · Black", plate: "GFR-7741", rating: 4.88, trips: 2104 },
  { name: "Priya Patel", vehicle: "Tesla Model 3 · Blue", plate: "EV-5567", rating: 5.0, trips: 412 },
  { name: "Jordan Smith", vehicle: "Kia K5 · Grey", plate: "JS-9921", rating: 4.81, trips: 644 },
  { name: "Linh Tran", vehicle: "Nissan Altima · Red", plate: "LT-2210", rating: 4.95, trips: 1733 },
];

export function generateBid(distanceKm: number, index: number): DriverBid {
  const driver = DRIVER_POOL[index % DRIVER_POOL.length]!;
  const base = Math.max(6, distanceKm * 1.6);
  const jitter = (Math.random() - 0.4) * 4;
  const amount = Math.round((base + jitter) * 100) / 100;
  const eta = Math.max(2, Math.round(2 + Math.random() * 8));
  return {
    id: `bid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    driverName: driver.name,
    driverInitial: driver.name.charAt(0),
    rating: driver.rating,
    trips: driver.trips,
    vehicle: driver.vehicle,
    plate: driver.plate,
    etaMin: eta,
    amount,
    currency: "USD",
  };
}

const RIDER_POOL = [
  "Emma Wilson",
  "Carlos Mendez",
  "Sophia Chen",
  "Noah Williams",
  "Maya Patel",
  "Liam O'Brien",
];

export function generateIncomingRequest(index: number): DriverIncomingRequest {
  const distance = Math.round((1.5 + Math.random() * 8) * 10) / 10;
  const duration = Math.max(5, Math.round(distance * 3.2));
  const suggested = Math.round(Math.max(7, distance * 1.8) * 100) / 100;
  const pickups = [
    "Union Square Subway Stop",
    "Brooklyn Heights Promenade",
    "Williamsburg Bridge Plaza",
    "Lincoln Center Plaza",
    "Greenpoint Av & Manhattan Av",
    "Prospect Park West & 9th St",
  ];
  const dropoffs = [
    "JFK Terminal 5",
    "Whole Foods Tribeca",
    "Madison Square Garden",
    "DUMBO · Front St",
    "LGA Terminal B",
    "Times Square · 7th Ave",
  ];
  return {
    id: `req_${Date.now()}_${index}`,
    riderName: RIDER_POOL[index % RIDER_POOL.length]!,
    riderRating: Math.round((4.6 + Math.random() * 0.4) * 100) / 100,
    pickup: { label: "Pickup", address: pickups[index % pickups.length]! },
    dropoff: { label: "Dropoff", address: dropoffs[index % dropoffs.length]! },
    distanceKm: distance,
    durationMin: duration,
    suggestedFare: suggested,
    receivedAt: Date.now(),
  };
}
