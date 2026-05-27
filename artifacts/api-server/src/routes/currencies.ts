import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, currenciesTable, settingsTable, type Currency } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
import {
  getAllCurrencies,
  setCurrencyActive,
  invalidateCurrencyCache,
  isCurrencyInUse,
  BASE_CURRENCY,
} from "../lib/currency";
import { refreshCurrencyRates } from "../services/currencyService";
import { getConfig, invalidateConfigCache } from "../lib/settings";

const router: IRouter = Router();

interface SerializedCurrency {
  code: string;
  name: string;
  symbol: string;
  rateFromUsd: number | null;
  lastUpdatedAt: string | null;
  isActive: boolean;
  isDefault: boolean;
  decimalPlaces: number;
  symbolPosition: "before" | "after";
  thousandsSeparator: "comma" | "dot" | "space";
  decimalSeparator: "dot" | "comma";
  sortOrder: number;
}

/** Serializes a Currency row into the JSON shape the admin UI consumes.
 * `defaultCode` is the currently-configured `app_settings.displayCurrency`
 * — we derive `isDefault` at the API boundary so we don't need an
 * `is_default` column on the table. */
function serialize(c: Currency, defaultCode: string): SerializedCurrency {
  return {
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    rateFromUsd: c.rateFromUsd,
    lastUpdatedAt: c.lastUpdatedAt ? c.lastUpdatedAt.toISOString() : null,
    isActive: c.isActive,
    isDefault: c.code === defaultCode,
    decimalPlaces: c.decimalPlaces,
    symbolPosition: c.symbolPosition as "before" | "after",
    thousandsSeparator: c.thousandsSeparator as "comma" | "dot" | "space",
    decimalSeparator: c.decimalSeparator as "dot" | "comma",
    sortOrder: c.sortOrder,
  };
}

/** Operator-controlled ordering: lower `sortOrder` first, then USD pinned
 * before other ties, then alphabetical by code. The legacy USD-first +
 * alpha rule is the tiebreaker so freshly-seeded rows (all sortOrder=0)
 * still produce the historical ordering until an admin reorders. */
function sortCurrencies(rows: Currency[]): Currency[] {
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.code === BASE_CURRENCY) return -1;
    if (b.code === BASE_CURRENCY) return 1;
    return a.code.localeCompare(b.code);
  });
}

async function getDefaultCode(): Promise<string> {
  const cfg = await getConfig();
  return cfg.displayCurrency || BASE_CURRENCY;
}

/** Atomically updates `app_settings.displayCurrency` and invalidates the
 * settings + currency caches so the next public-config read returns the
 * new default. Mirrors the upsert in `setConfig` but stays in one place
 * so we can run it inside a transaction with the currency check. */
async function persistDefaultCurrency(code: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(settingsTable)
      .values({ key: "displayCurrency", value: code, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: code, updatedAt: new Date() },
      });
  });
  invalidateConfigCache();
  invalidateCurrencyCache();
}

const codeRegex = /^[A-Z]{3}$/;

const formattingSchema = z.object({
  decimalPlaces: z.number().int().min(0).max(4).optional(),
  symbolPosition: z.enum(["before", "after"]).optional(),
  thousandsSeparator: z.enum(["comma", "dot", "space"]).optional(),
  decimalSeparator: z.enum(["dot", "comma"]).optional(),
});

const createSchema = formattingSchema.extend({
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(codeRegex, "Code must be exactly 3 uppercase letters")),
  name: z.string().trim().min(1).max(64),
  symbol: z.string().trim().min(1).max(8),
  rateFromUsd: z.number().positive().finite(),
  isActive: z.boolean().optional(),
});

const patchSchema = formattingSchema.extend({
  isActive: z.boolean().optional(),
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(codeRegex, "Code must be exactly 3 uppercase letters"))
    .optional(),
  name: z.string().trim().min(1).max(64).optional(),
  symbol: z.string().trim().min(1).max(8).optional(),
  rateFromUsd: z.number().positive().finite().optional(),
});

/** GET /api/admin/currencies — list every seeded currency, USD first then
 * alphabetical. The admin Settings → Currency Management page renders this. */
router.get("/admin/currencies", requireAdmin, async (_req, res) => {
  const [rows, defaultCode] = await Promise.all([getAllCurrencies(), getDefaultCode()]);
  res.json({
    currencies: sortCurrencies(rows).map((c) => serialize(c, defaultCode)),
    defaultCode,
  });
});

