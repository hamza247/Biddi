import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, usersTable, vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser } from "../middlewares/auth";
import { toPublicUser } from "../lib/serializers";
import { Expo } from "expo-server-sdk";

const router: IRouter = Router();

router.patch("/users/me", requireUser, async (req, res) => {
  const parsed = z
    .object({
      firstName: z.string().trim().min(1).max(40).optional(),
      lastName: z.string().trim().max(40).optional(),
      appMode: z.enum(["rider", "driver"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, req.userId!))
    .returning();
  if (!user) return res.status(404).json({ error: "user_not_found" });
  return res.json({ user: toPublicUser(user) });
});

const vehicleSchema = z.object({
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  year: z.string().trim().min(2).max(6),
  color: z.string().trim().min(1).max(20),
  plate: z.string().trim().min(1).max(12),
  vehicleTypeId: z.string().uuid().optional().nullable(),
});

const docItemSchema = z.union([
  z.string().trim().min(1).max(255),
  z.object({
    type: z.string().trim().min(1).max(40),
    url: z.string().min(1).max(500),
  }),
]);
const docsSchema = z.array(docItemSchema).max(20);

router.post("/drivers/apply", requireUser, async (req, res) => {
  const parsed = z
    .object({
      ...vehicleSchema.shape,
      docs: docsSchema.optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const { docs, ...data } = parsed.data;
  const existing = await db.select().from(vehiclesTable).where(eq(vehiclesTable.userId, req.userId!));
  if (existing.length === 0) {
    await db.insert(vehiclesTable).values({ userId: req.userId!, ...data });
  } else {
    await db.update(vehiclesTable).set(data).where(eq(vehiclesTable.userId, req.userId!));
  }

  const [user] = await db
    .update(usersTable)
    .set({
      driverStatus: "pending",
      ...(docs ? { submittedDocs: docs } : {}),
    })
    .where(eq(usersTable.id, req.userId!))
    .returning();

  return res.json({ user: toPublicUser(user), vehicle: data });
});

// Update vehicle while still pending or already approved.
router.put("/drivers/vehicle", requireUser, async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (u.driverStatus === "not_applied") {
    return res.status(409).json({ error: "must_apply_first" });
  }
  const existing = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.userId, req.userId!));
  if (existing.length === 0) {
    await db.insert(vehiclesTable).values({ userId: req.userId!, ...parsed.data });
  } else {
    await db.update(vehiclesTable).set(parsed.data).where(eq(vehiclesTable.userId, req.userId!));
  }
  return res.json({ vehicle: parsed.data });
});

router.get("/drivers/vehicle", requireUser, async (req, res) => {
  const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.userId, req.userId!)).limit(1);
  return res.json({ vehicle: v ?? null });
});

// Update submitted documents independently (e.g., re-upload after rejection).
// When the driver's current status is "rejected", automatically resets it to
// "pending" so admins know there is a fresh set of documents to review.
router.put("/drivers/documents", requireUser, async (req, res) => {
  const parsed = z.object({ docs: docsSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!current) return res.status(404).json({ error: "not_found" });
  const statusReset = current.driverStatus === "rejected" ? { driverStatus: "pending" as const } : {};
  const [user] = await db
    .update(usersTable)
    .set({ submittedDocs: parsed.data.docs, ...statusReset })
    .where(eq(usersTable.id, req.userId!))
    .returning();
  return res.json({ user: toPublicUser(user) });
});

router.post("/user/push-token", requireUser, async (req, res) => {
  const parsed = z.object({ token: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { token } = parsed.data;
  if (!Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: "invalid_push_token" });
  }
  await db
    .update(usersTable)
    .set({ expoPushToken: token })
    .where(eq(usersTable.id, req.userId!));
  return res.json({ ok: true });
});

export default router;
