import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordValidation {
  ok: boolean;
  reason?: "too_short" | "missing_letter" | "missing_number";
}

export function validatePasswordStrength(pw: string): PasswordValidation {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (!/[A-Za-z]/.test(pw)) return { ok: false, reason: "missing_letter" };
  if (!/\d/.test(pw)) return { ok: false, reason: "missing_number" };
  return { ok: true };
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}

const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCode(length = 7): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += REFERRAL_ALPHABET[Math.floor(Math.random() * REFERRAL_ALPHABET.length)];
  }
  return out;
}
