// Run with: pnpm --filter @workspace/api-server seed:heatmap
// Or with force-overwrite: pnpm --filter @workspace/api-server seed:heatmap -- --force
//
// This script inserts ~150 synthetic ride records to populate the admin heat map.
// Rides are clustered around several hotspot zones in a realistic city layout.
// Dates span the last 30 days; statuses are a mix of completed and cancelled.
// The script is idempotent: it skips insertion if seed data already exists unless --force is passed.

import { db, usersTable, ridesTable } from "@workspace/db";
import type { InsertRide } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const FORCE = process.argv.includes("--force");

// ── City centre: Dubai Marina / Downtown area ─────────────────────────────────
// Hotspot zones: clustered lat/lng centres with a spread radius
const HOTSPOTS = [
  { lat: 25.2048, lng: 55.2708, weight: 30 }, // Downtown Dubai / Burj Khalifa
  { lat: 25.1972, lng: 55.2744, weight: 20 }, // DIFC / Financial Centre
  { lat: 25.0760, lng: 55.1302, weight: 20 }, // Dubai Marina
  { lat: 25.2285, lng: 55.3273, weight: 15 }, // Deira / Old Dubai
  { lat: 25.1124, lng: 55.1390, weight: 10 }, // JBR Beach
  { lat: 25.2582, lng: 55.3093, weight: 5 },  // scatter / airport area
];

function encodePolyline(coords: [number, number][]): string {
  let result = "";
  let prevLat = 0;
  let prevLng = 0;

  function encodeValue(value: number): string {
    let v = Math.round(value * 1e5);
    v = v < 0 ? ~(v << 1) : v << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    chunk += String.fromCharCode(v + 63);
    return chunk;
  }

  for (const [lat, lng] of coords) {
    result += encodeValue(lat - prevLat);
    result += encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return result;
}

function gauss(mean: number, spread: number): number {
  // Box-Muller transform for normally-distributed random offset
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * spread;
}

function pickHotspot() {
  const totalWeight = HOTSPOTS.reduce((s, h) => s + h.weight, 0);
  let r = Math.random() * totalWeight;
  for (const h of HOTSPOTS) {
    r -= h.weight;
    if (r <= 0) return h;
  }
  return HOTSPOTS[0];
}

function randomCoordNear(centre: { lat: number; lng: number }, spreadDeg = 0.02): [number, number] {
  return [
    gauss(centre.lat, spreadDeg),
    gauss(centre.lng, spreadDeg),
  ];
}

function buildPolyline(pickup: [number, number], dropoff: [number, number]): string {
  // Interpolate 6 intermediate points with slight jitter for a realistic route shape
  const points: [number, number][] = [pickup];
  const steps = 5;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const midLat = pickup[0] + (dropoff[0] - pickup[0]) * t + gauss(0, 0.003);
    const midLng = pickup[1] + (dropoff[1] - pickup[1]) * t + gauss(0, 0.003);
    points.push([midLat, midLng]);
  }
  points.push(dropoff);
  return encodePolyline(points);
}

function randomDateWithinHours(maxHoursAgo: number): Date {
  return new Date(Date.now() - Math.random() * maxHoursAgo * 60 * 60 * 1000);
}

function randomDateBetweenDays(fromDaysAgo: number, toDaysAgo: number): Date {
  const msPerDay = 24 * 60 * 60 * 1000;
  const rangeMs = (toDaysAgo - fromDaysAgo) * msPerDay;
  return new Date(Date.now() - fromDaysAgo * msPerDay - Math.random() * rangeMs);
}

const VEHICLE_CLASSES = ["ride", "comfort", "moto"] as const;
const STATUSES = ["completed", "completed", "completed", "cancelled"] as const; // 75% completed

const PICKUP_LABELS = [
  "Dubai Mall", "Burj Khalifa", "Dubai Marina Walk", "DIFC Gate", "Dubai Airport T3",
  "JBR Beach", "Mall of the Emirates", "Palm Jumeirah", "Deira City Centre", "Ibn Battuta Mall",
  "Dubai Frame", "Jumeirah Beach Hotel", "Business Bay Bridge", "Gold Souk", "Spice Souk",
];

const DROPOFF_LABELS = [
  "Dubai Creek Harbour", "The Dubai Frame", "Ain Dubai", "Dubai Hills Mall", "Global Village",
  "Jumeirah Village Circle", "Motor City", "Downtown Jebel Ali", "Dubai Sports City", "Expo City",
  "Al Barsha", "Mirdif City Centre", "Dubai Silicon Oasis", "Academic City", "Dubai Healthcare City",
];

