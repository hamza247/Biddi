import bcrypt from "bcryptjs";
import {
  db,
  adminsTable,
  notificationTemplatesTable,
  countriesTable,
  currenciesTable,
  deletedCountryCodesTable,
  serviceAreasTable,
  vehicleTypesTable,
  appClassesTable,
  GEO_FENCE_TYPES,
  type GeoFenceType,
} from "@workspace/db";
import { and, eq, sql, isNotNull } from "drizzle-orm";
import { logger } from "./logger";
import { ISO_3166_COUNTRIES } from "./countries";

const DEFAULT_EMAIL = process.env.DEFAULT_ADMIN_EMAIL ?? "admin@biddi.app";
const DEFAULT_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD ?? "biddi-admin";
const DEFAULT_NAME = "Biddi Admin";

export async function ensureDefaultAdmin(): Promise<void> {
  try {
    const existing = await db
      .select({ id: adminsTable.id })
      .from(adminsTable)
      .where(eq(adminsTable.email, DEFAULT_EMAIL))
      .limit(1);
    if (existing.length > 0) {
      logger.info({ email: DEFAULT_EMAIL }, "[seed] default admin already present");
      return;
    }
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await db.insert(adminsTable).values({
      email: DEFAULT_EMAIL,
      passwordHash,
      name: DEFAULT_NAME,
    });
    logger.info({ email: DEFAULT_EMAIL }, "[seed] default admin created");
  } catch (err) {
    logger.error({ err }, "[seed] failed to ensure default admin");
  }
}

const DEFAULT_TEMPLATES: Array<{
  key: string;
  type: "push" | "email";
  title: string;
  body: string;
}> = [
  {
    key: "driver_approved",
    type: "push",
    title: "Account Approved",
    body: "Your driver account has been approved. You can now go online and start accepting rides!",
  },
  {
    key: "driver_rejected",
    type: "push",
    title: "Application Rejected",
    body: "Your driver application has been rejected.{{reason}} Please re-upload your documents to try again.",
  },
  {
    key: "driver_ride_request",
    type: "push",
    title: "New Ride Request",
    body: "Pickup: {{pickup}}\nDropoff: {{dropoff}}",
  },
  {
    key: "withdrawal_approved",
    type: "push",
    title: "Withdrawal approved",
    body: "Your withdrawal of ${{amount}} has been approved and is being processed.",
  },
  {
    key: "withdrawal_paid",
    type: "push",
    title: "Withdrawal paid",
    body: "${{amount}} has been sent to your payout account.{{reference}}",
  },
  {
    key: "promotion_started",
    type: "push",
    title: "New promotion available",
    body: "{{promotionTitle}} — earn ${{bonus}} for {{trips}} trip(s).",
  },
  {
    key: "promotion_near_completion",
    type: "push",
    title: "Almost there!",
    body: "One more trip to earn ${{bonus}} from \"{{promotionTitle}}\".",
  },
  {
    key: "promotion_bonus_earned",
    type: "push",
    title: "Promotion bonus earned!",
    body: "You earned ${{bonus}} from \"{{promotionTitle}}\". It's been added to your wallet.",
  },
  {
    key: "withdrawal_rejected",
    type: "push",
    title: "Withdrawal rejected",
    body: "Your withdrawal request of ${{amount}} was rejected.{{reason}} The amount has been returned to your wallet.",
  },
  {
    key: "chat.new_message_to_rider",
    type: "push",
    title: "{{senderName}}",
    body: "{{preview}}",
  },
  {
    key: "chat.new_message_to_driver",
    type: "push",
    title: "{{senderName}}",
    body: "{{preview}}",
  },
  {
    key: "withdrawal_approved",
    type: "email",
    title: "Your Biddi withdrawal has been approved",
    body: "<p>Hi {{firstName}},</p><p>Good news — your withdrawal request of <strong>${{amount}}</strong> has been approved and is now being processed.</p><p>You'll receive another email once the payment has been sent to your payout account.</p><p>— The Biddi Team</p>",
  },
  {
    key: "withdrawal_paid",
    type: "email",
    title: "Your Biddi withdrawal has been paid",
    body: "<p>Hi {{firstName}},</p><p>Your withdrawal of <strong>${{amount}}</strong> has been sent to your payout account.</p><p>Payment reference: <strong>{{reference}}</strong></p><p>If you don't see the funds within a few business days, please contact support.</p><p>— The Biddi Team</p>",
  },
  {
    key: "withdrawal_rejected",
    type: "email",
    title: "Your Biddi withdrawal was rejected",
    body: "<p>Hi {{firstName}},</p><p>Your withdrawal request of <strong>${{amount}}</strong> was rejected.</p><p><strong>Reason:</strong> {{reason}}</p><p>The amount has been returned to your wallet and you can submit a new request at any time.</p><p>— The Biddi Team</p>",
  },
];

