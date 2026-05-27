import { getConfig } from "./settings";
import { logger } from "./logger";
import { enrichAmount, resolveDisplayCurrency, type DisplayAmount } from "./currency";

/** Returns the platform's effective display-currency code (one DB read,
 * cached behind getConfig + the currency cache). Fail-safe: any settings
 * read failure falls back to USD so monetary responses never crash the
 * route — display formatting must never be load-bearing. */
export async function getDisplayCurrencyCode(): Promise<string> {
  try {
    const cfg = await getConfig();
    return resolveDisplayCurrency(cfg.displayCurrency);
  } catch (err) {
    logger.warn(
      { err },
      "[displayAmount] failed to resolve display currency; falling back to USD",
    );
    return "USD";
  }
}

/** Convenience helper used by routes — given an amount in USD, returns
 * the {amountUsd, displayAmount, displayCurrency, displaySymbol} envelope
 * for the platform's currently-configured display currency. */
export async function enrichWithPlatformCurrency(
  amountUsd: number | null | undefined,
): Promise<DisplayAmount> {
  const code = await getDisplayCurrencyCode();
  return enrichAmount(amountUsd, code);
}

/** Bulk variant — resolves the display currency once and enriches every
 * amount in the batch. Use this when serialising lists. */
export async function bulkEnrichWithPlatformCurrency(
  amountsUsd: Array<number | null | undefined>,
): Promise<DisplayAmount[]> {
  const code = await getDisplayCurrencyCode();
  return Promise.all(amountsUsd.map((a) => enrichAmount(a, code)));
}

export type { DisplayAmount };
