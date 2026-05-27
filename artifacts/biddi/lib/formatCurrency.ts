import type { PublicConfig } from "./config";

/** Mirror of `formatCurrency` in `artifacts/admin/src/lib/use-display-currency.ts`,
 * but reads its formatting rules off the rider/driver app's `PublicConfig`
 * (populated from `/config/public`). Keeping the algorithm aligned with the
 * admin's helper guarantees riders, drivers and operators see identical
 * formatting for the same configured currency. */

const SEPARATOR_CHAR = { comma: ",", dot: ".", space: " " } as const;

function applyFormatting(
  amount: number,
  decimals: number,
  thousands: "comma" | "dot" | "space",
  decimal: "dot" | "comma",
): string {
  if (!Number.isFinite(amount)) return "—";
  const fixed = Math.abs(amount).toFixed(decimals);
  const [intPart, fracPart] = fixed.split(".");
  const thousandsChar = SEPARATOR_CHAR[thousands];
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsChar);
  const decimalChar = SEPARATOR_CHAR[decimal];
  const body = fracPart ? `${grouped}${decimalChar}${fracPart}` : grouped;
  return amount < 0 ? `-${body}` : body;
}

/** Pick the formatting rules out of a `PublicConfig`, with safe defaults
 * so older API servers (that haven't shipped the formatting fields yet)
 * still produce sensible output. */
function rules(cfg: Pick<
  PublicConfig,
  | "displaySymbol"
  | "displayDecimalPlaces"
  | "displaySymbolPosition"
  | "displayThousandsSeparator"
  | "displayDecimalSeparator"
>) {
  return {
    symbol: cfg.displaySymbol,
    decimals: cfg.displayDecimalPlaces ?? 2,
    position: cfg.displaySymbolPosition ?? "before",
    thousands: cfg.displayThousandsSeparator ?? "comma",
    decimal: cfg.displayDecimalSeparator ?? "dot",
  } as const;
}

/** Format a number that is *already* in the platform's display currency
 * (typically the `displayAmount` from a server-converted envelope, or a
 * value the user just typed in display currency). Returns "—" when the
 * value isn't finite so the caller never has to special-case nullish. */
export function formatDisplayAmount(
  amount: number | null | undefined,
  cfg: Pick<
    PublicConfig,
    | "displaySymbol"
    | "displayDecimalPlaces"
    | "displaySymbolPosition"
    | "displayThousandsSeparator"
    | "displayDecimalSeparator"
  >,
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const r = rules(cfg);
  const body = applyFormatting(amount, r.decimals, r.thousands, r.decimal);
  return r.position === "before" ? `${r.symbol}${body}` : `${body} ${r.symbol}`;
}

/** Format a USD amount: convert to the configured display currency using
 * `cfg.displayRate` (1 when the rate is unknown or display==USD) then
 * apply the operator's formatting rules. Use this for screens that only
 * have raw USD numbers (driver earnings/quests/wallet history pre-envelope). */
export function formatUsdAmount(
  amountUsd: number | null | undefined,
  cfg: PublicConfig,
): string {
  if (amountUsd == null || !Number.isFinite(amountUsd)) return "—";
  const rate = cfg.displayRate > 0 ? cfg.displayRate : 1;
  return formatDisplayAmount(amountUsd * rate, cfg);
}
