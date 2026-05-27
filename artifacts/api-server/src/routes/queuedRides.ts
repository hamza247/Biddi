/**
 * Driver-facing endpoints for the queued ride requests feature.
 *
 *   GET  /driver/queued-requests
 *   POST /driver/queued-requests/:rideId/accept
 *   POST /driver/queued-requests/:rideId/decline
 *   POST /system/activate-next-queued-ride       (internal)
 */
import { Router, type IRouter } from "express";
import {
  ActivateNextQueuedRideBody,
  ActivateNextQueuedRideResponse,
  GetDriverQueuedRequestsResponse,
  PostDriverQueuedRequestsRideIdAcceptParams,
  PostDriverQueuedRequestsRideIdAcceptResponse,
  PostDriverQueuedRequestsRideIdDeclineParams,
  PostDriverQueuedRequestsRideIdDeclineResponse,
} from "@workspace/api-zod";
import { db, ridesTable, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireUser } from "../middlewares/auth";
import {
  acceptQueuedRide,
  activateQueuedRideAfterCompletion,
  findQueuedRideCandidates,
  getDriverActiveQueuedRide,
  releaseExpiredQueuedRides,
  rememberDecline,
  shouldOfferQueuedRides,
} from "../lib/queuedRides";
import { emitToRide, emitToUser } from "../lib/io";

const router: IRouter = Router();

async function loadCurrentTripId(driverId: string): Promise<string | null> {
  const [trip] = await db
    .select({ id: ridesTable.id })
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.acceptedDriverId, driverId),
        inArray(ridesTable.status, ["driver_arriving", "in_progress"]),
      ),
    )
    .limit(1);
  return trip?.id ?? null;
}

/**
 * GET /driver/queued-requests
 * Returns the driver's currently-accepted queued ride (if any) plus a fresh
 * list of nearby candidate rides — but only when the driver is close enough
 * to their current dropoff to be offered the queue feature.
 */
router.get("/driver/queued-requests", requireUser, async (req, res) => {
  const driverId = req.userId!;
  // Request-time expiry sweep: release any queued rows whose expires_at
  // has passed BEFORE we read state so the driver never sees a stale
  // accepted/queued indicator.
  await releaseExpiredQueuedRides();
  const currentTripId = await loadCurrentTripId(driverId);
  if (!currentTripId) {
    const empty = { candidates: [], queued: null };
    return res.json(GetDriverQueuedRequestsResponse.parse(empty));
  }

  const accepted = await getDriverActiveQueuedRide(driverId);
  let candidates: Awaited<ReturnType<typeof findQueuedRideCandidates>> = [];
  if (!accepted && (await shouldOfferQueuedRides(driverId, currentTripId))) {
    candidates = await findQueuedRideCandidates(driverId, currentTripId);
  }
  // Strict OpenAPI contract: only the documented candidate fields are
  // returned. Extra DB fields are kept on the internal `QueuedCandidate`
  // type for the acceptance path but never leaked over the wire.
  const payload = {
    candidates: candidates.map((c) => ({
      rideId: c.rideId,
      riderName: c.riderName,
      pickupAddress: c.pickupAddress,
      distanceFromCurrentDropoffKm: c.distanceFromCurrentDropoffKm,
      suggestedFare: c.suggestedFare,
      expiresAtMs: c.expiresAtMs,
    })),
    queued: accepted
      ? {
          rideId: accepted.ride.id,
          pickupAddress: accepted.ride.pickupAddress,
          suggestedFare:
            accepted.ride.initialFare ??
            accepted.ride.fareBreakdown?.total ??
            0,
          initialFare: accepted.ride.initialFare ?? null,
        }
      : null,
  };
  const safe = GetDriverQueuedRequestsResponse.safeParse(payload);
  if (!safe.success) {
    req.log.error({ issues: safe.error.issues }, "[queuedRides] GET response failed schema validation");
    return res.status(500).json({ error: "response_invalid" });
  }
  return res.json(safe.data);
});

/**
 * POST /driver/queued-requests/:rideId/accept
 */
