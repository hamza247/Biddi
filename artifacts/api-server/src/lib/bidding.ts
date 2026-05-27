import { and, eq, ne } from "drizzle-orm";
import { db, ridesTable, bidsTable } from "@workspace/db";
import { invalidateDriverRates } from "./driverStats";

export type AcceptBidErrorCode =
  | "not_found"
  | "forbidden"
  | "not_bidding"
  | "bid_not_found"
  | "ride_no_longer_bidding";

export type AcceptBidResult =
  | { ok: false; error: AcceptBidErrorCode }
  | {
      ok: true;
      ride: typeof ridesTable.$inferSelect;
      bid: typeof bidsTable.$inferSelect;
      siblings: Array<typeof ridesTable.$inferSelect>;
      losingDriverIds: string[];
    };

/**
 * Accept a driver's bid on a bidding ride. Idempotent on the (ride, bid)
 * pair while the ride is still in 'bidding' state; once the ride has moved
 * past 'bidding' subsequent calls return `ride_no_longer_bidding` so
 * callers can detect a race.
 *
 * Returns the updated ride, the bid that won, any shared-pool siblings
 * that were cascaded into 'driver_arriving', and the driver IDs of bids
 * that lost so the caller can notify them.
 *
 * Socket emission is intentionally NOT done here — callers emit their
 * channel-specific events (rides.ts emits `ride:accepted`, bidding.ts
 * emits `bidding:accepted` + `bidding:lost`).
 */
export async function acceptBid(params: {
  rideId: string;
  bidId: string;
  expectedRiderId: string;
}): Promise<AcceptBidResult> {
  const { rideId, bidId, expectedRiderId } = params;

  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, rideId))
    .limit(1);
  if (!ride) return { ok: false, error: "not_found" };
  if (ride.riderId !== expectedRiderId) return { ok: false, error: "forbidden" };
  if (ride.status !== "bidding") return { ok: false, error: "not_bidding" };

  const [bid] = await db
    .select()
    .from(bidsTable)
    .where(eq(bidsTable.id, bidId))
    .limit(1);
  if (!bid || bid.rideId !== ride.id)
    return { ok: false, error: "bid_not_found" };

  const [updated] = await db
    .update(ridesTable)
    .set({
      status: "driver_arriving",
      acceptedBidId: bid.id,
      acceptedDriverId: bid.driverId,
      updatedAt: new Date(),
    })
    .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.status, "bidding")))
    .returning();
  if (!updated) return { ok: false, error: "ride_no_longer_bidding" };

  const losingBids = await db
    .select({ driverId: bidsTable.driverId })
    .from(bidsTable)
    .where(
      and(
        eq(bidsTable.rideId, ride.id),
        eq(bidsTable.status, "active"),
        ne(bidsTable.id, bid.id),
      ),
    );
  await db
    .update(bidsTable)
    .set({ status: "rejected" })
    .where(
      and(
        eq(bidsTable.rideId, ride.id),
        eq(bidsTable.status, "active"),
        ne(bidsTable.id, bid.id),
      ),
    );
  await db
    .update(bidsTable)
    .set({ status: "accepted" })
    .where(eq(bidsTable.id, bid.id));

  invalidateDriverRates(bid.driverId);

  const siblings: Array<typeof ridesTable.$inferSelect> = [];
  if (ride.sharedGroupId) {
    const groupSiblings = await db
      .select()
      .from(ridesTable)
      .where(
        and(
          eq(ridesTable.sharedGroupId, ride.sharedGroupId),
          ne(ridesTable.id, ride.id),
        ),
      );
    for (const sibling of groupSiblings) {
      if (sibling.status !== "bidding") continue;
      await db
        .update(ridesTable)
        .set({
          status: "driver_arriving",
          acceptedDriverId: bid.driverId,
          updatedAt: new Date(),
        })
        .where(eq(ridesTable.id, sibling.id));
      siblings.push(sibling);
    }
  }

  return {
    ok: true,
    ride: updated,
    bid,
    siblings,
    losingDriverIds: losingBids.map((b) => b.driverId),
  };
}
