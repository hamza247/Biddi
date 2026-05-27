import { Router, type IRouter } from "express";
import { db, usersTable, otpCodesTable } from "@workspace/db";
import { eq, and, gt, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { signUserToken } from "../lib/auth";
import { generateOtpForPhone, sendOtpSms } from "../lib/sms";
import { getConfig } from "../lib/settings";
import { toPublicUser } from "../lib/serializers";
import { getDriverRates } from "../lib/driverStats";
import { requireUser } from "../middlewares/auth";
import { checkLimit } from "../lib/rateLimit";
import {
  generateReferralCode,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "../lib/passwords";

const router: IRouter = Router();

const rawPhoneSchema = z
  .string()
  .min(8)
  .max(20)
  .regex(/^\+?\d[\d\s\-()]*$/, "invalid_phone");

// E.164-normalize a user-typed phone using a default country prefix for
// 10-digit (US) or 9-digit (Morocco) local numbers without a leading "+".
export function normalizePhone(input: string, defaultPrefix: string): string {
  const digits = input.replace(/\D/g, "");
  if (input.trim().startsWith("+")) return `+${digits}`;
  if (defaultPrefix && digits.startsWith(defaultPrefix)) return `+${digits}`;
  if (digits.startsWith("0")) return `+${defaultPrefix}${digits.slice(1)}`;
  if (digits.length === 10 || digits.length === 9) return `+${defaultPrefix}${digits}`;
  return `+${digits}`;
}

const E164_RE = /^\+\d{7,15}$/;

export function normalizeAndValidatePhone(
  input: string,
  defaultPrefix: string,
): string | null {
  const phone = normalizePhone(input, defaultPrefix);
  return E164_RE.test(phone) ? phone : null;
}

async function defaultPrefixForMode(): Promise<string> {
  const cfg = await getConfig();
  if (cfg.smsMode === "moroccansms") return (cfg.moroccansmsPrefix || "212").replace(/\D/g, "");
  return "1";
}

const phoneSchema = rawPhoneSchema;

const emailSchema = z.string().trim().toLowerCase().email().max(120);

/** Generate a unique referral code by retrying on collision. */
async function newUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateReferralCode(7);
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, code))
      .limit(1);
    if (!existing) return code;
  }
  // Extremely unlikely; fall back to a longer code.
  return generateReferralCode(10);
}

router.post("/auth/check-phone", async (req, res) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_phone" });
  const phone = normalizeAndValidatePhone(parsed.data.phone, await defaultPrefixForMode());
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  const ip = req.ip || "unknown";
  const limit = checkLimit(`check:ip:${ip}`, 30, 10 * 60_000);
  if (!limit.ok) return res.status(429).json({ error: "too_many_requests" });
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  return res.json({ exists: !!user, phone });
});