export async function ensureNotificationTemplates(): Promise<void> {
  for (const tmpl of DEFAULT_TEMPLATES) {
    try {
      const existing = await db
        .select({ id: notificationTemplatesTable.id })
        .from(notificationTemplatesTable)
        .where(
          and(
            eq(notificationTemplatesTable.key, tmpl.key),
            eq(notificationTemplatesTable.type, tmpl.type),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        logger.info(
          { key: tmpl.key, type: tmpl.type },
          "[seed] notification template already present",
        );
        continue;
      }
      await db.insert(notificationTemplatesTable).values({
        type: tmpl.type,
        key: tmpl.key,
        title: tmpl.title,
        body: tmpl.body,
        active: true,
      });
      logger.info(
        { key: tmpl.key, type: tmpl.type },
        "[seed] notification template created",
      );
    } catch (err) {
      logger.error(
        { err, key: tmpl.key, type: tmpl.type },
        "[seed] failed to ensure notification template",
      );
    }
  }
}

// Default countries seeded into the Geo Fence section. We pre-load the full
// ISO 3166-1 list so the Countries page is usable out of the box.
const DEFAULT_COUNTRIES: { name: string; isoCode: string }[] = ISO_3166_COUNTRIES;

// Best-effort ISO-2 lookup so we don't seed countries with empty codes when
// auto-discovering them from existing service-area rows whose name doesn't
// match any ISO entry. Anything not in this table is skipped (operators can
// add it via the Countries page).
const KNOWN_ISO_CODES: Record<string, string> = {
  Turkey: "TR",
  Russia: "RU",
  Iran: "IR",
  Vietnam: "VN",
  Syria: "SY",
  Tanzania: "TZ",
  Laos: "LA",
  "South Korea": "KR",
  "North Korea": "KP",
  Moldova: "MD",
  Palestine: "PS",
  "Cape Verde": "CV",
  Swaziland: "SZ",
  "Czech Republic": "CZ",
  Macedonia: "MK",
  "East Timor": "TL",
  Brunei: "BN",
  "Vatican City": "VA",
  Bolivia: "BO",
  Micronesia: "FM",
};

// Map legacy / superseded service-area types to the closest current Geo Fence
// category so old rows still show up under one of the new sidebar pages.
const LEGACY_TYPE_MAP: Record<string, GeoFenceType> = {
  temporary_block: "restricted_area",
  pricing_zone: "location_wise_fare",
};

interface UpdateResult {
  rowCount?: number;
}

function isCurrentType(t: string): t is GeoFenceType {
  return (GEO_FENCE_TYPES as readonly string[]).includes(t);
}

export async function ensureGeoFenceDefaults(): Promise<void> {
  try {
    // 1. Migrate legacy service-area types in place.
    for (const [from, to] of Object.entries(LEGACY_TYPE_MAP)) {
      // Skip if the legacy key is somehow already a current valid type — this
      // also keeps the typed update payload below honest.
      if (isCurrentType(from)) continue;
      const result = (await db
        .update(serviceAreasTable)
        .set({ type: to, updatedAt: new Date() })
        .where(sql`${serviceAreasTable.type} = ${from}`)) as unknown as UpdateResult;
      const count = result.rowCount;
      if (count && count > 0) {
        logger.info({ from, to, count }, "[seed] migrated legacy service-area type");
      }
    }

    // 2. Build the desired country list: defaults + any country already in use
    // by an existing service area row that we have a known ISO code for. We
    // skip auto-discovered countries with no known ISO so we don't seed
    // low-quality rows that operators would have to clean up by hand.
    const usedRows = await db
      .selectDistinct({ country: serviceAreasTable.country })
      .from(serviceAreasTable);
    const desired = new Map<string, string>();
    for (const c of DEFAULT_COUNTRIES) desired.set(c.name, c.isoCode);
    for (const row of usedRows) {
      const name = row.country?.trim();
      if (!name || desired.has(name)) continue;
      const iso = KNOWN_ISO_CODES[name];
      if (iso) desired.set(name, iso);
    }

    // 3. Insert any countries that aren't already present, ignoring conflicts
    // on the unique name index so we don't disturb manually-edited rows.
    // Skip any ISO code that an admin has explicitly tombstoned via the
    // Countries page DELETE endpoint, so deletions stick across restarts.
    const existing = await db.select({ name: countriesTable.name }).from(countriesTable);
    const existingNames = new Set(existing.map((c) => c.name));
    const tombstoned = await db
      .select({ isoCode: deletedCountryCodesTable.isoCode })
      .from(deletedCountryCodesTable);
    const tombstonedIso = new Set(tombstoned.map((t) => t.isoCode.toUpperCase()));
    const toInsert = Array.from(desired.entries())
      .filter(([name]) => !existingNames.has(name))
      .filter(([, isoCode]) => !tombstonedIso.has(isoCode.toUpperCase()))
      .map(([name, isoCode]) => ({ name, isoCode: isoCode.toUpperCase(), active: true }));
    if (toInsert.length > 0) {
      await db
        .insert(countriesTable)
        .values(toInsert)
        .onConflictDoNothing({ target: countriesTable.name });
      logger.info({ added: toInsert.map((c) => c.name) }, "[seed] inserted missing countries");
    } else {
      logger.info("[seed] geo fence countries already up to date");
    }
  } catch (err) {
    logger.error({ err }, "[seed] failed to ensure geo fence defaults");
  }
}

// Maps lower-cased name substrings to a classKey. Checked in order — first
// match wins. Keeps the backfill deterministic and easy to extend.
const NAME_CLASS_MAP: Array<{ pattern: RegExp; classKey: "ride" | "comfort" | "moto" }> = [
  { pattern: /eco|standard|basic|ride/i, classKey: "ride" },
  { pattern: /comfort|premium|business|luxury|suv/i, classKey: "comfort" },
  { pattern: /moto|bike|motorcycle|mini/i, classKey: "moto" },
];

function inferClassKey(name: string): "ride" | "comfort" | "moto" | null {
  for (const { pattern, classKey } of NAME_CLASS_MAP) {
    if (pattern.test(name)) return classKey;
  }
  return null;
}

const SEED_VEHICLE_TYPES: Array<{
  name: string;
  description: string;
  vehicleCategory: "car" | "moto";
  classKey: "ride" | "comfort" | "moto";
  baseFare: number;
  pricePerKm: number;
  pricePerMin: number;
  minimumFare: number;
  commissionPercent: number;
  fareModelStrategy: "incremental" | "fixed";
  personCapacity: number;
  displayOrder: number;
}> = [
  {
    name: "Eco",
    description: "Affordable everyday rides",
    vehicleCategory: "car",
    classKey: "ride",
    baseFare: 5,
    pricePerKm: 1.5,
    pricePerMin: 0.2,
    minimumFare: 8,
    commissionPercent: 15,
    fareModelStrategy: "incremental",
    personCapacity: 4,
    displayOrder: 0,
  },
  {
    name: "Comfort",
    description: "Premium rides with air conditioning",
    vehicleCategory: "car",
    classKey: "comfort",
    baseFare: 8,
    pricePerKm: 2.5,
    pricePerMin: 0.35,
    minimumFare: 12,
    commissionPercent: 15,
    fareModelStrategy: "incremental",
    personCapacity: 4,
    displayOrder: 1,
  },
  {
    name: "Moto",
    description: "Quick motorcycle rides for solo travel",
    vehicleCategory: "moto",
    classKey: "moto",
    baseFare: 3,
    pricePerKm: 1.0,
    pricePerMin: 0.15,
    minimumFare: 5,
    commissionPercent: 15,
    fareModelStrategy: "incremental",
    personCapacity: 1,
    displayOrder: 2,
  },
];

// The one canonical format for icon_url stored in vehicle_types.
const CANONICAL_ICON_PREFIX = "/api/storage/objects/uploads/";
// Older rows may have been saved without the /api prefix.
const BARE_OBJECTS_PREFIX = "/objects/uploads/";
// Pattern to extract the upload ID from any path or URL tail.
const UPLOADS_TAIL_RE = /\/uploads\/([A-Za-z0-9._-]{1,128})$/;

/**
 * Given a stored icon_url value, return the canonical form if the value needs
 * to be normalised, or null if it is already canonical (or cannot be fixed).
 */
function toCanonicalIconUrl(url: string): string | null {
  // Already in the correct form — nothing to do.
  if (url.startsWith(CANONICAL_ICON_PREFIX)) return null;

  // /objects/uploads/<id>  →  /api/storage/objects/uploads/<id>
  if (url.startsWith(BARE_OBJECTS_PREFIX)) {
    return `/api/storage${url}`;
  }

  if (url.startsWith("https://") || url.startsWith("http://")) {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }

    // https://<server>/api/storage/objects/uploads/<id>
    if (path.startsWith(CANONICAL_ICON_PREFIX)) return path;

    // https://<server>/objects/uploads/<id>
    if (path.startsWith(BARE_OBJECTS_PREFIX)) return `/api/storage${path}`;

    // https://storage.googleapis.com/<bucket>/…/uploads/<id>
    // (raw GCS presigned/public URLs that were accidentally persisted)
    const match = path.match(UPLOADS_TAIL_RE);
    if (match) return `${CANONICAL_ICON_PREFIX}${match[1]}`;
  }

  // Unknown format — leave it alone; the admin can correct it manually.
  return null;
}

