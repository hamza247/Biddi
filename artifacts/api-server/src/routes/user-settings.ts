import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireUser } from "../middlewares/auth";
import {
  UpdateMyQuickRepliesBody,
  UpdateMyQuickRepliesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const MAX_REPLIES = 12;
const MAX_LEN = 60;

type Stored = { driver?: string[]; rider?: string[] };

function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, MAX_LEN));
    if (out.length >= MAX_REPLIES) break;
  }
  return out;
}

function pack(stored: Stored | null | undefined) {
  return {
    driver: sanitize(stored?.driver),
    rider: sanitize(stored?.rider),
  };
}

router.get("/me/quick-replies", requireUser, async (req, res) => {
  const [u] = await db
    .select({ quickReplies: usersTable.quickReplies })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);
  if (!u) return res.status(404).json({ error: "user_not_found" });
  return res.json(pack(u.quickReplies as Stored | null));
});

router.put("/me/quick-replies", requireUser, async (req, res) => {
  const parsed = UpdateMyQuickRepliesBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const { role, replies } = parsed.data;
  const cleaned = sanitize(replies);

  const [current] = await db
    .select({ quickReplies: usersTable.quickReplies })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);
  if (!current) return res.status(404).json({ error: "user_not_found" });

  const existing = (current.quickReplies as Stored | null) ?? {};
  const next: Stored = { ...existing, [role]: cleaned };
  await db
    .update(usersTable)
    .set({ quickReplies: next })
    .where(eq(usersTable.id, req.userId!));

  const body = pack(next);
  // Validate the outgoing shape matches the published contract.
  UpdateMyQuickRepliesResponse.parse(body);
  return res.json(body);
});

export default router;
