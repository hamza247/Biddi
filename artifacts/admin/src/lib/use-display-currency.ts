import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

interface PublicConfig {
  displayCurrency?: string;
  displaySymbol?: string;
  displayRate?: number;
}

/** Mirrors the admin Currency row shape returned by `/admin/currencies`.
 * Used by `formatCurrency` to render a value with the formatting rules
 * the operator chose (decimals, separators, symbol position). */
export interface FormattableCurrency {
  code: string;
  symbol: string;
  decimalPlaces?: number;
  symbolPosition?: "before" | "after";
  thousandsSeparator?: "comma" | "dot" | "space";
  decimalSeparator?: "dot" | "comma";
}

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

/** Format a numeric amount using a currency's formatting rules. When
 * `currency` is null/undefined we fall back to plain `amount.toFixed(2)`
 * with no symbol so callers always render *something*. Accepts either a
 * full `FormattableCurrency` row (when the caller already has it from a
 * `/admin/currencies` response) or `undefined` for fallback formatting.
 * Use `useFormatCurrency()` when you only have a currency code. */
export function formatCurrency(
  amount: number | null | undefined,
  currency: FormattableCurrency | null | undefined,
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  if (!currency) return amount.toFixed(2);
  const decimals = currency.decimalPlaces ?? 2;
  const thousands = currency.thousandsSeparator ?? "comma";
  const decimal = currency.decimalSeparator ?? "dot";
  const position = currency.symbolPosition ?? "before";
  const body = applyFormatting(amount, decimals, thousands, decimal);
  return position === "before"
    ? `${currency.symbol}${body}`
    : `${body} ${currency.symbol}`;
}

interface AdminCurrenciesResponse {
  currencies: FormattableCurrency[];
  defaultCode: string;
}

/**
 * Returns a `(amount, code?) => string` formatter that looks the
 * currency up in the cached `/admin/currencies` list. When `code` is
 * omitted the platform default is used. Falls back to a plain
 * `amount.toFixed(2)` while the list is loading or if the code isn't
 * present, so callers always render something. The underlying query is
 * shared with the Currency Management tab so we never refetch.
 */
export function useFormatCurrency(): (
  amount: number | null | undefined,
  code?: string,
) => string {
  const { data } = useQuery({
    queryKey: ["/admin/currencies"],
    queryFn: () => api<AdminCurrenciesResponse>("/admin/currencies"),
    staleTime: 5 * 60 * 1000,
  });
  return (amount, code) => {
    if (amount == null || !Number.isFinite(amount)) return "—";
    if (!data) return amount.toFixed(2);
    const target = code ?? data.defaultCode;
    const found = data.currencies.find((c) => c.code === target);
    return formatCurrency(amount, found ?? null);
  };
}

export interface DisplayCurrency {
  code: string;
  symbol: string;
  /** USD→display rate (1 when display==USD or unknown). Use to convert a
   * value the operator typed in the display currency back to canonical USD
   * before posting to USD-based mutation endpoints. */
  rate: number;
}

const DEFAULT: DisplayCurrency = { code: "USD", symbol: "$", rate: 1 };

/**
 * Returns the platform's currently-configured display currency. Reads
 * `/config/public` (cached for 5 min in-app) so the value matches what
 * the rider/driver apps render. Falls back to USD/$ on error so the
 * admin never renders an empty symbol.
 */
export function useDisplayCurrency(): DisplayCurrency {
  const { data } = useQuery({
    queryKey: ["/config/public"],
    queryFn: () => api<PublicConfig>("/config/public"),
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return DEFAULT;
  return {
    code: data.displayCurrency ?? DEFAULT.code,
    symbol: data.displaySymbol ?? DEFAULT.symbol,
    rate:
      typeof data.displayRate === "number" && data.displayRate > 0
        ? data.displayRate
        : 1,
  };
}

/** Pure formatter — accepts a USD amount and a display envelope from the
 * server. When the envelope is present we trust it; otherwise we fall
 * back to rendering the raw USD value with the supplied symbol. */
export function formatDisplayAmount(
  envelope: { displayAmount: number; displaySymbol: string } | null | undefined,
  fallbackSymbol: string,
  fallbackAmount: number | null | undefined,
): string {
  if (envelope) {
    return `${envelope.displaySymbol}${envelope.displayAmount.toFixed(2)}`;
  }
  if (fallbackAmount == null || !Number.isFinite(fallbackAmount)) return "—";
  return `${fallbackSymbol}${fallbackAmount.toFixed(2)}`;
}
