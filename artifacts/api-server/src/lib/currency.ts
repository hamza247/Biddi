import { db, currenciesTable, ridesTable, type Currency } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

/** USD is the canonical internal currency. All money flows through this. */
export const BASE_CURRENCY = "USD";

const CACHE_TTL_MS = 60_000;
let cache: { rows: Currency[]; at: number } | null = null;

export function invalidateCurrencyCache(): void {
  cache = null;
}

/** Loads all currencies (active + inactive). Cached for 60s. Fail-safe:
 * returns the previous cache (or [] if none) on DB errors. */
export async function getAllCurrencies(): Promise<Currency[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  try {
    const result = await db.select().from(currenciesTable);
    const rows = Array.isArray(result) ? (result as Currency[]) : [];
    cache = { rows, at: Date.now() };
    return rows;
  } catch (err) {
    logger.warn({ err }, "[currency] failed to load currencies; serving stale cache");
    return cache?.rows ?? [];
  }
}

/** Returns just the active currencies eligible for display. */
export async function getActiveCurrencies(): Promise<Currency[]> {
  return (await getAllCurrencies()).filter((c) => c.isActive);
}

export async function getCurrency(code: string): Promise<Currency | null> {
  const rows = await getAllCurrencies();
  const up = code.toUpperCase();
  return rows.find((c) => c.code === up) ?? null;
}

/** Convert an amount from USD to `targetCode`. Returns null when the
 * target currency is unknown, inactive, or has no rate yet.
 *
 * Internal helper: returns full IEEE-754 precision. Rounding is the
 * responsibility of the display boundary (`enrichAmount` /
 * `enrichFareBreakdown`) so that intermediate calculations don't
 * accumulate rounding error. */
export async function convertFromUSD(
  amountUsd: number,
  targetCode: string,
): Promise<number | null> {
  if (!Number.isFinite(amountUsd)) return null;
  const up = targetCode.toUpperCase();
  const target = await getCurrency(up);
  if (!target) {
    logger.warn({ targetCode: up }, "[currency] convertFromUSD: unknown currency");
    return null;
  }
  if (!target.isActive) {
    logger.warn({ targetCode: target.code }, "[currency] convertFromUSD: inactive currency");
    return null;
  }
  if (target.code === BASE_CURRENCY) return amountUsd;
  if (target.rateFromUsd == null || !Number.isFinite(target.rateFromUsd)) {
    logger.warn({ targetCode: target.code }, "[currency] convertFromUSD: rate missing");
    return null;
  }
  return amountUsd * target.rateFromUsd;
}

/** Convert between two arbitrary currencies via USD. Returns null when
 * either currency is unknown / inactive / missing a rate.
 *
 * Internal helper: returns full IEEE-754 precision (see convertFromUSD). */
export async function convertBetweenCurrencies(
  amount: number,
  fromCode: string,
  toCode: string,
): Promise<number | null> {
  if (!Number.isFinite(amount)) return null;
  const fromUp = fromCode.toUpperCase();
  const toUp = toCode.toUpperCase();
  const from = await getCurrency(fromUp);
  const to = await getCurrency(toUp);
  if (!from || !to) {
    logger.warn(
      { fromCode: fromUp, toCode: toUp, fromKnown: !!from, toKnown: !!to },
      "[currency] convertBetweenCurrencies: unknown currency, returning null",
    );
    return null;
  }
  if (!from.isActive || !to.isActive) {
    logger.warn(
      { fromCode: from.code, toCode: to.code, fromActive: from.isActive, toActive: to.isActive },
      "[currency] convertBetweenCurrencies: inactive currency, returning null",
    );
    return null;
  }
  if (from.code === to.code) return amount;
  if (from.code !== BASE_CURRENCY && (from.rateFromUsd == null || !Number.isFinite(from.rateFromUsd))) {
    logger.warn({ code: from.code }, "[currency] convertBetweenCurrencies: source rate missing, returning null");
    return null;
  }
  if (to.code !== BASE_CURRENCY && (to.rateFromUsd == null || !Number.isFinite(to.rateFromUsd))) {
    logger.warn({ code: to.code }, "[currency] convertBetweenCurrencies: target rate missing, returning null");
    return null;
  }
  const amountUsd = from.code === BASE_CURRENCY ? amount : amount / (from.rateFromUsd as number);
  const out = to.code === BASE_CURRENCY ? amountUsd : amountUsd * (to.rateFromUsd as number);
  return out;
}

/** Round to 2 decimals at the display boundary only. Internal math
 * stays in full precision. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DisplayAmount {
  /** Original amount in USD (the canonical internal currency). */
  amountUsd: number;
  /** Same amount converted into `displayCurrency`. Falls back to amountUsd
   * when conversion isn't possible (unknown rate / inactive currency). */
  displayAmount: number;
  /** ISO-4217 code of the display currency, e.g. "MAD". */
  displayCurrency: string;
  /** Symbol to render next to displayAmount, e.g. "$", "MAD", "€". */
  displaySymbol: string;
}

