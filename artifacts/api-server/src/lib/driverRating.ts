import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const DEFAULT_DRIVER_RATING = 5.0;
export const RECENT_RIDES_FULL_WINDOW = 100;
export const RECENT_RIDES_NEW_WINDOW = 10;

interface ComputedRow {
  driver_id: string;
  avg_rating: number;
  [key: string]: unknown;
}

interface ComputedRowWithCount extends ComputedRow {
  rating_count: number;
}

async function computeFromRides(driverIds: string[]): Promise<Map<string, { avg: number; count: number }>> {
  const out = new Map<string, { avg: number; count: number }>();
  if (driverIds.length === 0) return out;
  // RECENT_RIDES_FULL_WINDOW / RECENT_RIDES_NEW_WINDOW are module-level
  // integer constants (not user input), so we inline them via sql.raw to
  // avoid Postgres inferring them as text and producing a
  // "operator does not exist: bigint <= text" error against the bigint
  // produced by COUNT(*) OVER (...).
  const fullWindow = sql.raw(String(RECENT_RIDES_FULL_WINDOW));
  const newWindow = sql.raw(String(RECENT_RIDES_NEW_WINDOW));
  const result = await db.execute<ComputedRowWithCount>(sql`
    WITH ranked AS (
      SELECT
        accepted_driver_id AS driver_id,
        rating_score,
        ROW_NUMBER() OVER (
          PARTITION BY accepted_driver_id
          ORDER BY updated_at DESC, id DESC
        ) AS rn,
        COUNT(*) OVER (PARTITION BY accepted_driver_id) AS total
      FROM rides
      WHERE status = 'completed'
        AND rating_score IS NOT NULL
        AND accepted_driver_id IN (${sql.join(
          driverIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    )
    SELECT
      driver_id,
      AVG(rating_score)::float AS avg_rating,
      COUNT(*)::int AS rating_count
    FROM ranked
    WHERE rn <= CASE WHEN total >= ${fullWindow} THEN ${fullWindow} ELSE ${newWindow} END
    GROUP BY driver_id
  `);
  const rows = (result as unknown as { rows: ComputedRowWithCount[] }).rows ?? [];
  for (const row of rows) {
    if (row.driver_id != null && row.avg_rating != null) {
      out.set(row.driver_id, { avg: Number(row.avg_rating), count: Number(row.rating_count) });
    }
  }
  return out;
}

function fallbackFromStored(stored: string | null | undefined): number {
  if (!stored) return DEFAULT_DRIVER_RATING;
  const n = parseFloat(stored);
  return Number.isFinite(n) ? n : DEFAULT_DRIVER_RATING;
}

export async function computeDriverRatings(
  drivers: Array<{ id: string; rating?: string | null }>,
): Promise<Map<string, number>> {
  const computed = await computeFromRides(drivers.map((d) => d.id));
  const out = new Map<string, number>();
  for (const d of drivers) {
    const entry = computed.get(d.id);
    out.set(d.id, entry?.avg ?? fallbackFromStored(d.rating));
  }
  return out;
}

export async function computeDriverRating(
  driverId: string,
  storedRating?: string | null,
): Promise<number> {
  const map = await computeFromRides([driverId]);
  const entry = map.get(driverId);
  return entry?.avg ?? fallbackFromStored(storedRating);
}

export async function recomputeAndStoreDriverRating(
  driverId: string,
): Promise<number> {
  const map = await computeFromRides([driverId]);
  const entry = map.get(driverId);
  if (entry == null) return DEFAULT_DRIVER_RATING;
  await db
    .update(usersTable)
    .set({ rating: entry.avg.toFixed(2), driverRatingCount: entry.count })
    .where(eq(usersTable.id, driverId));
  return entry.avg;
}
