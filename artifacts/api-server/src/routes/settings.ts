import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../middlewares/auth";
import {
  getConfig,
  setConfig,
  SettingsValidationError,
  redactConfig,
  redactPatchForLog,
  TAB_KEYS,
  SETTINGS_KEYS,
  SECRET_KEYS,
  BOOLEAN_KEYS,
  NUMBER_KEYS,
  type AppConfig,
} from "../lib/settings";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

// Public, unauthenticated. Only safe-to-publish settings.
router.get("/config/public", async (_req, res) => {
  const cfg = await getConfig();
  // Resolve the live display-currency symbol for clients that need to
  // render amounts (rider/driver mobile apps, marketing site).
  const { resolveDisplayCurrency, getCurrency } = await import("../lib/currency");
  const { enrichWithPlatformCurrency } = await import("../lib/displayAmount");
  const displayCurrency = await resolveDisplayCurrency(cfg.displayCurrency);
  const dispRow = await getCurrency(displayCurrency);
  // Server-converted minimum withdrawal envelope so the driver app renders
  // exactly what the operator configured (no client-side FX math).
  const minWithdrawalAmountDisplay = await enrichWithPlatformCurrency(
    cfg.minWithdrawalAmount,
  );
  res.setHeader("cache-control", "public, max-age=30");
  // The base map is standardized to Google Roadmap, so client-rendered
  // map surfaces always need the platform Google Maps key (when one is
  // configured). The legacy `mapProviderTiles === "google"` gate that
  // used to suppress these keys was removed alongside the OSM/Google
  // tile toggle.
  const webKey = cfg.googleMapsApiKeyWeb || cfg.googleMapsApiKey;
  const iosKey = cfg.googleMapsApiKeyIos || cfg.googleMapsApiKey;
  const androidKey = cfg.googleMapsApiKeyAndroid || cfg.googleMapsApiKey;
  res.json({
    googleMapsApiKeyWeb: webKey,
    googleMapsApiKeyIos: iosKey,
    googleMapsApiKeyAndroid: androidKey,
    hasServerMapsKey: !!cfg.googleMapsApiKey,
    smsMode: cfg.smsMode,
    mapProviderAutocomplete: cfg.mapProviderAutocomplete,
    mapProviderGeocode: cfg.mapProviderGeocode,
    mapProviderRouting: cfg.mapProviderRouting,
    driverEtaLabelsEnabled: cfg.driverEtaLabelsEnabled,
    driverIconSize: cfg.driverIconSize,
    driverStaleLocationThresholdSeconds: cfg.driverStaleLocationThresholdSeconds,
    heatmapEnabled: cfg.heatmapEnabled,
    heatmapRefreshSeconds: cfg.heatmapRefreshSeconds,
    heatmapLabelMode: cfg.heatmapLabelMode,
    heatmapBonusBase: cfg.heatmapBonusBase,
    displayCurrency,
    displaySymbol: dispRow?.symbol ?? "$",
    // Formatting fields the operator chose for this currency. Clients
    // (rider/driver mobile apps) must use these so amounts render exactly
    // the way they're configured in the admin (e.g. `10,00 MAD` vs `$10.00`).
    displayDecimalPlaces: dispRow?.decimalPlaces ?? 2,
    displaySymbolPosition: (dispRow?.symbolPosition ?? "before") as
      | "before"
      | "after",
    displayThousandsSeparator: (dispRow?.thousandsSeparator ?? "comma") as
      | "comma"
      | "dot"
      | "space",
    displayDecimalSeparator: (dispRow?.decimalSeparator ?? "dot") as
      | "dot"
      | "comma",
    // USD→displayCurrency rate. Clients multiply USD-denominated values
    // (bid amounts, fare breakdown line items, totals) by this to render
    // converted amounts without a round-trip per value. 1 when the rate
    // is unknown / display==USD so worst case clients show USD numbers
    // alongside the USD symbol — never a symbol/amount mismatch.
    displayRate:
      dispRow?.code === "USD"
        ? 1
        : dispRow?.rateFromUsd != null
          ? Number(dispRow.rateFromUsd)
          : 1,
    minWithdrawalAmount: cfg.minWithdrawalAmount,
    minWithdrawalAmountDisplay,
  });
});

router.get("/admin/settings", requireAdmin, async (_req, res) => {
  const cfg = await getConfig(true);
  res.json({ settings: redactConfig(cfg) });
});

const provider = z.enum(["google", "osm"]);
const distanceUnit = z.enum(["km", "miles"]);
const paymentEnvironment = z.enum(["sandbox", "live"]);
const smsMode = z.enum(["demo_fixed", "demo_random", "twilio", "moroccansms"]);
const heatmapLabelMode = z.enum(["multiplier", "bonus", "off"]);

// Field-level validators. Strings default to z.string(); booleans/numbers
// declared explicitly. Email/URL fields validated when given but optional.
const optionalEmail = z.string().email().or(z.literal("")).optional();
const optionalUrl = z.string().url().or(z.literal("")).optional();

