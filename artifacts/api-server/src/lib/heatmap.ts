import { db, ridesTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getConfig } from "./settings";
import { getOnlineDriverPositions, emitToHeatmapRoom } from "./io";

export interface DemandZone {
  lat: number;
  lng: number;
  intensity: number;
  surgeMultiplier: number;
  bonus?: number;
  labelMode: "multiplier" | "bonus" | "off";
}

export interface DemandZoneSnapshot {
  zones: DemandZone[];
  generatedAt: string;
}

const MAX_ZONES = 200;

let snapshot: DemandZoneSnapshot = { zones: [], generatedAt: new Date(0).toISOString() };
let lastByKey = new Map<string, DemandZone>();
let timer: ReturnType<typeof setTimeout> | null = null;
let currentIntervalMs = 15_000;

/** Build the cell key from a quantised lat/lng pair (4 decimals = ~11m). */
function cellKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Quantise a coord to the centre of its grid cell. */
function quantise(value: number, gridDeg: number): number {
  return Math.round(value / gridDeg) * gridDeg;
}

/** Returns the tier index 0..4 for a given surge multiplier given the configured cuts. */
function tierFor(surge: number, cuts: { light: number; medium: number; high: number; veryHigh: number }): number {
  if (surge >= cuts.veryHigh) return 4;
  if (surge >= cuts.high) return 3;
  if (surge >= cuts.medium) return 2;
  if (surge >= cuts.light) return 1;
  return 0;
}

/**
 * Recompute the snapshot once and broadcast a diff against the previous
 * snapshot to the `drivers:heatmap` Socket.IO room.
 */
export async function rebuildSnapshot(): Promise<DemandZoneSnapshot> {
  const cfg = await getConfig();
  if (!cfg.heatmapEnabled) {
    snapshot = { zones: [], generatedAt: new Date().toISOString() };
    if (lastByKey.size > 0) {
      const removed = Array.from(lastByKey.keys());
      lastByKey = new Map();
      emitToHeatmapRoom("heatmap:diff", {
        added: [],
        updated: [],
        removed,
        generatedAt: snapshot.generatedAt,
      });
    }
    return snapshot;
  }

  const gridMeters = cfg.heatmapGridMeters;
  const gridDeg = gridMeters / 111_000;
  const lookbackMs = cfg.heatmapDemandLookbackSeconds * 1000;
  const supplyStaleMs = cfg.heatmapSupplyStaleSeconds * 1000;
  const since = new Date(Date.now() - lookbackMs);

  // ── Demand: open ride requests within the lookback window ────────────────
  const demandRows = await db
    .select({
      lat: ridesTable.pickupLat,
      lng: ridesTable.pickupLng,
    })
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.status, "bidding"),
        gte(ridesTable.createdAt, since),
        sql`${ridesTable.pickupLat} IS NOT NULL`,
        sql`${ridesTable.pickupLng} IS NOT NULL`,
      ),
    )
    .limit(5000);

  // ── Supply: online drivers with a fresh GPS ping ─────────────────────────
  const drivers = getOnlineDriverPositions(supplyStaleMs);

  type Cell = { lat: number; lng: number; demand: number; supply: number };
  const cells = new Map<string, Cell>();

  for (const r of demandRows) {
    if (typeof r.lat !== "number" || typeof r.lng !== "number") continue;
    const lat = quantise(r.lat, gridDeg);
    const lng = quantise(r.lng, gridDeg);
    const k = cellKey(lat, lng);
    const c = cells.get(k);
    if (c) c.demand++;
    else cells.set(k, { lat, lng, demand: 1, supply: 0 });
  }

  for (const d of drivers) {
    const lat = quantise(d.lat, gridDeg);
    const lng = quantise(d.lng, gridDeg);
    const k = cellKey(lat, lng);
    const c = cells.get(k);
    if (c) c.supply++;
    else cells.set(k, { lat, lng, demand: 0, supply: 1 });
  }

  const cuts = {
    light: cfg.heatmapSurgeThresholdLight,
    medium: cfg.heatmapSurgeThresholdMedium,
    high: cfg.heatmapSurgeThresholdHigh,
    veryHigh: cfg.heatmapSurgeThresholdVeryHigh,
  };

  // Score, drop zones below the lowest tier (no surge), cap to MAX_ZONES.
  const scored: DemandZone[] = [];
  for (const c of cells.values()) {
    if (c.demand <= 0) continue;
    const surgeMultiplier = c.demand / (c.supply + 1);
    const tier = tierFor(surgeMultiplier, cuts);
    if (tier === 0) continue;
    const intensity = tier / 4;
    const zone: DemandZone = {
      lat: Number(c.lat.toFixed(5)),
      lng: Number(c.lng.toFixed(5)),
      intensity,
      surgeMultiplier: Number(surgeMultiplier.toFixed(2)),
      labelMode: cfg.heatmapLabelMode,
    };
    if (cfg.heatmapLabelMode === "bonus") {
      zone.bonus = Number((cfg.heatmapBonusBase * tier).toFixed(2));
    }
    scored.push(zone);
  }
  scored.sort((a, b) => b.surgeMultiplier - a.surgeMultiplier);
  const zones = scored.slice(0, MAX_ZONES);

  // ── Diff against previous snapshot ───────────────────────────────────────
  const next = new Map<string, DemandZone>();
  const added: DemandZone[] = [];
  const updated: DemandZone[] = [];
  const removed: string[] = [];

  for (const z of zones) {
    const k = cellKey(z.lat, z.lng);
    next.set(k, z);
    const prev = lastByKey.get(k);
    if (!prev) {
      added.push(z);
    } else if (
      prev.intensity !== z.intensity ||
      prev.surgeMultiplier !== z.surgeMultiplier ||
      prev.bonus !== z.bonus ||
      prev.labelMode !== z.labelMode
    ) {
      updated.push(z);
    }
  }
  for (const k of lastByKey.keys()) {
    if (!next.has(k)) removed.push(k);
  }

  const generatedAt = new Date().toISOString();
  snapshot = { zones, generatedAt };
  lastByKey = next;

  if (added.length || updated.length || removed.length) {
    emitToHeatmapRoom("heatmap:diff", { added, updated, removed, generatedAt });
  }

  return snapshot;
}

export function getSnapshot(): DemandZoneSnapshot {
  return snapshot;
}

/**
 * Start (or restart) the periodic recompute loop. Reschedules itself every
 * tick so an admin settings change picks up the new interval at most one
 * tick later.
 */
export function startHeatmapAggregator(): void {
  if (timer) return;
  const tick = async () => {
    try {
      await rebuildSnapshot();
    } catch (err) {
      logger.error({ err }, "[heatmap] failed to rebuild snapshot");
    }
    try {
      const cfg = await getConfig();
      currentIntervalMs = Math.max(5, cfg.heatmapRefreshSeconds) * 1000;
    } catch {
      // keep the previous interval on a transient settings read failure
    }
    timer = setTimeout(tick, currentIntervalMs);
    timer.unref?.();
  };
  // First run is immediate so the snapshot is non-empty before any client polls.
  void tick();
}
