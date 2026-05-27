/**
 * Driver destination-mode endpoints.
 *
 *   GET  /driver/destination-mode
 *   POST /driver/destination-mode/activate
 *   POST /driver/destination-mode/deactivate
 *   GET  /driver/saved-places
 *   POST /driver/saved-places
 *   DELETE /driver/saved-places/:id
 */
import { Router, type IRouter } from "express";
import {
  db,
  driverDestinationModesTable,
  driverSavedPlacesTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  ActivateDriverDestinationModeBody,
  UpsertDriverSavedPlaceBody,
} from "@workspace/api-zod";
import { requireUser } from "../middlewares/auth";
import {
  countActivationsToday,
  getActiveDestinationMode,
  haversineKm,
  loadDestinationModeConfig,
} from "../lib/destinationMode";

const router: IRouter = Router();

async function getDriverDisableInfo(driverId: string): Promise<{
  disabledUntil: Date | null;
  disabledReason: string | null;
}> {
  const [u] = await db
    .select({
      until: usersTable.destinationModeDisabledUntil,
      reason: usersTable.destinationModeDisabledReason,
    })
    .from(usersTable)
    .where(eq(usersTable.id, driverId))
    .limit(1);
  if (!u || !u.until || u.until.getTime() <= Date.now()) {
    return { disabledUntil: null, disabledReason: null };
  }
  return { disabledUntil: u.until, disabledReason: u.reason ?? null };
}

async function buildState(driverId: string) {
  const cfg = await loadDestinationModeConfig();
  const active = await getActiveDestinationMode(driverId);
  const used = await countActivationsToday(driverId);
  const remaining = Math.max(0, cfg.maxPerDay - used);
  const disable = await getDriverDisableInfo(driverId);
  return {
    active: active
      ? {
          id: active.id,
          address: active.destinationAddress,
          label: active.destinationLabel ?? "",
          lat: active.destLat,
          lng: active.destLng,
          activatedAt: active.activatedAt.toISOString(),
          expiresAt: active.expiresAt ? active.expiresAt.toISOString() : null,
        }
      : null,
    filtersUsedToday: used,
    filtersRemainingToday: remaining,
    disabledUntil: disable.disabledUntil
      ? disable.disabledUntil.toISOString()
      : null,
    disabledReason: disable.disabledReason,
    config: cfg,
  };
}

router.get("/driver/destination-mode", requireUser, async (req, res) => {
  res.json(await buildState(req.userId!));
});

