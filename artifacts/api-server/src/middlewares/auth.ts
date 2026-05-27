import type { Request, Response, NextFunction } from "express";
import { db, usersTable, adminsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { extractBearer, verifyToken } from "../lib/auth";

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = extractBearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "missing_token" });
  const payload = verifyToken(token);
  if (!payload || payload.kind !== "user") return res.status(401).json({ error: "invalid_token" });
  const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, payload.sub)).limit(1);
  if (!u) return res.status(401).json({ error: "user_not_found" });
  req.userId = payload.sub;
  next();
  return;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extractBearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "missing_token" });
  const payload = verifyToken(token);
  if (!payload || payload.kind !== "admin") return res.status(401).json({ error: "invalid_token" });
  const [a] = await db.select({ id: adminsTable.id }).from(adminsTable).where(eq(adminsTable.id, payload.sub)).limit(1);
  if (!a) return res.status(401).json({ error: "admin_not_found" });
  req.adminId = payload.sub;
  next();
  return;
}