async function main() {
  console.log("[seed:heatmap] Starting...");

  // ── Idempotency check ──────────────────────────────────────────────────────
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(ridesTable)
    .where(eq(ridesTable.pickupAddress, "__heatmap_seed__"));

  if (Number(count) > 0 && !FORCE) {
    console.log(
      `[seed:heatmap] ${count} seed rides already present. Skipping. Use --force to overwrite.`
    );
    process.exit(0);
  }

  if (FORCE && Number(count) > 0) {
    console.log(`[seed:heatmap] --force: deleting existing ${count} seed rides...`);
    await db.delete(ridesTable).where(eq(ridesTable.pickupAddress, "__heatmap_seed__"));
    console.log("[seed:heatmap] Existing seed rides removed.");
  }

  // ── Fetch rider IDs from existing users ───────────────────────────────────
  const riders = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .limit(50);

  if (riders.length === 0) {
    console.error(
      "[seed:heatmap] No rider users found in the database. Please ensure at least one rider exists."
    );
    process.exit(1);
  }

  console.log(`[seed:heatmap] Found ${riders.length} riders to assign rides to.`);

  // ── Generate rides ─────────────────────────────────────────────────────────
  // Date buckets guarantee every time-range filter returns results:
  //   - Rides  0-9  : within the last 24 h  → "Today" always populated
  //   - Rides 10-24 : days 1–7              → "7 Days" always populated
  //   - Rides 25-149: days 7–30             → full 30-day history
  const TOTAL = 150;
  const rides: InsertRide[] = [];

  function dateForIndex(i: number): Date {
    if (i < 10)  return randomDateWithinHours(24);
    if (i < 25)  return randomDateBetweenDays(1, 7);
    return randomDateBetweenDays(7, 30);
  }

  for (let i = 0; i < TOTAL; i++) {
    const pickupHotspot = pickHotspot();
    const dropoffHotspot = pickHotspot();
    const pickup = randomCoordNear(pickupHotspot);
    const dropoff = randomCoordNear(dropoffHotspot, 0.03);

    const distanceKm = Math.round(
      Math.sqrt(
        Math.pow((pickup[0] - dropoff[0]) * 111, 2) +
        Math.pow((pickup[1] - dropoff[1]) * 111 * Math.cos((pickup[0] * Math.PI) / 180), 2)
      ) * 10
    ) / 10;

    const durationMin = Math.max(5, Math.round(distanceKm * 2.5 + Math.random() * 5));
    const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
    const finalAmount = status === "completed" ? Math.round((distanceKm * 4 + 5) * 10) / 10 : null;
    const vehicleClass = VEHICLE_CLASSES[Math.floor(Math.random() * VEHICLE_CLASSES.length)];
    const riderId = riders[Math.floor(Math.random() * riders.length)].id;
    const createdAt = dateForIndex(i);
    const pickupLabelIdx = Math.floor(Math.random() * PICKUP_LABELS.length);
    const dropoffLabelIdx = Math.floor(Math.random() * DROPOFF_LABELS.length);

    rides.push({
      riderId,
      pickupLabel: PICKUP_LABELS[pickupLabelIdx],
      pickupAddress: "__heatmap_seed__",
      dropoffLabel: DROPOFF_LABELS[dropoffLabelIdx],
      dropoffAddress: "__heatmap_seed__",
      estimatedDistanceKm: distanceKm || 1,
      estimatedDurationMin: durationMin,
      pickupLat: pickup[0],
      pickupLng: pickup[1],
      dropoffLat: dropoff[0],
      dropoffLng: dropoff[1],
      routePolyline: buildPolyline(pickup, dropoff),
      status,
      finalAmount,
      vehicleClass,
      initialFare: finalAmount ? Math.round(finalAmount * 0.9 * 10) / 10 : null,
      ratingScore: status === "completed" && Math.random() > 0.4
        ? Math.floor(Math.random() * 2) + 4 // 4 or 5 star
        : null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  // Insert in batches of 50
  const BATCH = 50;
  for (let b = 0; b < rides.length; b += BATCH) {
    const batch = rides.slice(b, b + BATCH);
    await db.insert(ridesTable).values(batch);
    console.log(`[seed:heatmap] Inserted batch ${Math.floor(b / BATCH) + 1} (${batch.length} rides)`);
  }

  console.log(`[seed:heatmap] Done. ${TOTAL} rides seeded successfully.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:heatmap] Fatal error:", err);
  process.exit(1);
});