/** GET /api/admin/currencies/:code — single row, plus a derived
 * `isCodeLocked` flag so the admin Edit modal can lock the code field
 * when the currency is referenced by existing rides. */
router.get(
  "/admin/currencies/:code",
  requireAdmin,
  async (req, res): Promise<void> => {
    const code = String((req.params.code as string) ?? "").toUpperCase();
    const [rows, defaultCode] = await Promise.all([
      getAllCurrencies(),
      getDefaultCode(),
    ]);
    const row = rows.find((c) => c.code === code);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const isCodeLocked =
      code === BASE_CURRENCY ||
      code === defaultCode ||
      (await isCurrencyInUse(code));
    res.json({ currency: serialize(row, defaultCode), isCodeLocked });
  },
);

/** POST /api/admin/currencies — create a brand-new currency row. */
router.post("/admin/currencies", requireAdmin, async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  if (body.code === BASE_CURRENCY) {
    res.status(409).json({
      error: "code_already_exists",
      message: "USD is the canonical base currency and is always present.",
    });
    return;
  }
  const existing = await getAllCurrencies();
  if (existing.some((c) => c.code === body.code)) {
    res.status(409).json({
      error: "code_already_exists",
      message: `Currency ${body.code} already exists.`,
    });
    return;
  }
  try {
    const [inserted] = await db
      .insert(currenciesTable)
      .values({
        code: body.code,
        name: body.name,
        symbol: body.symbol,
        rateFromUsd: body.rateFromUsd,
        lastUpdatedAt: new Date(),
        isActive: body.isActive ?? true,
        decimalPlaces: body.decimalPlaces ?? 2,
        symbolPosition: body.symbolPosition ?? "before",
        thousandsSeparator: body.thousandsSeparator ?? "comma",
        decimalSeparator: body.decimalSeparator ?? "dot",
      })
      .returning();
    invalidateCurrencyCache();
    const defaultCode = await getDefaultCode();
    req.log.info({ code: body.code }, "[admin] created currency");
    // A freshly-created row is never the default and never referenced
    // yet, so isCodeLocked is always false. We include it so the
    // response matches the AdminCurrencySingleResponse contract.
    res.status(201).json({
      currency: serialize(inserted, defaultCode),
      isCodeLocked: false,
    });
  } catch (err) {
    req.log.error({ err, code: body.code }, "[admin] failed to create currency");
    res.status(500).json({ error: "server_error" });
  }
});

/** PATCH /api/admin/currencies/:code — toggle active, rename / re-symbol,
 * change formatting, or update the rate. USD cannot be deactivated and
 * its rate is pinned at 1. The current default cannot be deactivated. */
