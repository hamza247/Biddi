import { db, currenciesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";
import { invalidateCurrencyCache, BASE_CURRENCY } from "../lib/currency";

/** Refresh cadence — once per 24h per the task spec. */
export const CURRENCY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Rates older than this are considered stale and trigger a refresh on
 * startup. Mirrors the refresh interval so a missed refresh window
 * triggers a catch-up fetch on the next boot. */
export const CURRENCY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const DEFAULT_RATES_URL = "https://open.er-api.com/v6/latest/USD";

/** FX source URL. Defaults to open.er-api.com but can be overridden via
 * `CURRENCY_RATES_URL` so failure paths can be exercised in tests / staging. */
function getRatesUrl(): string {
  return process.env.CURRENCY_RATES_URL || DEFAULT_RATES_URL;
}

const ratesResponseSchema = z.object({
  result: z.string(),
  base_code: z.string().optional(),
  rates: z.record(z.string(), z.number()).optional(),
  time_last_update_unix: z.number().optional(),
  "error-type": z.string().optional(),
});

export type FetchRatesResult =
  | {
      ok: true;
      base: string;
      rates: Record<string, number>;
      fetchedAt: Date;
    }
  | {
      ok: false;
      error:
        | "fetch_failed"
        | "http_error"
        | "invalid_json"
        | "schema_invalid"
        | "upstream_error";
      detail?: string;
      status?: number;
    };

/**
 * Performs the network call + Zod validation in isolation so it can be
 * unit-tested independently of the DB write loop. Always resolves —
 * never throws — so the caller can implement fail-safe behaviour.
 */
export async function fetchRates(): Promise<FetchRatesResult> {
  let res: Response;
  try {
    res = await fetch(getRatesUrl(), {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    logger.warn({ err }, "[currency] fetch failed; keeping prior rates");
    return { ok: false, error: "fetch_failed", detail: String(err) };
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "[currency] non-2xx; keeping prior rates");
    return { ok: false, error: "http_error", status: res.status };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    logger.warn({ err }, "[currency] invalid JSON; keeping prior rates");
    return { ok: false, error: "invalid_json", detail: String(err) };
  }
  const parsed = ratesResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "[currency] schema invalid; keeping prior rates");
    return { ok: false, error: "schema_invalid", detail: parsed.error.message };
  }
  const payload = parsed.data;
  if (payload.result !== "success" || !payload.rates) {
    logger.warn(
      { result: payload.result, errorType: payload["error-type"] },
      "[currency] upstream reported error; keeping prior rates",
    );
    return { ok: false, error: "upstream_error", detail: payload["error-type"] ?? payload.result };
  }
  const fetchedAt = payload.time_last_update_unix
    ? new Date(payload.time_last_update_unix * 1000)
    : new Date();
  return { ok: true, base: payload.base_code ?? BASE_CURRENCY, rates: payload.rates, fetchedAt };
}

/**
 * Refreshes every existing row in `currencies` whose code is present in
 * the upstream payload. USD itself is pinned at 1 and always refreshed
 * so its lastUpdatedAt timestamp moves forward.
 *
 * Fail-safe by design: a network failure, non-2xx response, or malformed
 * payload leaves the existing rows untouched (so prior rates keep
 * serving traffic). Returns the count of rows actually updated.
 *
 * Additionally logs a structured warning for every active DB currency
 * whose code is missing from the upstream payload — operators see this
 * in the logs and can investigate (e.g. a delisted currency code) even
 * though the system continues to serve the last-known rate.
 */
export async function refreshCurrencyRates(): Promise<{
  updated: number;
  fetchedAt: Date | null;
  error?: string;
}> {
  const fetched = await fetchRates();
  if (!fetched.ok) {
    return { updated: 0, fetchedAt: null, error: fetched.error };
  }
  const { rates, fetchedAt } = fetched;

  // Update each existing row whose code appears in the response. We don't
  // auto-insert unknown codes — operators add new currencies via the
  // admin UI / seed.
  let existing: Array<{ code: string; isActive: boolean }>;
  try {
    existing = await db
      .select({ code: currenciesTable.code, isActive: currenciesTable.isActive })
      .from(currenciesTable);
  } catch (err) {
    logger.error({ err }, "[currency] failed to enumerate currencies");
    return { updated: 0, fetchedAt: null, error: "db_read_failed" };
  }

  const missingActive: string[] = [];
  let updated = 0;
  for (const row of existing) {
    // Only refresh active currencies (USD always counts because it is the
    // canonical base and we want its lastUpdatedAt to advance). Inactive
    // rows keep their last-known rate untouched.
    if (!row.isActive && row.code !== BASE_CURRENCY) continue;
    const rate = row.code === BASE_CURRENCY ? 1 : rates[row.code];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      if (row.isActive && row.code !== BASE_CURRENCY) missingActive.push(row.code);
      continue;
    }
    try {
      await db
        .update(currenciesTable)
        .set({
          rateFromUsd: rate,
          lastUpdatedAt: fetchedAt,
          updatedAt: new Date(),
        })
        .where(eq(currenciesTable.code, row.code));
      updated++;
    } catch (err) {
      logger.warn({ err, code: row.code }, "[currency] failed to update rate");
    }
  }

  if (missingActive.length > 0) {
    logger.warn(
      { missing: missingActive },
      "[currency] active currencies missing from upstream payload — keeping last-known rate",
    );
  }

  invalidateCurrencyCache();
  logger.info({ updated, fetchedAt }, "[currency] rates refreshed");
  return { updated, fetchedAt };
}

/** Returns true if any non-USD active currency has no rate or its rate
 * is older than CURRENCY_STALE_AFTER_MS. USD is excluded because it is
 * always pinned at 1. */
export async function ratesAreStale(): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - CURRENCY_STALE_AFTER_MS);
    const rows = await db
      .select({
        code: currenciesTable.code,
        rateFromUsd: currenciesTable.rateFromUsd,
        lastUpdatedAt: currenciesTable.lastUpdatedAt,
        isActive: currenciesTable.isActive,
      })
      .from(currenciesTable)
      .where(sql`${currenciesTable.code} <> ${BASE_CURRENCY}`);
    if (rows.length === 0) return false;
    for (const r of rows) {
      if (!r.isActive) continue;
      if (r.rateFromUsd == null) return true;
      if (!r.lastUpdatedAt || r.lastUpdatedAt < cutoff) return true;
    }
    return false;
  } catch (err) {
    logger.warn({ err }, "[currency] staleness check failed; assuming fresh");
    return false;
  }
}

/** Schedules the daily refresh loop. Refreshes immediately if rates are
 * stale (or missing) and then once every 24h. Wrapped in try/catch so a
 * failure never crashes the server. */
export function startCurrencyScheduler(): void {
  void (async () => {
    try {
      if (await ratesAreStale()) {
        await refreshCurrencyRates();
      } else {
        logger.info("[currency] rates fresh — skipping startup refresh");
      }
    } catch (err) {
      logger.error({ err }, "[currency] startup refresh failed");
    }
  })();
  setInterval(() => {
    void refreshCurrencyRates().catch((err) => {
      logger.error({ err }, "[currency] scheduled refresh failed");
    });
  }, CURRENCY_REFRESH_INTERVAL_MS);
  logger.info(
    { intervalMs: CURRENCY_REFRESH_INTERVAL_MS },
    "[currency] daily refresh scheduled",
  );
}
