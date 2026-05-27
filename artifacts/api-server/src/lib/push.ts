import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import {
  db,
  usersTable,
  notificationTemplatesTable,
  pushTicketsTable,
  rideDispatchLogsTable,
  ridesTable,
  vehiclesTable,
  vehicleTypesTable,
} from "@workspace/db";
import { getConfig } from "./settings";
import {
  SOUND_CATEGORY_TO_SETTING_KEY,
  type SoundCategory,
} from "../routes/notification-sounds";
import { and, asc, eq, lt, gt, inArray, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { emitToAdmins, emitToUser, isUserSocketConnected } from "./io";
import { invalidateDriverRates } from "./driverStats";

type TemplateVars = Record<string, string>;

function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

const expo = new Expo();

/** Result of a push notification send attempt at the ticket level. */
export interface PushSendResult {
  status: "ok" | "error" | "no_token";
  receiptId?: string;
  errorCode?: string;
}

/**
 * Resolve the configured sound slug for a category, suitable for the Expo
 * `sound` field. Returns "default" when no category, no override, or the
 * stored value is the system default. Any non-default slug must be present
 * in a native build to actually play — otherwise iOS/Android falls back to
 * the system sound, which we accept silently.
 */
async function resolveCategorySound(
  category: SoundCategory | undefined,
): Promise<string> {
  if (!category) return "default";
  try {
    const cfg = await getConfig();
    const key = SOUND_CATEGORY_TO_SETTING_KEY[category];
    const value = (cfg as unknown as Record<string, string>)[key];
    if (!value || value === "default") return "default";
    return value;
  } catch (err) {
    logger.warn({ err, category }, "[push] failed to resolve sound for category");
    return "default";
  }
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  rideId?: string,
  category?: SoundCategory,
): Promise<PushSendResult> {
  const [user] = await db
    .select({ expoPushToken: usersTable.expoPushToken })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user?.expoPushToken) {
    logger.info({ userId }, "[push] no push token stored for user — skipping");
    return { status: "no_token" };
  }

  const token = user.expoPushToken;
  if (!Expo.isExpoPushToken(token)) {
    logger.warn({ userId, token }, "[push] invalid Expo push token — skipping");
    return { status: "error", errorCode: "InvalidToken" };
  }

  const sound = await resolveCategorySound(category);
  const message: ExpoPushMessage = {
    to: token,
    sound,
    title,
    body,
    data: data ?? {},
  };

  const chunks = expo.chunkPushNotifications([message]);
  let lastResult: PushSendResult = { status: "ok" };

  for (const chunk of chunks) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    for (const ticket of tickets) {
      if (ticket.status === "error") {
        lastResult = { status: "error", errorCode: ticket.details?.error };
        logger.error({ userId, ticket, rideId }, "[push] push notification ticket error");
        if (ticket.details?.error === "DeviceNotRegistered") {
          logger.info({ userId, rideId }, "[push] device not registered — clearing stale push token");
          await db
            .update(usersTable)
            .set({ expoPushToken: null })
            .where(eq(usersTable.id, userId));
        }
      } else if (ticket.status === "ok" && ticket.id) {
        lastResult = { status: "ok", receiptId: ticket.id };
        try {
          await db.insert(pushTicketsTable).values({
            userId,
            receiptId: ticket.id,
            rideId: rideId ?? null,
          });
          logger.info({ userId, receiptId: ticket.id, rideId }, "[push] stored receipt ticket for later polling");
        } catch (err) {
          logger.warn({ err, userId, receiptId: ticket.id, rideId }, "[push] failed to store receipt ticket");
        }
      }
    }
  }

  logger.info({ userId, title, rideId }, "[push] push notification sent");
  return lastResult;
}

// Expo receipts are available for roughly 48 hours after send; after that
// the API will never return them, so we treat them as permanently unavailable.
const RECEIPT_TTL_MS = 48 * 60 * 60 * 1000;

// In-process guard to prevent overlapping poll runs if one takes longer than
// the interval (avoids duplicate work and noisy logs).
let receiptPollInProgress = false;

// Health signals — updated each poll cycle.
let lastPollCompletedAt: Date | null = null;
let receiptErrorCount = 0;