/**
 * One-time-at-startup migration: normalise every icon_url stored in
 * vehicle_types to the canonical `/api/storage/objects/uploads/<id>` form.
 * Safe to run repeatedly — rows that are already canonical are skipped.
 */
export async function ensureIconUrlFormat(): Promise<void> {
  try {
    const rows = await db
      .select({ id: vehicleTypesTable.id, iconUrl: vehicleTypesTable.iconUrl })
      .from(vehicleTypesTable)
      .where(isNotNull(vehicleTypesTable.iconUrl));

    let fixed = 0;
    let skipped = 0;

    for (const row of rows) {
      const current = row.iconUrl!;
      const canonical = toCanonicalIconUrl(current);
      if (!canonical) {
        skipped++;
        continue;
      }
      await db
        .update(vehicleTypesTable)
        .set({ iconUrl: canonical, updatedAt: new Date() })
        .where(eq(vehicleTypesTable.id, row.id));
      logger.info(
        { id: row.id, from: current, to: canonical },
        "[seed] normalised vehicle type iconUrl",
      );
      fixed++;
    }

    if (fixed > 0) {
      logger.info({ fixed, skipped }, "[seed] icon URL migration complete");
    } else {
      logger.info({ skipped }, "[seed] all icon URLs already canonical");
    }
  } catch (err) {
    logger.error({ err }, "[seed] failed to normalise icon URLs");
  }
}