router.post("/auth/check-email", async (req, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_email" });
  const email = parsed.data.email;
  const ip = req.ip || "unknown";
  const limit = checkLimit(`check-email:ip:${ip}`, 30, 10 * 60_000);
  if (!limit.ok) return res.status(429).json({ error: "too_many_requests" });
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${email}`)
    .limit(1);
  return res.json({ exists: !!user, email });
});

router.post("/auth/request-otp", async (req, res) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_phone" });
  const phone = normalizeAndValidatePhone(parsed.data.phone, await defaultPrefixForMode());
  if (!phone) return res.status(400).json({ error: "invalid_phone" });

  const ip = req.ip || "unknown";
  const phoneLimit = checkLimit(`otp:req:phone:${phone}`, 5, 10 * 60_000);
  const ipLimit = checkLimit(`otp:req:ip:${ip}`, 20, 10 * 60_000);
  if (!phoneLimit.ok || !ipLimit.ok) {
    const retry = Math.max(phoneLimit.retryAfterMs, ipLimit.retryAfterMs);
    res.setHeader("retry-after", Math.ceil(retry / 1000).toString());
    return res.status(429).json({ error: "too_many_requests" });
  }

  const { code, reveal, mode } = await generateOtpForPhone(phone);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(otpCodesTable).values({ phone, code, expiresAt });
  await sendOtpSms(phone, code, mode);

  return res.json({
    sent: true,
    phone,
    devCode: reveal ? code : null,
  });
});

router.post("/auth/verify-otp", async (req, res) => {
  const parsed = z
    .object({
      phone: phoneSchema,
      code: z.string().regex(/^\d{4,8}$/),
      firstName: z.string().trim().min(1).max(40).optional(),
      countryCode: z.string().trim().min(2).max(6).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { code, firstName, countryCode } = parsed.data;
  const phone = normalizeAndValidatePhone(parsed.data.phone, await defaultPrefixForMode());
  if (!phone) return res.status(400).json({ error: "invalid_phone" });

  const ip = req.ip || "unknown";
  const verifyPhone = checkLimit(`otp:verify:phone:${phone}`, 10, 10 * 60_000);
  const verifyIp = checkLimit(`otp:verify:ip:${ip}`, 30, 10 * 60_000);
  if (!verifyPhone.ok || !verifyIp.ok) {
    return res.status(429).json({ error: "too_many_attempts" });
  }

  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.code, code),
        gt(otpCodesTable.expiresAt, new Date()),
        isNull(otpCodesTable.consumedAt),
      ),
    )
    .orderBy(desc(otpCodesTable.createdAt))
    .limit(1);

  if (!otp) return res.status(401).json({ error: "invalid_or_expired_code" });

  await db
    .update(otpCodesTable)
    .set({ consumedAt: new Date() })
    .where(eq(otpCodesTable.id, otp.id));

  let [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (!user) {
    const referralCode = await newUniqueReferralCode();
    [user] = await db
      .insert(usersTable)
      .values({
        phone,
        countryCode: countryCode ?? "+1",
        firstName: firstName ?? "",
        lastName: "",
        phoneVerified: true,
        referralCode,
      })
      .returning();
  } else {
    const patch: Record<string, unknown> = {};
    if (firstName && !user.firstName) patch.firstName = firstName;
    if (!user.referralCode) patch.referralCode = await newUniqueReferralCode();
    if (!user.phoneVerified) patch.phoneVerified = true;
    if (Object.keys(patch).length > 0) {
      [user] = await db
        .update(usersTable)
        .set(patch)
        .where(eq(usersTable.id, user.id))
        .returning();
    }
  }

  const token = signUserToken(user.id);
  // Returning hasPassword/email lets the client prompt legacy users to
  // finish their profile right after a phone OTP login.
  return res.json({
    token,
    user: toPublicUser(user),
    needsProfileCompletion: !user.email || !user.password,
  });
});

// Web password-reset flow: the user provides phone + a fresh OTP code (issued
// via /auth/request-otp) plus a new password. We verify the code in the same
// way as /auth/verify-otp, then update the password hash.
router.post("/auth/reset-password", async (req, res) => {
  const parsed = z
    .object({
      phone: phoneSchema,
      code: z.string().regex(/^\d{4,8}$/),
      password: z.string().min(1).max(200),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const phone = normalizeAndValidatePhone(parsed.data.phone, await defaultPrefixForMode());
  if (!phone) return res.status(400).json({ error: "invalid_phone" });

  const ip = req.ip || "unknown";
  const verifyPhone = checkLimit(`reset:verify:phone:${phone}`, 10, 10 * 60_000);
  const verifyIp = checkLimit(`reset:verify:ip:${ip}`, 30, 10 * 60_000);
  if (!verifyPhone.ok || !verifyIp.ok) {
    return res.status(429).json({ error: "too_many_attempts" });
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) return res.status(400).json({ error: "weak_password", reason: strength.reason });

  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.code, parsed.data.code),
        gt(otpCodesTable.expiresAt, new Date()),
        isNull(otpCodesTable.consumedAt),
      ),
    )
    .orderBy(desc(otpCodesTable.createdAt))
    .limit(1);
  if (!otp) return res.status(401).json({ error: "invalid_or_expired_code" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (!user) return res.status(404).json({ error: "user_not_found" });

  await db.update(otpCodesTable).set({ consumedAt: new Date() }).where(eq(otpCodesTable.id, otp.id));
  const passwordHash = await hashPassword(parsed.data.password);
  const [updated] = await db
    .update(usersTable)
    .set({ password: passwordHash, phoneVerified: true })
    .where(eq(usersTable.id, user.id))
    .returning();

  const token = signUserToken(updated.id);
  return res.json({ token, user: toPublicUser(updated) });
});

router.post("/auth/login", async (req, res) => {
  const parsed = z
    .object({
      email: emailSchema,
      password: z.string().min(1).max(200),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const ip = req.ip || "unknown";
  const ipLimit = checkLimit(`login:ip:${ip}`, 20, 10 * 60_000);
  const emailLimit = checkLimit(`login:email:${parsed.data.email}`, 10, 10 * 60_000);
  if (!ipLimit.ok || !emailLimit.ok) {
    const retry = Math.max(ipLimit.retryAfterMs, emailLimit.retryAfterMs);
    res.setHeader("retry-after", Math.ceil(retry / 1000).toString());
    return res.status(429).json({ error: "too_many_attempts" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${parsed.data.email}`)
    .limit(1);

  if (!user || !user.password) {
    return res.status(401).json({ error: "bad_credentials" });
  }
  const ok = await verifyPassword(parsed.data.password, user.password);
  if (!ok) return res.status(401).json({ error: "bad_credentials" });

  const token = signUserToken(user.id);
  return res.json({ token, user: toPublicUser(user) });
});