export function getPushServiceHealth(): { lastPollAt: Date | null; receiptErrorCount: number } {
  return { lastPollAt: lastPollCompletedAt, receiptErrorCount };
}

/**
 * Attempt to dispatch a ride request to the next eligible driver that hasn't
 * already been notified for this ride. Called when receipt polling confirms a
 * push delivery failure so the ride doesn't silently fall through.
 *
 * Idempotency: skips any driver already present in ride_dispatch_logs for
 * this rideId, preventing duplicate dispatch attempts.
 */
async function retryRideDispatch(rideId: string, failedDriverId: string): Promise<void> {
  try {
    // Only retry if the ride is still accepting bids.
    const [ride] = await db
      .select()
      .from(ridesTable)
      .where(eq(ridesTable.id, rideId))
      .limit(1);

    if (!ride || ride.status !== "bidding") {
      logger.info({ rideId }, "[dispatch] skipping retry — ride no longer in bidding state");
      return;
    }

    // Collect driver IDs already dispatched to for this ride (idempotency guard).
    const alreadyDispatched = await db
      .select({ driverId: rideDispatchLogsTable.driverId })
      .from(rideDispatchLogsTable)
      .where(eq(rideDispatchLogsTable.rideId, rideId));
    const excludedIds = alreadyDispatched.map((d) => d.driverId);

    // Find the next eligible online driver not already dispatched.
    const candidateQuery = db
      .select({
        userId: usersTable.id,
        expoPushToken: usersTable.expoPushToken,
        vehicleTypeId: vehiclesTable.vehicleTypeId,
        vehicleCategory: vehicleTypesTable.vehicleCategory,
        wheelchairAccess: vehicleTypesTable.wheelchairAccess,
        petFriendly: vehicleTypesTable.petFriendly,
        assistAvailable: vehicleTypesTable.assistAvailable,
        poolEnabled: vehicleTypesTable.poolEnabled,
        personCapacity: vehicleTypesTable.personCapacity,
      })
      .from(usersTable)
      .leftJoin(vehiclesTable, eq(vehiclesTable.userId, usersTable.id))
      .leftJoin(vehicleTypesTable, eq(vehicleTypesTable.id, vehiclesTable.vehicleTypeId))
      .where(
        and(
          eq(usersTable.driverOnline, true),
          eq(usersTable.driverStatus, "approved"),
          excludedIds.length > 0
            ? notInArray(usersTable.id, excludedIds)
            : undefined,
        ),
      )
      .limit(20);

    const candidates = await candidateQuery;

    // Apply the same vehicle-type and capability filters as the initial dispatch.
    let rideVehicleCategory: string | null = null;
    if (ride.vehicleTypeId) {
      const [rideVt] = await db
        .select({ vehicleCategory: vehicleTypesTable.vehicleCategory })
        .from(vehicleTypesTable)
        .where(eq(vehicleTypesTable.id, ride.vehicleTypeId))
        .limit(1);
      rideVehicleCategory = rideVt?.vehicleCategory ?? null;
    }

    for (const candidate of candidates) {
      if (rideVehicleCategory && candidate.vehicleCategory !== rideVehicleCategory) continue;
      if (ride.wheelchairRequested && !candidate.wheelchairAccess) continue;
      if (ride.petRequested && !candidate.petFriendly) continue;
      if (ride.assistRequested && !candidate.assistAvailable) continue;
      if (ride.isShared) {
        if (!candidate.poolEnabled) continue;
        if ((candidate.personCapacity ?? 0) < ride.seatsRequested) continue;
      }

      const nextDriverId = candidate.userId;

      // Build a minimal ride payload — enough for the driver to act on it.
      const ridePayload = {
        id: ride.id,
        pickup: { label: ride.pickupLabel, address: ride.pickupAddress },
        dropoff: { label: ride.dropoffLabel, address: ride.dropoffAddress },
        pickupLat: ride.pickupLat,
        pickupLng: ride.pickupLng,
        dropoffLat: ride.dropoffLat,
        dropoffLng: ride.dropoffLng,
        distanceKm: ride.estimatedDistanceKm,
        durationMin: ride.estimatedDurationMin,
        initialFare: ride.initialFare,
        vehicleClass: ride.vehicleClass,
        vehicleTypeId: ride.vehicleTypeId,
        isShared: ride.isShared,
        seatsRequested: ride.seatsRequested,
        receivedAt: ride.createdAt.getTime(),
      };

      if (isUserSocketConnected(nextDriverId)) {
        emitToUser(nextDriverId, "ride:new", ridePayload);
        await db.insert(rideDispatchLogsTable).values({
          rideId,
          driverId: nextDriverId,
          method: "socket",
          status: "delivered",
        });
        // A delivered dispatch bumps this driver's acceptance denominator.
        invalidateDriverRates(nextDriverId);
        logger.info({ rideId, nextDriverId, failedDriverId }, "[dispatch] retry succeeded via socket");
        // Successfully dispatched — stop here.
        return;
      } else if (candidate.expoPushToken) {
        const result = await sendPushFromTemplate(
          nextDriverId,
          "driver_ride_request",
          "New ride request",
          `Pickup: ${ride.pickupLabel}`,
          { pickup: ride.pickupLabel, dropoff: ride.dropoffLabel },
          { type: "ride_request", rideId: ride.id },
          ride.id,
          "newTripRequest",
        );
        const pushStatus = result.status === "ok" ? "queued" : "failed";
        await db.insert(rideDispatchLogsTable).values({
          rideId,
          driverId: nextDriverId,
          method: "push",
          status: pushStatus,
          failureReason: result.status !== "ok" ? (result.errorCode ?? "unknown") : null,
        });
        logger.info({ rideId, nextDriverId, failedDriverId, pushStatus }, "[dispatch] retry push queued");
        // Push accepted by Expo (queued) — stop here. If the send immediately
        // failed (e.g. invalid token), continue trying the next candidate.
        if (pushStatus === "queued") return;
      }

      // Candidate has neither an active socket nor a push token — skip and
      // try the next eligible driver.
      logger.debug({ rideId, nextDriverId }, "[dispatch] candidate unreachable (no socket, no push token) — skipping");
    }

    logger.warn({ rideId, failedDriverId }, "[dispatch] retry failed — no other eligible drivers available");
  } catch (err) {
    logger.error({ err, rideId, failedDriverId }, "[dispatch] retryRideDispatch error");
  }
}