/** Ensures vehicle types exist with correct classKey values.
 *  - If no vehicle types exist at all, seeds Eco / Comfort / Moto defaults.
 *  - Always backfills any existing row whose classKey IS NULL by inferring it
 *    from the row's name. */
export async function ensureDefaultVehicleTypes(): Promise<void> {
  try {
    const existing = await db.select().from(vehicleTypesTable);

    if (existing.length === 0) {
      await db.insert(vehicleTypesTable).values(SEED_VEHICLE_TYPES);
      logger.info(
        { names: SEED_VEHICLE_TYPES.map((t) => t.name) },
        "[seed] inserted default vehicle types",
      );
      return;
    }

    // Backfill classKey for rows that are still NULL.
    const nullRows = existing.filter((r) => r.classKey == null);
    let backfilled = 0;
    for (const row of nullRows) {
      const key = inferClassKey(row.name);
      if (!key) continue;
      await db
        .update(vehicleTypesTable)
        .set({ classKey: key, updatedAt: new Date() })
        .where(eq(vehicleTypesTable.id, row.id));
      backfilled++;
    }

    if (backfilled > 0) {
      logger.info({ backfilled }, "[seed] backfilled vehicle type classKey values");
    } else {
      logger.info("[seed] vehicle type classKeys already up to date");
    }
  } catch (err) {
    logger.error({ err }, "[seed] failed to ensure default vehicle types");
  }
}