router.post("/auth/complete-profile", requireUser, async (req, res) => {
  const parsed = z
    .object({
      firstName: z.string().trim().min(1).max(40),
      lastName: z.string().trim().max(40).optional().default(""),
      email: emailSchema,
      password: z.string().min(1).max(200),
      referredByCode: z.string().trim().min(3).max(20).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const { firstName, lastName, email, password, referredByCode } = parsed.data;

  const strength = validatePasswordStrength(password);
  if (!strength.ok) return res.status(400).json({ error: "weak_password", reason: strength.reason });

  // Email uniqueness — case-insensitive, exclude the current user.
  const [emailOwner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${email}`)
    .limit(1);
  if (emailOwner && emailOwner.id !== req.userId) {
    return res.status(409).json({ error: "email_taken" });
  }

  let normalizedReferral: string | null = null;
  if (referredByCode) {
    const code = referredByCode.toUpperCase();
    const [refOwner] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, code))
      .limit(1);
    if (!refOwner) return res.status(400).json({ error: "invalid_referral" });
    if (refOwner.id === req.userId) return res.status(400).json({ error: "invalid_referral" });
    const { wouldCreateReferralCycle } = await import("../services/referrals");
    if (await wouldCreateReferralCycle(req.userId!, refOwner.id)) {
      return res.status(400).json({ error: "invalid_referral" });
    }
    normalizedReferral = code;
  }

  const passwordHash = await hashPassword(password);

  const [updated] = await db
    .update(usersTable)
    .set({
      firstName,
      lastName,
      email,
      password: passwordHash,
      ...(normalizedReferral ? { referredByCode: normalizedReferral } : {}),
    })
    .where(eq(usersTable.id, req.userId!))
    .returning();

  if (!updated) return res.status(404).json({ error: "user_not_found" });
  return res.json({ user: toPublicUser(updated) });
});

router.get("/auth/me", requireUser, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  const rates = await getDriverRates(user.id);
  return res.json({
    user: {
      ...toPublicUser(user),
      acceptanceRate: rates.acceptanceRate,
      cancellationRate: rates.cancellationRate,
    },
  });
});

export default router;