export async function pollPushReceipts(): Promise<void> {
  if (receiptPollInProgress) {
    logger.warn("[push] skipping poll — previous receipt poll still in progress");
    return;
  }
  receiptPollInProgress = true;
  try {
    const now = new Date();
    const ttlCutoff = new Date(now.getTime() - RECEIPT_TTL_MS);

    // Discard tickets that are too old for Expo to ever return a receipt for.
    // This prevents unbounded table growth when Expo never reports a receipt
    // (e.g. the notification was silently dropped).
    await db
      .delete(pushTicketsTable)
      .where(lt(pushTicketsTable.createdAt, ttlCutoff));
    logger.info({ ttlCutoff }, "[push] purged expired push ticket rows (past TTL)");

    // Only poll tickets that are fresh enough to still yield receipts.
    // Order by createdAt ascending so oldest-pending tickets are processed
    // first and no row is perpetually starved.
    const storedTickets = await db
      .select()
      .from(pushTicketsTable)
      .where(gt(pushTicketsTable.createdAt, ttlCutoff))
      .orderBy(asc(pushTicketsTable.createdAt))
      .limit(100);

    if (storedTickets.length === 0) {
      return;
    }

    const receiptIds = storedTickets.map((t) => t.receiptId);
    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    for (const chunk of receiptIdChunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

        // Expo only includes IDs that have reached a definitive delivery state
        // ("ok" or "error"). IDs absent from the response are still pending —
        // their ticket rows are preserved and will be retried next poll cycle.
        for (const [receiptId, receipt] of Object.entries(receipts)) {
          const ticket = storedTickets.find((t) => t.receiptId === receiptId);
          if (!ticket) continue;

          if (receipt.status === "error") {
            receiptErrorCount += 1;
            logger.error(
              { userId: ticket.userId, receiptId, receipt, rideId: ticket.rideId },
              "[push] push receipt error",
            );
            if (receipt.details?.error === "DeviceNotRegistered") {
              logger.info(
                { userId: ticket.userId, rideId: ticket.rideId },
                "[push] device not registered (receipt) — clearing stale push token",
              );
              await db
                .update(usersTable)
                .set({ expoPushToken: null })
                .where(eq(usersTable.id, ticket.userId));
            }

            // Update the dispatch log entry to reflect confirmed delivery failure.
            if (ticket.rideId) {
              const errorCode = receipt.details?.error ?? "unknown";
              logger.warn(
                {
                  rideId: ticket.rideId,
                  driverId: ticket.userId,
                  errorCode,
                },
                "[push] ride-request push failed delivery — attempting retry to next eligible driver",
              );
              await db
                .update(rideDispatchLogsTable)
                .set({
                  status: "failed",
                  failureReason: errorCode,
                })
                .where(
                  and(
                    eq(rideDispatchLogsTable.rideId, ticket.rideId),
                    eq(rideDispatchLogsTable.driverId, ticket.userId),
                  ),
                );
              // Alert admins in real-time so dispatchers can intervene.
              emitToAdmins("push:notification_failed", {
                rideId: ticket.rideId,
                driverId: ticket.userId,
                errorCode,
              });
              // Attempt to re-dispatch to the next eligible driver.
              await retryRideDispatch(ticket.rideId, ticket.userId);
            }
          } else {
            logger.info(
              { userId: ticket.userId, receiptId, rideId: ticket.rideId },
              "[push] push receipt confirmed delivered",
            );
            // Update the dispatch log entry to reflect confirmed delivery.
            if (ticket.rideId) {
              const updatedRows = await db
                .update(rideDispatchLogsTable)
                .set({ status: "delivered" })
                .where(
                  and(
                    eq(rideDispatchLogsTable.rideId, ticket.rideId),
                    eq(rideDispatchLogsTable.driverId, ticket.userId),
                    eq(rideDispatchLogsTable.status, "queued"),
                  ),
                )
                .returning({ id: rideDispatchLogsTable.id });
              // Only invalidate if a row actually transitioned to delivered.
              if (updatedRows.length > 0) {
                invalidateDriverRates(ticket.userId);
              }
            }
          }

          // Receipt has reached a terminal state — safe to remove the ticket.
          await db
            .delete(pushTicketsTable)
            .where(eq(pushTicketsTable.receiptId, receiptId));
        }
      } catch (err) {
        // On a transient API error the chunk's ticket rows are left intact
        // so the next poll cycle will retry fetching their receipts.
        logger.error({ err }, "[push] failed to fetch push receipts chunk");
      }
    }
    lastPollCompletedAt = new Date();
  } catch (err) {
    logger.error({ err }, "[push] pollPushReceipts error");
  } finally {
    receiptPollInProgress = false;
  }
}

