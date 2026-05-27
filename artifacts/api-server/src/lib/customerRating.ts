import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const DEFAULT_CUSTOMER_RATING = 5.0;
export const RECENT_RIDES_FULL_WINDOW = 100;
export const RECENT_RIDES_NEW_WINDOW = 10;

interface ComputedRow {
  rider_id: string;
  avg_rating: number;
  rating_count: number;
  [key: string]: unknown;
}

async function computeFromRides(riderIds: string[]): Promise<Map<string, { avg: number; count: number }>> {
  const out = new Map<string, { avg: number; count: number }>();
  if (riderIds.length === 0) return out;
  const fullWindow = sql.raw(String(RECENT_RIDES_FULL_WINDOW));
  const newWindow = sql.raw(String(RECENT_RIDES_NEW_WINDOW));
  const result = await db.execute<ComputedRow>(sql`
    WITH ranked AS (
      SELECT
        rider_id,
        customer_rating_score,
        ROW_NUMBER() OVER (
          PARTITION BY rider_id
          ORDER BY updated_at DESC, id DESC
        ) AS rn,
        COUNT(*) OVER (PARTITION BY rider_id) AS total
      FROM rides
      WHERE status = 'completed'
        AND customer_rating_score IS NOT NULL
        AND rider_id IN (${sql.join(
          riderIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    )
    SELECT
      rider_id,
      AVG(customer_rating_score)::float AS avg_rating,
      COUNT(*)::int AS rating_count
    FROM ranked
    WHERE rn <= CASE WHEN total >= ${fullWindow} THEN ${fullWindow} ELSE ${newWindow} END
    GROUP BY rider_id
  `);
  const rows = (result as unknown as { rows: ComputedRow[] }).rows ?? [];
  for (const row of rows) {
    if (row.rider_id != null && row.avg_rating != null) {
      out.set(row.rider_id, {
        avg: Number(row.avg_rating),
        count: Number(row.rating_count),
      });
    }
  }
  return out;
}

export async function recomputeAndStoreCustomerRating(
  riderId: string,
): Promise<{ avg: number; count: number }> {
  const map = await computeFromRides([riderId]);
  const entry = map.get(riderId);
  if (!entry) return { avg: DEFAULT_CUSTOMER_RATING, count: 0 };
  await db
    .update(usersTable)
    .set({
      customerRating: entry.avg.toFixed(2),
      customerRatingCount: entry.count,
    })
    .where(eq(usersTable.id, riderId));
  return entry;
}