// Strict boolean: only accepts true/false or the exact strings "true"/"false"
// (and 0/1). Avoids z.coerce.boolean() turning the string "false" into true.
const strictBoolean = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0" || v === "" || v == null) return false;
  return v;
}, z.boolean());

const fieldSchema: Partial<Record<keyof AppConfig, z.ZodTypeAny>> = {
  smsMode,
  smsDemoCode: z.string().regex(/^\d{4,8}$/).or(z.literal("")).optional(),
  twilioAccountSid: z.string().max(200),
  twilioAuthToken: z.string().max(200),
  twilioFromNumber: z.string().max(40),
  moroccansmsToken: z.string().max(200),
  moroccansmsSender: z.string().max(11),
  moroccansmsPrefix: z.string().regex(/^\d{0,4}$/),
  moroccansmsSubAccount: z.string().max(60),
  moroccansmsPassword: z.string().max(200),
  moroccansmsUrl: z.string().max(300),
  googleMapsApiKey: z.string().max(200),
  googleMapsApiKeyWeb: z.string().max(200),
  googleMapsApiKeyIos: z.string().max(200),
  googleMapsApiKeyAndroid: z.string().max(200),
  // Deprecated provider settings kept for back-compat — the maps stack is
  // now Google (geocoding/autocomplete) + OSRM (routing) only. mapProvider*
  // selectors no longer affect runtime behaviour but are still accepted in
  // PUT bodies so older admin builds don't break.
  mapProviderAutocomplete: provider,
  mapProviderGeocode: provider,
  mapProviderRouting: provider,
  osmRoutingUrl: optionalUrl,
  liveMapDefaultLat: z.coerce.number().min(-90).max(90),
  liveMapDefaultLng: z.coerce.number().min(-180).max(180),
  liveMapDefaultZoom: z.coerce.number().int().min(1).max(18),
  smtpHost: z.string().max(300),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUser: z.string().max(300),
  smtpPass: z.string().max(300),
  smtpFrom: z.string().max(300),
  smtpSecure: strictBoolean,
  fromName: z.string().max(120),
  noReplyEmail: optionalEmail,
  adminEmail: optionalEmail,
  mailFooter: z.string().max(2000),
  sendingDomain: optionalUrl,
  projectName: z.string().max(120),
  adminIsdCode: z.string().max(8),
  countryCode: z.string().max(4),
  distanceUnit,
  recordsPerPage: z.coerce.number().int().min(5).max(500),
  walletAmount1: z.coerce.number().min(0).max(1_000_000),
  walletAmount2: z.coerce.number().min(0).max(1_000_000),
  walletAmount3: z.coerce.number().min(0).max(1_000_000),
  googleAnalyticsId: z.string().max(100),
  facebookAppId: z.string().max(120),
  footerFacebookUrl: optionalUrl,
  footerTwitterUrl: optionalUrl,
  footerLinkedinUrl: optionalUrl,
  footerInstagramUrl: optionalUrl,
  footerGoogleUrl: optionalUrl,
  googleOAuthAppName: z.string().max(120),
  googleOAuthClientId: z.string().max(300),
  googleOAuthClientSecret: z.string().max(300),
  googleOAuthRedirectUrl: optionalUrl,
  googleOAuthSiteLink: optionalUrl,
  facebookClientToken: z.string().max(300),
  facebookAppSecret: z.string().max(300),
  admobWebClientId: z.string().max(200),
  admobIosStoreClientId: z.string().max(200),
  admobIosDriverClientId: z.string().max(200),
  admobIosPassengerClientId: z.string().max(200),
  fbPlacementIos: z.string().max(200),
  fbPlacementAndroid: z.string().max(200),
  facebookPixelId: z.string().max(200),
  captchaSiteKey: z.string().max(300),
  captchaSecret: z.string().max(300),
  applePushKeyId: z.string().max(60),
  applePushKeyFile: z.string().max(200),
  appleTeamId: z.string().max(60),
  googleProjectId: z.string().max(120),
  autocompleteMinChars: z.coerce.number().int().min(1).max(10),
  hereAppId: z.string().max(200),
  hereAppKey: z.string().max(300),
  hereAppCode: z.string().max(300),
  systemTimeZone: z.string().max(80),
  paymentEnvironment,
  stripePublishableKey: z.string().max(300),
  stripeSecretKey: z.string().max(300),
  stripeWebhookSecret: z.string().max(300),
  minWalletAmount: z.coerce.number().min(0).max(1_000_000),
  walletTransferMinAmount: z.coerce.number().min(0).max(1_000_000),
  walletTransferOtpMinutes: z.coerce.number().int().min(1).max(60),
  walletTransferMaxPerTxn: z.coerce.number().min(0).max(10_000_000),
  walletTransferMaxPerDay: z.coerce.number().min(0).max(10_000_000),
  minWithdrawalAmount: z.coerce.number().min(0).max(100_000),
  driverIconSize: z.coerce.number().int().min(16).max(120),
  driverOfflineWindowHours: z.coerce.number().int().min(1).max(48),
  // Capped at 110s so the stale warning always fires before the 120s
  // POSITION_TTL_MS in `lib/io.ts` evicts the driver outright (which would
  // otherwise turn the marker `not_available` instead of `stale`).
  driverStaleLocationThresholdSeconds: z.coerce.number().int().min(30).max(110),
  appReferralBonusUser: z.coerce.number().min(0).max(1_000_000),
  appReferralBonusDriver: z.coerce.number().min(0).max(1_000_000),
  appBookingMaxAdvanceDays: z.coerce.number().int().min(1).max(365),
  heatmapRefreshSeconds: z.coerce.number().int().min(5).max(120),
  heatmapGridMeters: z.coerce.number().int().min(100).max(5000),
  heatmapDemandLookbackSeconds: z.coerce.number().int().min(30).max(3600),
  heatmapSupplyStaleSeconds: z.coerce.number().int().min(30).max(600),
  heatmapSurgeThresholdLight: z.coerce.number().min(0).max(10),
  heatmapSurgeThresholdMedium: z.coerce.number().min(0).max(10),
  heatmapSurgeThresholdHigh: z.coerce.number().min(0).max(10),
  heatmapSurgeThresholdVeryHigh: z.coerce.number().min(0).max(10),
  heatmapBonusBase: z.coerce.number().min(0).max(1000),
  heatmapLabelMode,
  soundNewTripRequest: z.string().max(80),
  soundDriverApp: z.string().max(80),
  soundUserApp: z.string().max(80),
  soundVoipCalling: z.string().max(80),
};