router.patch("/admin/currencies/:code", requireAdmin, async (req, res): Promise<void> => {
  const code = String((req.params.code as string) ?? "").toUpperCase();
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "no_updates" });
    return;
  }

  if (code === BASE_CURRENCY && body.isActive === false) {
    res.status(400).json({
      error: "usd_cannot_be_disabled",
      message: "USD is the canonical base currency and cannot be deactivated.",
    });
    return;
  }
  if (code === BASE_CURRENCY && body.rateFromUsd != null && body.rateFromUsd !== 1) {
    res.status(400).json({
      error: "usd_rate_pinned",
      message: "The USD rate is pinned at 1 and cannot be changed.",
    });
    return;
  }

  if (body.isActive === false) {
    const defaultCode = await getDefaultCode();
    if (code === defaultCode) {
      res.status(409).json({
        error: "cannot_disable_default",
        message:
          "This currency is the platform default. Set another currency as the default before deactivating it.",
      });
      return;
    }
  }

  // Fast path that preserves the existing simple-toggle behaviour and
  // its specific error mapping (covers the existing admin "active"
  // switch row action).
  if (
    body.isActive != null &&
    body.name == null &&
    body.symbol == null &&
    body.rateFromUsd == null &&
    body.decimalPlaces == null &&
    body.symbolPosition == null &&
    body.thousandsSeparator == null &&
    body.decimalSeparator == null
  ) {
    try {
      const updated = await setCurrencyActive(code, body.isActive);
      if (!updated) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const defaultCode = await getDefaultCode();
      req.log.info({ code, isActive: body.isActive }, "[admin] toggled currency active");
      res.json({ currency: serialize(updated, defaultCode) });
      return;
    } catch (err) {
      req.log.warn({ err, code }, "[admin] currency toggle failed");
      res.status(400).json({ error: "usd_cannot_be_disabled" });
      return;
    }
  }

  // Code rename: only allowed when not USD, not the current default, not
  // referenced by existing rides, and the new code isn't taken. Renaming
  // also updates `app_settings.displayCurrency` if it happened to point
  // here, though we block that path above for safety.
  if (body.code != null && body.code !== code) {
    if (code === BASE_CURRENCY) {
      res.status(409).json({
        error: "code_locked",
        message: "USD is the canonical base currency and its code cannot be changed.",
      });
      return;
    }
    const defaultCode = await getDefaultCode();
    if (code === defaultCode) {
      res.status(409).json({
        error: "code_locked",
        message:
          "This currency is the platform default. Set another currency as the default before renaming its code.",
      });
      return;
    }
    if (await isCurrencyInUse(code)) {
      res.status(409).json({
        error: "code_locked",
        message:
          "This code is referenced by existing rides and cannot be changed. Create a new currency instead.",
      });
      return;
    }
    if (body.code === BASE_CURRENCY) {
      res.status(409).json({
        error: "code_already_exists",
        message: "USD is reserved.",
      });
      return;
    }
    const existing = await getAllCurrencies();
    if (existing.some((c) => c.code === body.code)) {
      res.status(409).json({
        error: "code_already_exists",
        message: `Currency ${body.code} already exists.`,
      });
      return;
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.code != null && body.code !== code) patch.code = body.code;
  if (body.isActive != null) patch.isActive = body.isActive;
  if (body.name != null) patch.name = body.name;
  if (body.symbol != null) patch.symbol = body.symbol;
  if (body.rateFromUsd != null && code !== BASE_CURRENCY) {
    patch.rateFromUsd = body.rateFromUsd;
    patch.lastUpdatedAt = new Date();
  }
  if (body.decimalPlaces != null) patch.decimalPlaces = body.decimalPlaces;
  if (body.symbolPosition != null) patch.symbolPosition = body.symbolPosition;
  if (body.thousandsSeparator != null) patch.thousandsSeparator = body.thousandsSeparator;
  if (body.decimalSeparator != null) patch.decimalSeparator = body.decimalSeparator;

  const [updated] = await db
    .update(currenciesTable)
    .set(patch)
    .where(eq(currenciesTable.code, code))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  invalidateCurrencyCache();
  const defaultCode = await getDefaultCode();
  req.log.info({ code, patch: body }, "[admin] updated currency");
  res.json({ currency: serialize(updated, defaultCode) });
});

/** DELETE /api/admin/currencies/:code — delete a currency. Refuses USD,
 * the current default, or any currency that is already referenced by an
 * existing fare/wallet/payment/ride. */
router.delete(
  "/admin/currencies/:code",
  requireAdmin,
  async (req, res): Promise<void> => {
    const code = String((req.params.code as string) ?? "").toUpperCase();
    if (code === BASE_CURRENCY) {
      res.status(409).json({
        error: "currency_in_use",
        message:
          "This currency is already used in fares, payments, wallets, or transactions. You can deactivate it instead.",
      });
      return;
    }
    const rows = await getAllCurrencies();
    const row = rows.find((c) => c.code === code);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const defaultCode = await getDefaultCode();
    if (code === defaultCode) {
      res.status(409).json({
        error: "currency_in_use",
        message:
          "This currency is already used in fares, payments, wallets, or transactions. You can deactivate it instead.",
      });
      return;
    }
    if (await isCurrencyInUse(code)) {
      res.status(409).json({
        error: "currency_in_use",
        message:
          "This currency is already used in fares, payments, wallets, or transactions. You can deactivate it instead.",
      });
      return;
    }
    await db.delete(currenciesTable).where(eq(currenciesTable.code, code));
    invalidateCurrencyCache();
    req.log.info({ code }, "[admin] deleted currency");
    res.json({ ok: true });
  },
);

/** PATCH /api/admin/currencies/:code/set-default — mark `code` as the
 * platform's display currency. The currency must exist and be active. */