router.post(
  "/driver/destination-mode/activate",
  requireUser,
  async (req, res) => {
    const parsed = ActivateDriverDestinationModeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

    const driverId = req.userId!;
    const cfg = await loadDestinationModeConfig();
    if (!cfg.enabled)
      return res.status(400).json({ error: "feature_disabled" });

    const disable = await getDriverDisableInfo(driverId);
    if (disable.disabledUntil) {
      return res.status(403).json({
        error: "disabled_for_driver",
        disabledUntil: disable.disabledUntil.toISOString(),
        disabledReason: disable.disabledReason,
      });
    }

    const existing = await getActiveDestinationMode(driverId);
    // Treat as a free "edit" only when the driver is tweaking the *same*
    // destination shortly after activating — same coords (within ~150 m) and
    // within 10 minutes. Otherwise it counts as a fresh activation against
    // the daily cap so drivers can't rapidly re-target without consuming a
    // filter.
    const isSameDest =
      !!existing &&
      haversineKm(
        existing.destLat,
        existing.destLng,
        parsed.data.lat,
        parsed.data.lng,
      ) < 0.15;
    const isEdit =
      !!existing &&
      isSameDest &&
      Date.now() - existing.activatedAt.getTime() < 10 * 60_000;

    if (!isEdit) {
      const used = await countActivationsToday(driverId);
      if (used >= cfg.maxPerDay) {
        return res.status(429).json({ error: "daily_cap_reached" });
      }
    }

    if (existing && !isEdit) {
      await db
        .update(driverDestinationModesTable)
        .set({
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedReason: "replaced",
          updatedAt: new Date(),
        })
        .where(eq(driverDestinationModesTable.id, existing.id));
    }

    const expiresAt =
      cfg.autoDisableMinutes > 0
        ? new Date(Date.now() + cfg.autoDisableMinutes * 60_000)
        : null;

    if (isEdit && existing) {
      await db
        .update(driverDestinationModesTable)
        .set({
          destinationAddress: parsed.data.address,
          destinationLabel: parsed.data.label ?? "",
          destLat: parsed.data.lat,
          destLng: parsed.data.lng,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(driverDestinationModesTable.id, existing.id));
    } else {
      await db.insert(driverDestinationModesTable).values({
        driverId,
        destinationAddress: parsed.data.address,
        destinationLabel: parsed.data.label ?? "",
        destLat: parsed.data.lat,
        destLng: parsed.data.lng,
        expiresAt,
      });
      // Also write a recent place so the driver sees it in the picker next time.
      await db.insert(driverSavedPlacesTable).values({
        driverId,
        kind: "recent",
        label: parsed.data.label ?? "",
        address: parsed.data.address,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        googlePlaceId: parsed.data.googlePlaceId ?? null,
      });
    }

    res.json(await buildState(driverId));
  },
);

router.post(
  "/driver/destination-mode/deactivate",
  requireUser,
  async (req, res) => {
    const driverId = req.userId!;
    const active = await getActiveDestinationMode(driverId);
    if (active) {
      await db
        .update(driverDestinationModesTable)
        .set({
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedReason: "manual",
          updatedAt: new Date(),
        })
        .where(eq(driverDestinationModesTable.id, active.id));
    }
    res.json(await buildState(driverId));
  },
);

function serializePlace(p: typeof driverSavedPlacesTable.$inferSelect) {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    googlePlaceId: p.googlePlaceId,
    lastUsedAt: p.lastUsedAt.getTime(),
  };
}

router.get("/driver/saved-places", requireUser, async (req, res) => {
  const rows = await db
    .select()
    .from(driverSavedPlacesTable)
    .where(eq(driverSavedPlacesTable.driverId, req.userId!))
    .orderBy(desc(driverSavedPlacesTable.lastUsedAt))
    .limit(50);
  const home = rows.find((r) => r.kind === "home") ?? null;
  const work = rows.find((r) => r.kind === "work") ?? null;
  const recents = rows.filter((r) => r.kind === "recent").slice(0, 8);
  res.json({
    home: home ? serializePlace(home) : null,
    work: work ? serializePlace(work) : null,
    recents: recents.map(serializePlace),
  });
});

router.post("/driver/saved-places", requireUser, async (req, res) => {
  const parsed = UpsertDriverSavedPlaceBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const driverId = req.userId!;

  // Home/Work are unique slots — replace any existing row of that kind.
  if (parsed.data.kind === "home" || parsed.data.kind === "work") {
    await db
      .delete(driverSavedPlacesTable)
      .where(
        and(
          eq(driverSavedPlacesTable.driverId, driverId),
          eq(driverSavedPlacesTable.kind, parsed.data.kind),
        ),
      );
  }

  const [row] = await db
    .insert(driverSavedPlacesTable)
    .values({
      driverId,
      kind: parsed.data.kind as "home" | "work" | "recent",
      label: parsed.data.label ?? "",
      address: parsed.data.address,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      googlePlaceId: parsed.data.googlePlaceId ?? null,
    })
    .returning();
  res.json(serializePlace(row));
});

router.delete("/driver/saved-places/:id", requireUser, async (req, res) => {
  await db
    .delete(driverSavedPlacesTable)
    .where(
      and(
        eq(driverSavedPlacesTable.id, req.params.id),
        eq(driverSavedPlacesTable.driverId, req.userId!),
      ),
    );
  res.json({ ok: true });
});

export default router;