function validatorFor(key: keyof AppConfig): z.ZodTypeAny {
  if (fieldSchema[key]) return fieldSchema[key]!;
  if (BOOLEAN_KEYS.has(key)) return strictBoolean;
  if (NUMBER_KEYS.has(key)) return z.coerce.number();
  return z.string().max(1000);
}

function buildPatchSchema(allowed: (keyof AppConfig)[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const k of allowed) shape[k] = validatorFor(k).optional();
  return z.object(shape).strict();
}

// Back-compat: legacy full PUT must accept ANY known AppConfig key, including
// keys not yet surfaced under a tab (e.g. driverIconSize, driverOfflineWindowHours
// used by the live-map page). Build the schema from SETTINGS_KEYS rather than
// just the tab keys so old admin code paths keep working.
const fullPatchSchema = buildPatchSchema(SETTINGS_KEYS);

function applySecretBlanks(patch: Record<string, unknown>) {
  // Empty string on a secret means "leave unchanged".
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (SECRET_KEYS.has(k as keyof AppConfig) && v === "") continue;
    out[k] = v;
  }
  return out;
}

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = fullPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const safe = applySecretBlanks(parsed.data);
  req.log.info({ patch: redactPatchForLog(safe) }, "[settings] PUT /admin/settings");
  const next = await setConfig(safe as Partial<AppConfig>);
  res.json({ settings: redactConfig(next) });
});

router.get("/admin/settings/:tab", requireAdmin, async (req, res): Promise<void> => {
  const tab = String((req.params.tab as string));
  const keys = TAB_KEYS[tab];
  if (!keys) {
    res.status(404).json({ error: "unknown_tab" });
    return;
  }
  const cfg = await getConfig(true);
  const redacted = redactConfig(cfg);
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (redacted as unknown as Record<string, unknown>)[k];
  const flags: Record<string, boolean> = {};
  for (const k of keys) {
    if (SECRET_KEYS.has(k)) flags[k] = !!cfg[k];
  }
  res.json({ tab, settings: out, _hasSecrets: flags });
});

router.put("/admin/settings/:tab", requireAdmin, async (req, res): Promise<void> => {
  const tab = String((req.params.tab as string));
  const keys = TAB_KEYS[tab];
  if (!keys) {
    res.status(404).json({ error: "unknown_tab" });
    return;
  }
  const schema = buildPatchSchema(keys);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const safe = applySecretBlanks(parsed.data);
  req.log.info(
    { tab, patch: redactPatchForLog(safe) },
    "[settings] PUT /admin/settings/:tab",
  );
  let next: AppConfig;
  try {
    next = await setConfig(safe as Partial<AppConfig>);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      res.status(400).json({ error: "invalid_input", key: err.key, message: err.message });
      return;
    }
    throw err;
  }
  const redacted = redactConfig(next);
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (redacted as unknown as Record<string, unknown>)[k];
  const flags: Record<string, boolean> = {};
  for (const k of keys) {
    if (SECRET_KEYS.has(k)) flags[k] = !!next[k];
  }
  res.json({ tab, settings: out, _hasSecrets: flags });
});

const testEmailSchema = z.object({
  to: z.string().email().max(300),
});

router.post("/admin/settings/test-email", requireAdmin, async (req, res): Promise<void> => {
  const parsed = testEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  try {
    await sendEmail({
      to: parsed.data.to,
      subject: "Biddi — SMTP test email",
      html: "<p>This is a test email sent from the Biddi admin panel to verify your SMTP configuration.</p>",
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    const message = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
    res.status(502).json({ error: "send_failed", message });
  }
});

export default router;