router.patch(
  "/admin/currencies/:code/set-default",
  requireAdmin,
  async (req, res): Promise<void> => {
    const code = String((req.params.code as string) ?? "").toUpperCase();
    const rows = await getAllCurrencies();
    const row = rows.find((c) => c.code === code);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!row.isActive) {
      res.status(409).json({
        error: "default_must_be_active",
        message: "Activate this currency before setting it as the platform default.",
      });
      return;
    }
    await persistDefaultCurrency(code);
    const refreshed = await getAllCurrencies();
    req.log.info({ code }, "[admin] set default currency");
    res.json({
      currency: serialize(row, code),
      defaultCode: code,
      currencies: sortCurrencies(refreshed).map((c) => serialize(c, code)),
    });
  },
);

/** PATCH /api/admin/currencies/reorder — persist a new ordering for the
 * admin-controlled `sortOrder` column. Body: `{ codes: ["MAD","USD",…] }`.
 * Every active+inactive currency must appear exactly once. The supplied
 * order becomes 0..N-1; ties are broken by USD-first then alpha (handled
 * by `sortCurrencies` on read). */
const reorderSchema = z.object({
  codes: z
    .array(
      z
        .string()
        .trim()
        .transform((v) => v.toUpperCase())
        .pipe(z.string().regex(codeRegex, "Code must be exactly 3 uppercase letters")),
    )
    .min(1),
});

router.patch(
  "/admin/currencies/reorder",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
      return;
    }
    const { codes } = parsed.data;
    if (new Set(codes).size !== codes.length) {
      res.status(400).json({ error: "duplicate_codes" });
      return;
    }
    const existing = await getAllCurrencies();
    const existingCodes = new Set(existing.map((c) => c.code));
    const supplied = new Set(codes);
    if (
      existingCodes.size !== supplied.size ||
      [...existingCodes].some((c) => !supplied.has(c))
    ) {
      res.status(400).json({
        error: "codes_mismatch",
        message:
          "The reorder payload must include every currency exactly once.",
      });
      return;
    }
    try {
      await db.transaction(async (tx) => {
        for (let i = 0; i < codes.length; i++) {
          await tx
            .update(currenciesTable)
            .set({ sortOrder: i, updatedAt: new Date() })
            .where(eq(currenciesTable.code, codes[i]));
        }
      });
    } catch (err) {
      req.log.error({ err }, "[admin] failed to reorder currencies");
      res.status(500).json({ error: "server_error" });
      return;
    }
    invalidateCurrencyCache();
    const [rows, defaultCode] = await Promise.all([
      getAllCurrencies(),
      getDefaultCode(),
    ]);
    req.log.info({ codes }, "[admin] reordered currencies");
    res.json({
      currencies: sortCurrencies(rows).map((c) => serialize(c, defaultCode)),
      defaultCode,
    });
  },
);

/** POST /api/admin/currencies/refresh — manual "Update Now" trigger.
 * Returns the same envelope the scheduled refresh produces so the UI can
 * surface the result. */
const REFRESH_ERROR_MESSAGES: Record<string, string> = {
  fetch_failed: "Could not reach the exchange-rate service. Check your network connection and try again.",
  http_error: "The exchange-rate service returned an unexpected response.",
  invalid_json: "The exchange-rate service returned a malformed response.",
  schema_invalid: "The exchange-rate service returned an unrecognized payload.",
  upstream_error: "The exchange-rate service reported an error. Previous rates were kept.",
  db_read_failed: "Could not read the currencies table. Previous rates were kept.",
};

router.post("/admin/currencies/refresh", requireAdmin, async (req, res) => {
  const result = await refreshCurrencyRates();
  req.log.info({ result }, "[admin] manual currency refresh");
  const [rows, defaultCode] = await Promise.all([getAllCurrencies(), getDefaultCode()]);
  const errorMessage = result.error
    ? REFRESH_ERROR_MESSAGES[result.error] ?? "Refresh failed. Previous rates were kept."
    : null;
  res.json({
    updated: result.updated,
    fetchedAt: result.fetchedAt ? result.fetchedAt.toISOString() : null,
    error: result.error ?? null,
    errorMessage,
    defaultCode,
    currencies: sortCurrencies(rows).map((c) => serialize(c, defaultCode)),
  });
});

export default router;