const BUILT_IN_APP_CLASSES = [
  { slug: "ride", label: "Ride", colorHex: "#3B82F6", isBuiltIn: true },
  { slug: "comfort", label: "Comfort", colorHex: "#8B5CF6", isBuiltIn: true },
  { slug: "moto", label: "Moto", colorHex: "#F59E0B", isBuiltIn: true },
];

/**
 * Seeds the canonical USD/MAD/EUR rows used by the currency service. USD
 * is always pinned at rate=1 and active. MAD/EUR are inserted with NULL
 * rate so the first poll fills them in; if the poll fails, they stay
 * inactive-display until a successful refresh writes a real rate.
 */
const DEFAULT_CURRENCIES: Array<{
  code: string;
  name: string;
  symbol: string;
  rateFromUsd: number | null;
  decimalPlaces: number;
  symbolPosition: "before" | "after";
  thousandsSeparator: "comma" | "dot" | "space";
  decimalSeparator: "dot" | "comma";
}> = [
  {
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    rateFromUsd: 1,
    decimalPlaces: 2,
    symbolPosition: "before",
    thousandsSeparator: "comma",
    decimalSeparator: "dot",
  },
  {
    code: "MAD",
    name: "Moroccan Dirham",
    symbol: "MAD",
    rateFromUsd: null,
    decimalPlaces: 2,
    symbolPosition: "after",
    thousandsSeparator: "space",
    decimalSeparator: "dot",
  },
  {
    code: "EUR",
    name: "Euro",
    symbol: "€",
    rateFromUsd: null,
    decimalPlaces: 2,
    symbolPosition: "before",
    thousandsSeparator: "dot",
    decimalSeparator: "comma",
  },
];

export async function ensureDefaultCurrencies(): Promise<void> {
  try {
    // First insert seeds idempotently — never clobber operator-managed
    // fields (name/symbol/rate/isActive *or* the formatting fields,
    // which the admin can edit at runtime).
    for (const c of DEFAULT_CURRENCIES) {
      await db
        .insert(currenciesTable)
        .values({
          code: c.code,
          name: c.name,
          symbol: c.symbol,
          rateFromUsd: c.rateFromUsd,
          lastUpdatedAt: c.code === "USD" ? new Date() : null,
          isActive: true,
          decimalPlaces: c.decimalPlaces,
          symbolPosition: c.symbolPosition,
          thousandsSeparator: c.thousandsSeparator,
          decimalSeparator: c.decimalSeparator,
        })
        .onConflictDoNothing({ target: currenciesTable.code });
    }
    // The 0030 migration added the formatting columns with NOT NULL
    // schema-level defaults, so existing rows were already backfilled
    // by the DDL. We don't run a second update here because that would
    // overwrite operator edits.
    // Guarantee the USD row stays canonical (rate=1, active=true) even if
    // a prior bad write touched it. We only update the pinned columns.
    await db
      .update(currenciesTable)
      .set({ rateFromUsd: 1, isActive: true, updatedAt: new Date() })
      .where(eq(currenciesTable.code, "USD"));
    logger.info("[seed] default currencies ensured (USD/MAD/EUR)");
  } catch (err) {
    logger.error({ err }, "[seed] failed to ensure default currencies");
  }
}

export async function ensureDefaultAppClasses(): Promise<void> {
  try {
    const existing = await db
      .select({ id: appClassesTable.id })
      .from(appClassesTable)
      .limit(1);
    if (existing.length > 0) {
      logger.info("[seed] app_classes table already populated — skipping built-in seed");
      return;
    }
    await db.insert(appClassesTable).values(BUILT_IN_APP_CLASSES);
    logger.info(
      { slugs: BUILT_IN_APP_CLASSES.map((c) => c.slug) },
      "[seed] inserted built-in app classes",
    );
  } catch (err) {
    logger.error({ err }, "[seed] failed to ensure default app classes");
  }
}
