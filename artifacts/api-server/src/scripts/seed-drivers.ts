// Run with: pnpm --filter @workspace/api-server seed:drivers
// Or with force-overwrite: pnpm --filter @workspace/api-server seed:drivers -- --force
//
// Inserts ~20 synthetic approved drivers (with vehicles + recent
// last-known GPS fixes) so the admin Live Map has visible markers on a
// fresh install. Drivers are clustered around the same Dubai hotspots
// used by seed-heatmap.ts so the heat view and live map line up.
//
// Idempotent: skips if seed drivers already exist (detected via
// `seed-driver-` phone/email prefix). Pass --force to wipe and re-insert.

import { db, usersTable, vehiclesTable } from "@workspace/db";
import type { InsertUser, InsertVehicle } from "@workspace/db";
import { inArray, like, or, sql } from "drizzle-orm";

const FORCE = process.argv.includes("--force");

const SEED_PHONE_PREFIX = "+9715550";
const SEED_EMAIL_PREFIX = "seed-driver-";
const SEED_EMAIL_DOMAIN = "@biddi.dev";

// Same hotspots as seed-heatmap.ts so heat + live map align visually.
const HOTSPOTS = [
  { lat: 25.2048, lng: 55.2708, weight: 30 }, // Downtown Dubai / Burj Khalifa
  { lat: 25.1972, lng: 55.2744, weight: 20 }, // DIFC
  { lat: 25.0760, lng: 55.1302, weight: 20 }, // Dubai Marina
  { lat: 25.2285, lng: 55.3273, weight: 15 }, // Deira
  { lat: 25.1124, lng: 55.1390, weight: 10 }, // JBR
  { lat: 25.2582, lng: 55.3093, weight: 5 },  // Airport area
];

const FIRST_NAMES = [
  "Ahmed", "Omar", "Yusuf", "Khalid", "Saeed", "Ali", "Hassan", "Hussein",
  "Tariq", "Faisal", "Rashid", "Nasser", "Ibrahim", "Mahmoud", "Karim",
  "Bilal", "Zaid", "Anwar", "Samir", "Jamal", "Imran", "Fadi", "Hamza",
];

const LAST_NAMES = [
  "Al-Farsi", "Hassan", "Khan", "Abdullah", "Mansour", "Saleh", "Rahman",
  "Haddad", "Nasr", "Sultan", "Habib", "Awad", "Darwish", "Younis",
  "Bakr", "Othman", "Qasim", "Sabri", "Tawfik", "Wahab",
];

const VEHICLE_MAKES = ["Toyota", "Hyundai", "Nissan", "Honda", "Kia", "Mitsubishi", "Mazda"];
const VEHICLE_MODELS: Record<string, string[]> = {
  Toyota: ["Camry", "Corolla", "Yaris", "Avalon"],
  Hyundai: ["Elantra", "Sonata", "Accent", "Tucson"],
  Nissan: ["Altima", "Sentra", "Sunny", "Maxima"],
  Honda: ["Civic", "Accord", "City"],
  Kia: ["Cerato", "Optima", "Pegas"],
  Mitsubishi: ["Lancer", "Attrage"],
  Mazda: ["3", "6", "CX-5"],
};
const VEHICLE_COLORS = ["White", "Silver", "Black", "Grey", "Blue", "Red"];

function gauss(mean: number, spread: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * spread;
}

function pickHotspot() {
  const total = HOTSPOTS.reduce((s, h) => s + h.weight, 0);
  let r = Math.random() * total;
  for (const h of HOTSPOTS) {
    r -= h.weight;
    if (r <= 0) return h;
  }
  return HOTSPOTS[0];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPlate(i: number): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const a = letters[Math.floor(Math.random() * letters.length)];
  const num = String(1000 + i).padStart(4, "0");
  return `DXB-${a}${num}`;
}

async function main() {
  console.log("[seed:drivers] Starting...");

  const seedMatch = or(
    like(usersTable.email, `${SEED_EMAIL_PREFIX}%${SEED_EMAIL_DOMAIN}`),
    like(usersTable.phone, `${SEED_PHONE_PREFIX}%`),
  );

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(seedMatch);

  if (existing.length > 0 && !FORCE) {
    console.log(
      `[seed:drivers] ${existing.length} seed drivers already present. Skipping. Use --force to overwrite.`,
    );
    process.exit(0);
  }

  if (FORCE && existing.length > 0) {
    console.log(`[seed:drivers] --force: removing ${existing.length} existing seed drivers...`);
    const ids = existing.map((u) => u.id);
    // vehicles cascade-delete with the user, but be explicit for clarity.
    await db.delete(vehiclesTable).where(inArray(vehiclesTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    console.log("[seed:drivers] Existing seed drivers removed.");
  }

  const TOTAL = 20;
  const now = new Date();

  const userRows: InsertUser[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const hotspot = pickHotspot();
    const lat = gauss(hotspot.lat, 0.012);
    const lng = gauss(hotspot.lng, 0.012);
    // Last seen between 1 and 25 minutes ago — comfortably within the
    // default 6-hour offline window so they show up on /admin/live-map.
    const lastSeen = new Date(now.getTime() - Math.floor(Math.random() * 25 + 1) * 60 * 1000);
    const idx = String(i + 1).padStart(2, "0");
    userRows.push({
      phone: `${SEED_PHONE_PREFIX}${idx}${Math.floor(Math.random() * 90 + 10)}`,
      countryCode: "+971",
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_NAMES),
      email: `${SEED_EMAIL_PREFIX}${idx}${SEED_EMAIL_DOMAIN}`,
      phoneVerified: true,
      appMode: "driver",
      driverStatus: "approved",
      driverOnline: false,
      lastKnownLat: lat,
      lastKnownLng: lng,
      lastKnownHeading: Math.floor(Math.random() * 360),
      lastKnownAt: lastSeen,
    });
  }

  const inserted = await db.insert(usersTable).values(userRows).returning({ id: usersTable.id });
  console.log(`[seed:drivers] Inserted ${inserted.length} drivers.`);

  const vehicleRows: InsertVehicle[] = inserted.map((u, i) => {
    const make = pick(VEHICLE_MAKES);
    const model = pick(VEHICLE_MODELS[make]);
    return {
      userId: u.id,
      make,
      model,
      year: String(2018 + Math.floor(Math.random() * 7)),
      color: pick(VEHICLE_COLORS),
      plate: randomPlate(i),
    };
  });

  await db.insert(vehiclesTable).values(vehicleRows);
  console.log(`[seed:drivers] Inserted ${vehicleRows.length} vehicles.`);

  // Sanity check: confirm count by prefix.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable)
    .where(seedMatch);
  console.log(`[seed:drivers] Done. Total seed drivers in DB: ${count}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:drivers] Fatal error:", err);
  process.exit(1);
});
