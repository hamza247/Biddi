import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, placesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "../middlewares/auth";

const router: IRouter = Router();

function serialize(p: typeof placesTable.$inferSelect) {
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

router.get("/places", requireUser, async (req, res) => {
  const rows = await db
    .select()
    .from(placesTable)
    .where(eq(placesTable.userId, req.userId!))
    .orderBy(desc(placesTable.lastUsedAt))
    .limit(50);
  return res.json({
    saved: rows.filter((r) => r.kind === "saved").map(serialize),
    recent: rows.filter((r) => r.kind === "recent").slice(0, 8).map(serialize),
  });
});

const upsertSchema = z.object({
  label: z.string().max(80).optional().default(""),
  address: z.string().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  googlePlaceId: z.string().max(200).optional(),
});

router.post("/places", requireUser, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [row] = await db
    .insert(placesTable)
    .values({
      userId: req.userId!,
      kind: "saved",
      label: parsed.data.label,
      address: parsed.data.address,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      googlePlaceId: parsed.data.googlePlaceId ?? null,
    })
    .returning();
  return res.status(201).json({ place: serialize(row) });
});

router.delete("/places/:id", requireUser, async (req, res) => {
  await db
    .delete(placesTable)
    .where(and(eq(placesTable.id, (req.params.id as string)), eq(placesTable.userId, req.userId!)));
  return res.json({ ok: true });
});

export async function recordRecentPlace(
  userId: string,
  data: { address: string; lat: number; lng: number; label?: string; googlePlaceId?: string | null },
) {
  // Dedupe by rounded coordinates: if a recent already exists at ~same spot, bump lastUsedAt.
  const recents = await db
    .select()
    .from(placesTable)
    .where(and(eq(placesTable.userId, userId), eq(placesTable.kind, "recent")))
    .orderBy(desc(placesTable.lastUsedAt))
    .limit(20);
  const dupe = recents.find(
    (r) => Math.abs(r.lat - data.lat) < 0.0005 && Math.abs(r.lng - data.lng) < 0.0005,
  );
  if (dupe) {
    await db
      .update(placesTable)
      .set({ lastUsedAt: new Date(), address: data.address })
      .where(eq(placesTable.id, dupe.id));
    return;
  }
  await db.insert(placesTable).values({
    userId,
    kind: "recent",
    label: data.label ?? "",
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    googlePlaceId: data.googlePlaceId ?? null,
  });
  // Trim to keep at most 10 recents
  if (recents.length >= 10) {
    const toDelete = recents.slice(9);
    for (const r of toDelete) {
      await db.delete(placesTable).where(eq(placesTable.id, r.id));
    }
  }
}

export default router;
