import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireUser } from "../middlewares/auth";
import { checkLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import {
  autocomplete,
  placeDetails,
  reverseGeocode,
  forwardGeocode,
  osrmRoute,
} from "../lib/maps";

const router: IRouter = Router();

function checkBoth(
  req: { userId?: string; ip?: string },
  scope: string,
  perUser: number,
  perIp: number,
  windowMs = 60_000,
) {
  // Enforce both per-user and per-IP windows.
  const userKey = `${scope}:u:${req.userId ?? "anon"}`;
  const ipKey = `${scope}:ip:${req.ip ?? "anon"}`;
  const u = checkLimit(userKey, perUser, windowMs);
  if (!u.ok) return false;
  const i = checkLimit(ipKey, perIp, windowMs);
  return i.ok;
}

router.get("/maps/autocomplete", requireUser, async (req, res) => {
  if (!checkBoth(req, "ac", 60, 120))
    return res.status(429).json({ error: "rate_limited" });
  const parsed = z
    .object({
      q: z.string().min(1).max(200),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      session: z.string().min(8).max(64).optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const bias =
    parsed.data.lat !== undefined && parsed.data.lng !== undefined
      ? { lat: parsed.data.lat, lng: parsed.data.lng }
      : undefined;
  try {
    const results = await autocomplete(parsed.data.q, bias, parsed.data.session);
    return res.json({ results });
  } catch (err) {
    logger.warn({ err }, "[maps] autocomplete provider error");
    return res.status(502).json({ error: "search_failed" });
  }
});

router.get("/maps/place/:id", requireUser, async (req, res) => {
  if (!checkBoth(req, "pd", 60, 120))
    return res.status(429).json({ error: "rate_limited" });
  const id = (req.params.id as string);
  if (!id) return res.status(400).json({ error: "invalid_input" });
  const session = typeof req.query.session === "string" ? req.query.session : undefined;
  const place = await placeDetails(id, session);
  if (!place) return res.status(404).json({ error: "not_found" });
  return res.json({ place });
});

router.get("/maps/reverse", requireUser, async (req, res) => {
  if (!checkBoth(req, "rg", 30, 60))
    return res.status(429).json({ error: "rate_limited" });
  const parsed = z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const out = await reverseGeocode(parsed.data.lat, parsed.data.lng);
  if (!out) return res.status(404).json({ error: "not_found" });
  return res.json({ result: out });
});

router.get("/maps/geocode", requireUser, async (req, res) => {
  if (!checkBoth(req, "fg", 30, 60))
    return res.status(429).json({ error: "rate_limited" });
  const parsed = z
    .object({ address: z.string().min(1).max(300) })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const out = await forwardGeocode(parsed.data.address);
  if (!out) return res.status(404).json({ error: "not_found" });
  return res.json({ result: out });
});

router.get("/maps/route", requireUser, async (req, res) => {
  if (!checkBoth(req, "rt", 60, 120))
    return res.status(429).json({ error: "rate_limited" });
  const parsed = z
    .object({
      fromLat: z.coerce.number().min(-90).max(90),
      fromLng: z.coerce.number().min(-180).max(180),
      toLat: z.coerce.number().min(-90).max(90),
      toLng: z.coerce.number().min(-180).max(180),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const out = await osrmRoute(
    { lat: parsed.data.fromLat, lng: parsed.data.fromLng },
    { lat: parsed.data.toLat, lng: parsed.data.toLng },
  );
  if (!out) return res.status(502).json({ error: "route_unavailable" });
  return res.json({ route: out });
});

export default router;