router.post(
  "/driver/queued-requests/:rideId/accept",
  requireUser,
  async (req, res) => {
    const driverId = req.userId!;
    const params = PostDriverQueuedRequestsRideIdAcceptParams.safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: "invalid_input" });
    const rideId = params.data.rideId;
    // Sweep before accept too, so a driver can't beat the expiry race.
    await releaseExpiredQueuedRides();
    const currentTripId = await loadCurrentTripId(driverId);
    if (!currentTripId) {
      return res.status(409).json({ error: "no_active_trip" });
    }
    const result = await acceptQueuedRide(driverId, rideId, currentTripId);
    if (!result.ok) {
      return res
        .status(409)
        .json({ error: result.reason ?? "cannot_queue" });
    }
    // Notify the rider their ride was queued by a driver.
    emitToRide(rideId, "queuedRideAccepted", {
      rideId,
      driverId,
      currentTripId,
    });
    emitToUser(result.ride!.riderId, "queuedRideAccepted", {
      rideId,
      driverId,
      currentTripId,
    });
    // Response shape MUST match the QueuedRideAccepted OpenAPI schema
    // (rideId, pickupAddress, suggestedFare, initialFare). Returning the
    // raw DB row would break the generated type contract.
    const r = result.ride!;
    const payload = {
      ok: true,
      ride: {
        rideId: r.id,
        pickupAddress: r.pickupAddress,
        suggestedFare: r.initialFare ?? r.fareBreakdown?.total ?? 0,
        initialFare: r.initialFare ?? null,
      },
    };
    const safe = PostDriverQueuedRequestsRideIdAcceptResponse.safeParse(payload);
    if (!safe.success) {
      req.log.error({ issues: safe.error.issues }, "[queuedRides] accept response failed schema validation");
      return res.status(500).json({ error: "response_invalid" });
    }
    return res.json(safe.data);
  },
);

/**
 * POST /driver/queued-requests/:rideId/decline
 * Records an in-memory cooldown so the same candidate isn't resent
 * immediately to the same driver.
 */
router.post(
  "/driver/queued-requests/:rideId/decline",
  requireUser,
  async (req, res) => {
    const params = PostDriverQueuedRequestsRideIdDeclineParams.safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: "invalid_input" });
    rememberDecline(req.userId!, params.data.rideId);
    const safe = PostDriverQueuedRequestsRideIdDeclineResponse.parse({ ok: true });
    return res.json(safe);
  },
);

/**
 * POST /system/activate-next-queued-ride
 * Internal endpoint used to manually re-trigger activation. Restricted to
 * the driver who completed the trip — they're the only legitimate caller
 * (the server already runs activation automatically inside /complete).
 */
router.post(
  "/system/activate-next-queued-ride",
  requireUser,
  async (req, res) => {
    // Input validated by the generated zod schema so request shape is
    // guaranteed to match the OpenAPI contract.
    const parsed = ActivateNextQueuedRideBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const driverId = req.userId!;
    const [trip] = await db
      .select({
        acceptedDriverId: ridesTable.acceptedDriverId,
        status: ridesTable.status,
      })
      .from(ridesTable)
      .where(eq(ridesTable.id, parsed.data.completedTripId))
      .limit(1);
    if (!trip || trip.acceptedDriverId !== driverId) {
      return res.status(403).json({ error: "forbidden" });
    }
    // Hard guard: activation is ONLY allowed once the supposed previous
    // trip is actually `completed`. Without this check a driver could call
    // the endpoint mid-trip and end up assigned to two active rides
    // simultaneously, violating the "one active trip per driver" invariant.
    if (trip.status !== "completed") {
      return res.status(409).json({ error: "trip_not_completed" });
    }
    const result = await activateQueuedRideAfterCompletion(
      driverId,
      parsed.data.completedTripId,
    );
    const payload = result
      ? { activated: { activatedRideId: result.activatedRideId, rideStatus: result.rideStatus } }
      : { activated: null };
    // Output validated by the generated zod schema so response shape is
    // guaranteed to match the OpenAPI contract.
    const safeOut = ActivateNextQueuedRideResponse.safeParse(payload);
    if (!safeOut.success) {
      req.log.error({ issues: safeOut.error.issues }, "[queuedRides] activate response failed schema validation");
      return res.status(500).json({ error: "response_invalid" });
    }
    if (result) {
      emitToUser(driverId, "queuedRideActivated", {
        rideId: result.activatedRideId,
      });
      emitToRide(result.activatedRideId, "queuedRideActivated", {
        rideId: result.activatedRideId,
      });
    }
    return res.json(safeOut.data);
  },
);

export default router;