export async function sendPushFromTemplate(
  userId: string,
  templateKey: string,
  defaultTitle: string,
  defaultBody: string,
  extraVars?: TemplateVars,
  data?: Record<string, unknown>,
  rideId?: string,
  category?: SoundCategory,
): Promise<PushSendResult> {
  let title = defaultTitle;
  let body = defaultBody;

  try {
    const [tmpl] = await db
      .select()
      .from(notificationTemplatesTable)
      .where(
        and(
          eq(notificationTemplatesTable.key, templateKey),
          eq(notificationTemplatesTable.type, "push"),
          eq(notificationTemplatesTable.active, true),
        ),
      )
      .limit(1);

    if (tmpl) {
      title = tmpl.title;
      body = tmpl.body;
    }
  } catch (err) {
    logger.warn({ err, templateKey }, "[push] failed to load notification template — using defaults");
  }

  let vars: TemplateVars = {};
  try {
    const [user] = await db
      .select({
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        city: usersTable.city,
        rating: usersTable.rating,
        trips: usersTable.trips,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (user) {
      const fullName = `${user.firstName} ${user.lastName}`.trim();
      vars = {
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
        city: user.city ?? "",
        rating: user.rating ?? "",
        trips: user.trips ?? "",
      };
    }
  } catch (err) {
    logger.warn({ err, userId }, "[push] failed to load user for template variable substitution");
  }

  if (extraVars) {
    vars = { ...vars, ...extraVars };
  }

  return sendPushNotification(
    userId,
    interpolate(title, vars),
    interpolate(body, vars),
    data,
    rideId,
    category,
  );
}
