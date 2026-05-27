import { and, eq, sql } from "drizzle-orm";
import {
  db,
  couponsTable,
  couponRedemptionsTable,
  ridesTable,
  usersTable,
  type Coupon,
} from "@workspace/db";

/** Discrete failure reasons surfaced to the rider when a coupon can't apply.
 * The rider UI maps each code to a localized message; the admin API returns
 * the same set so coupon configuration mistakes are debuggable. */
export type CouponInvalidCode =
  | "not_found"
  | "inactive"
  | "expired"
  | "not_yet_valid"
  | "minimum_not_met"
  | "first_ride_only_violation"
  | "invalid_country"
  | "invalid_vehicle_type"
  | "limit_reached"
  | "per_user_limit_reached";

export interface CouponValidationResult {
  ok: true;
  coupon: Coupon;
  /** Discount amount (in fare currency) the coupon would apply to the given
   * subtotal. Already capped by the coupon's maxDiscount and floored at 0. */
  discount: number;
}

export interface CouponValidationFailure {
  ok: false;
  code: CouponInvalidCode;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Computes the discount a coupon would produce against a given subtotal.
 * Capped by the coupon's maxDiscount and the subtotal itself so a coupon can
 * never make a trip negative. */
export function computeCouponDiscount(coupon: Coupon, subtotal: number): number {
  if (subtotal <= 0) return 0;
  let raw = 0;
  if (coupon.discountType === "percentage") {
    raw = subtotal * (coupon.discountValue / 100);
  } else {
    raw = coupon.discountValue;
  }
  if (coupon.maxDiscount != null && raw > coupon.maxDiscount) {
    raw = coupon.maxDiscount;
  }
  if (raw > subtotal) raw = subtotal;
  if (raw < 0) raw = 0;
  return round2(raw);
}

interface ValidateInput {
  /** Coupon to validate. Pass null to short-circuit with not_found. */
  coupon: Coupon | null;
  /** Rider applying the coupon. */
  riderId: string;
  /** Rider's country code (e.g. "+212"), used for country-eligibility check. */
  riderCountryCode: string | null;
  /** Selected vehicle type at request time, used for category eligibility. */
  vehicleTypeId: string | null;
  /** Estimated trip subtotal used for the minimum-amount check and to
   * compute the projected discount returned in the success result. */
  estimatedSubtotal: number;
  /** Evaluation moment — defaults to now. */
  at?: Date;
}

/** Validates a coupon against rider/trip context and returns either the
 * projected discount or a typed failure reason. Per-user and global usage
 * caps are checked here for the apply-time UX, but the authoritative re-check
 * happens inside the completion transaction so concurrent completions can't
 * exceed the configured caps. */
export async function validateCoupon(
  input: ValidateInput,
): Promise<CouponValidationResult | CouponValidationFailure> {
  const { coupon, riderId, riderCountryCode, vehicleTypeId, estimatedSubtotal } = input;
  const at = input.at ?? new Date();

  if (!coupon) return { ok: false, code: "not_found" };
  if (!coupon.active) return { ok: false, code: "inactive" };
  if (coupon.validFrom && at < coupon.validFrom) return { ok: false, code: "not_yet_valid" };
  if (coupon.validUntil && at > coupon.validUntil) return { ok: false, code: "expired" };

  if (coupon.minTripAmount != null && estimatedSubtotal < coupon.minTripAmount) {
    return { ok: false, code: "minimum_not_met" };
  }

  if (coupon.countryCodes && coupon.countryCodes.length > 0) {
    if (!riderCountryCode || !coupon.countryCodes.includes(riderCountryCode)) {
      return { ok: false, code: "invalid_country" };
    }
  }

  if (coupon.vehicleTypeIds && coupon.vehicleTypeIds.length > 0) {
    if (!vehicleTypeId || !coupon.vehicleTypeIds.includes(vehicleTypeId)) {
      return { ok: false, code: "invalid_vehicle_type" };
    }
  }

  if (coupon.firstRideOnly) {
    const [{ value } = { value: 0 }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(ridesTable)
      .where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed")));
    if (Number(value) > 0) {
      return { ok: false, code: "first_ride_only_violation" };
    }
  }

  if (coupon.usageLimitTotal != null && coupon.totalUsed >= coupon.usageLimitTotal) {
    return { ok: false, code: "limit_reached" };
  }

  if (coupon.usageLimitPerUser != null) {
    const [{ value } = { value: 0 }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(couponRedemptionsTable)
      .where(
        and(
          eq(couponRedemptionsTable.couponId, coupon.id),
          eq(couponRedemptionsTable.userId, riderId),
        ),
      );
    if (Number(value) >= coupon.usageLimitPerUser) {
      return { ok: false, code: "per_user_limit_reached" };
    }
  }

  return {
    ok: true,
    coupon,
    discount: computeCouponDiscount(coupon, estimatedSubtotal),
  };
}

/** Loads a coupon by case-insensitive code match. */
export async function loadCouponByCode(code: string): Promise<Coupon | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const [row] = await db
    .select()
    .from(couponsTable)
    .where(sql`lower(${couponsTable.code}) = lower(${trimmed})`)
    .limit(1);
  return row ?? null;
}

/** Loads the rider's country code for coupon eligibility checks. */
export async function loadRiderCountryCode(riderId: string): Promise<string | null> {
  const [row] = await db
    .select({ countryCode: usersTable.countryCode })
    .from(usersTable)
    .where(eq(usersTable.id, riderId))
    .limit(1);
  return row?.countryCode ?? null;
}