/** Builds the `{amountUsd, displayAmount, displayCurrency, displaySymbol}`
 * envelope used across fare/wallet/admin responses. Always returns a value
 * — falls back to USD when the requested display currency can't be resolved
 * so the client never sees an empty currency field. */
export async function enrichAmount(
  amountUsd: number | null | undefined,
  displayCurrencyCode: string,
): Promise<DisplayAmount> {
  const usd = Number.isFinite(amountUsd as number) ? round2(amountUsd as number) : 0;
  const target = await getCurrency(displayCurrencyCode);
  if (target && target.isActive && (target.code === BASE_CURRENCY || target.rateFromUsd != null)) {
    const display =
      target.code === BASE_CURRENCY
        ? usd
        : round2(usd * (target.rateFromUsd as number));
    return {
      amountUsd: usd,
      displayAmount: display,
      displayCurrency: target.code,
      displaySymbol: target.symbol,
    };
  }
  // Fallback: render in USD using the canonical row (always present).
  const usdRow = await getCurrency(BASE_CURRENCY);
  return {
    amountUsd: usd,
    displayAmount: usd,
    displayCurrency: BASE_CURRENCY,
    displaySymbol: usdRow?.symbol ?? "$",
  };
}

/** Builds a parallel FareBreakdown-shaped object whose numeric line items
 * have been converted from USD into the display currency. Non-numeric
 * fields (flags, names, reasons, currency) are passed through. The
 * envelope's `currency` is set to the resolved display currency and a
 * `displaySymbol` is attached for client rendering. */
export async function enrichFareBreakdown<T extends Record<string, unknown>>(
  breakdown: T | null | undefined,
  displayCurrencyCode: string,
): Promise<(T & { displaySymbol: string }) | null> {
  if (!breakdown) return null;
  const target = await getCurrency(displayCurrencyCode);
  const usdRow = await getCurrency(BASE_CURRENCY);
  const useTarget =
    target && target.isActive && (target.code === BASE_CURRENCY || target.rateFromUsd != null);
  const code = useTarget ? (target as Currency).code : BASE_CURRENCY;
  const symbol = useTarget ? (target as Currency).symbol : (usdRow?.symbol ?? "$");
  const rate =
    !useTarget || (target as Currency).code === BASE_CURRENCY
      ? 1
      : ((target as Currency).rateFromUsd as number);
  const numericFields = new Set([
    "base",
    "distance",
    "time",
    "peakSurcharge",
    "nightSurcharge",
    "subtotal",
    "minimumFare",
    "waitingFee",
    "total",
    "agreedBid",
    "weatherSurcharge",
    "airportPickupSurcharge",
    "airportDropoffSurcharge",
    "couponDiscount",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(breakdown)) {
    if (numericFields.has(key) && typeof value === "number") {
      out[key] = round2(value * rate);
    } else {
      out[key] = value;
    }
  }
  out.currency = code;
  return { ...(out as T), displaySymbol: symbol };
}

/** Pick the platform's effective display currency: the row exists and is
 * active. Falls back to USD when the configured one isn't usable. */
export async function resolveDisplayCurrency(configured: string): Promise<string> {
  const target = await getCurrency(configured);
  if (target && target.isActive) return target.code;
  return BASE_CURRENCY;
}

/** Returns true when the currency code is referenced anywhere that would
 * make deletion or code renames unsafe. Today the only place a currency
 * code is persisted alongside money is inside `rides.fare_breakdown`
 * (jsonb with a `currency` field). Wallet ledger entries, coupons and
 * payments don't carry a currency column — they're stored in canonical
 * USD — so a single JSONB check covers the spec's "fares, payments,
 * wallets, or transactions" guard. */
export async function isCurrencyInUse(code: string): Promise<boolean> {
  const up = code.toUpperCase();
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ridesTable)
      .where(sql`${ridesTable.fareBreakdown}->>'currency' = ${up}`);
    return (row?.n ?? 0) > 0;
  } catch (err) {
    // Fail-safe: treat as in-use on DB error so we don't accidentally
    // drop a currency that's actually referenced.
    logger.warn({ err, code: up }, "[currency] isCurrencyInUse check failed");
    return true;
  }
}

/** Marks a currency inactive. Refuses USD per the task spec. */
export async function setCurrencyActive(
  code: string,
  isActive: boolean,
): Promise<Currency | null> {
  const up = code.toUpperCase();
  if (up === BASE_CURRENCY && !isActive) {
    throw new Error("USD cannot be deactivated");
  }
  const [updated] = await db
    .update(currenciesTable)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(currenciesTable.code, up))
    .returning();
  invalidateCurrencyCache();
  return updated ?? null;
}
