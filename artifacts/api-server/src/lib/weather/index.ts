import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  db,
  weatherReadingsCacheTable,
  weatherSurchargeRulesTable,
  serviceAreasTable,
  countriesTable,
  type WeatherReading,
  type WeatherSurchargeRule,
  type WeatherConditions,
} from "@workspace/db";
import { logger } from "../logger";
import { pointInPolygon } from "../geo";

/** Polling cadence — runs every 15 minutes per the task spec. */
export const WEATHER_POLL_INTERVAL_MS = 15 * 60 * 1000;
/** Readings older than this are considered stale and ignored. Must be >
 * the poll interval so a missed poll doesn't immediately disable surcharges. */
export const WEATHER_MAX_STALE_MS = 35 * 60 * 1000;

const OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";

interface OpenWeatherResponse {
  weather?: Array<{ id: number; main: string; description: string }>;
  main?: { temp?: number };
  wind?: { speed?: number };
  rain?: { "1h"?: number };
  snow?: { "1h"?: number };
  dt?: number;
  cod?: number | string;
  message?: string;
}

interface ScopeKey {
  scope: string;
  lat: number;
  lng: number;
}

/** Maps an OpenWeather response into the columns we cache. */
function normalize(payload: OpenWeatherResponse) {
  const w = payload.weather?.[0];
  return {
    rainMm: payload.rain?.["1h"] ?? 0,
    snowMm: payload.snow?.["1h"] ?? 0,
    tempC: payload.main?.temp ?? 0,
    windMs: payload.wind?.speed ?? 0,
    weatherMain: w?.main ?? null,
    weatherDescription: w?.description ?? null,
    observedAt: payload.dt ? new Date(payload.dt * 1000) : new Date(),
  };
}

/** Best-effort centroid of a (multi-)polygon. Returns null when the
 * polygon JSON is malformed. */
function polygonCentroid(polygonJson: string | null | undefined): {
  lat: number;
  lng: number;
} | null {
  if (!polygonJson) return null;
  try {
    const parsed: any = JSON.parse(polygonJson);
    const geom =
      parsed?.type === "Feature"
        ? parsed.geometry
        : parsed?.type === "FeatureCollection"
          ? parsed.features?.[0]?.geometry
          : parsed;
    if (!geom?.coordinates) return null;
    const coords =
      geom.type === "MultiPolygon" ? geom.coordinates[0]?.[0] : geom.coordinates[0];
    if (!Array.isArray(coords) || coords.length === 0) return null;
    let sumLat = 0;
    let sumLng = 0;
    let n = 0;
    for (const pt of coords) {
      if (Array.isArray(pt) && pt.length >= 2) {
        sumLng += Number(pt[0]);
        sumLat += Number(pt[1]);
        n++;
      }
    }
    if (n === 0) return null;
    return { lat: sumLat / n, lng: sumLng / n };
  } catch {
    return null;
  }
}

/** Country-code → approximate centroid lookup. Used as a coarse fallback
 * when an active country-scoped rule has no matching service-area
 * polygons inside it. Only ISO codes used in the seed data need entries
 * here; unknown codes fall back to (0, 0) which OpenWeather will reject. */
const COUNTRY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  MA: { lat: 31.79, lng: -7.09 },
  FR: { lat: 46.6, lng: 2.21 },
  US: { lat: 39.83, lng: -98.58 },
  GB: { lat: 54.0, lng: -2.0 },
  ES: { lat: 40.46, lng: -3.75 },
  DE: { lat: 51.17, lng: 10.45 },
  IT: { lat: 41.87, lng: 12.57 },
  CA: { lat: 56.13, lng: -106.35 },
  AE: { lat: 23.42, lng: 53.85 },
  EG: { lat: 26.82, lng: 30.8 },
};

/** Builds the unique set of scopes the polling loop needs to fetch. */
async function buildScopesToPoll(): Promise<ScopeKey[]> {
  const rules = await db
    .select()
    .from(weatherSurchargeRulesTable)
    .where(eq(weatherSurchargeRulesTable.active, true));
  if (rules.length === 0) return [];

  const out: ScopeKey[] = [];
  const seen = new Set<string>();

  // Service-area scopes first — we always have a polygon.
  const areaIds = Array.from(
    new Set(
      rules
        .filter((r) => r.scope === "service_area" && r.serviceAreaId)
        .map((r) => r.serviceAreaId as string),
    ),
  );
  if (areaIds.length > 0) {
    const areas = await db.select().from(serviceAreasTable);
    const byId = new Map(areas.map((a) => [a.id, a] as const));
    for (const id of areaIds) {
      const a = byId.get(id);
      if (!a) continue;
      const c = polygonCentroid(a.polygonJson);
      if (!c) continue;
      const key = `service_area:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ scope: key, lat: c.lat, lng: c.lng });
    }
  }

  // Country scopes — sample once per ISO code.
  const isoCodes = Array.from(
    new Set(
      rules
        .filter((r) => r.scope === "country" && r.countryIso)
        .map((r) => (r.countryIso as string).toUpperCase()),
    ),
  );
  if (isoCodes.length > 0) {
    const dbCountries = await db.select().from(countriesTable);
    const byIso = new Map(
      dbCountries.map((c) => [c.isoCode.toUpperCase(), c] as const),
    );
    for (const iso of isoCodes) {
      const key = `country:${iso}`;
      if (seen.has(key)) continue;
      // Prefer a real centroid from any service area in that country.
      const areas = await db
        .select()
        .from(serviceAreasTable)
        .where(eq(serviceAreasTable.country, byIso.get(iso)?.name ?? iso));
      let centroid: { lat: number; lng: number } | null = null;
      for (const a of areas) {
        centroid = polygonCentroid(a.polygonJson);
        if (centroid) break;
      }
      if (!centroid) centroid = COUNTRY_CENTROIDS[iso] ?? null;
      if (!centroid) continue;
      seen.add(key);
      out.push({ scope: key, lat: centroid.lat, lng: centroid.lng });
    }
  }

  return out;
}

async function fetchOpenWeather(
  apiKey: string,
  lat: number,
  lng: number,
): Promise<OpenWeatherResponse | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    units: "metric",
    appid: apiKey,
  });
  let res: Response;
  try {
    res = await fetch(`${OPENWEATHER_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn({ err, lat, lng }, "[weather] openweather fetch failed");
    return null;
  }
  if (!res.ok) {
    logger.warn(
      { status: res.status, lat, lng },
      "[weather] openweather non-2xx",
    );
    return null;
  }
  try {
    return (await res.json()) as OpenWeatherResponse;
  } catch (err) {
    logger.warn({ err }, "[weather] failed to parse openweather response");
    return null;
  }
}

/**
 * Polls OpenWeather for every active scope and writes a fresh row into
 * the readings cache. Idempotent and fail-safe — a network error on one
 * scope doesn't prevent the others from being updated.
 */
export async function pollWeather(): Promise<void> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    // Fail-safe: silently skip when the operator hasn't provisioned a key.
    return;
  }
  let scopes: ScopeKey[];
  try {
    scopes = await buildScopesToPoll();
  } catch (err) {
    logger.error({ err }, "[weather] failed to enumerate scopes");
    return;
  }
  if (scopes.length === 0) return;

  let okCount = 0;
  for (const s of scopes) {
    const payload = await fetchOpenWeather(apiKey, s.lat, s.lng);
    if (!payload || (payload.cod && Number(payload.cod) >= 400)) continue;
    const norm = normalize(payload);
    try {
      await db.insert(weatherReadingsCacheTable).values({
        scope: s.scope,
        lat: s.lat,
        lng: s.lng,
        ...norm,
      });
      okCount++;
    } catch (err) {
      logger.warn({ err, scope: s.scope }, "[weather] failed to cache reading");
    }
  }

  // Trim old readings — keep at most ~24h of history per scope.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(weatherReadingsCacheTable)
    .where(sql`${weatherReadingsCacheTable.fetchedAt} < ${cutoff}`)
    .catch(() => undefined);

  logger.info(
    { scopes: scopes.length, ok: okCount },
    "[weather] poll complete",
  );
}

function isInTimeWindow(
  rule: WeatherSurchargeRule,
  at: Date,
): boolean {
  const days = rule.daysOfWeek ?? [];
  if (days.length > 0 && !days.includes(at.getDay())) return false;
  const start = rule.startTime;
  const end = rule.endTime;
  if (!start || !end) return true;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return true;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin <= startMin) {
    // Wraps midnight (e.g. 22:00 → 04:00).
    return minutes >= startMin || minutes < endMin;
  }
  return minutes >= startMin && minutes < endMin;
}

/** Tests a reading against a rule's conditions. Returns the i18n reason
 * key for the matched condition or null when none match. */
function matchesConditions(
  conds: WeatherConditions,
  reading: WeatherReading,
): string | null {
  if (conds.rainMmGte != null && reading.rainMm >= conds.rainMmGte) return "heavyRain";
  if (conds.snowMmGte != null && reading.snowMm >= conds.snowMmGte) return "snow";
  if (conds.windMsGte != null && reading.windMs >= conds.windMsGte) return "highWind";
  if (conds.tempCGte != null && reading.tempC >= conds.tempCGte) return "extremeHeat";
  if (conds.tempCLte != null && reading.tempC <= conds.tempCLte) return "extremeCold";
  if (
    conds.weatherMain != null &&
    conds.weatherMain.length > 0 &&
    reading.weatherMain &&
    conds.weatherMain.includes(reading.weatherMain)
  ) {
    if (reading.weatherMain.toLowerCase() === "thunderstorm") return "thunderstorm";
    return reading.weatherMain.toLowerCase();
  }
  return null;
}

export interface ResolvedWeatherSurcharge {
  /** Multiplier to apply to (base+distance+time+peak+night) subtotal. 1 if rule is fixed. */
  multiplier: number;
  /** Fixed amount to add (in fare currency). 0 if rule is multiplier. */
  fixed: number;
  reason: string;
  ruleName: string;
  ruleId: string;
}

/**
 * Looks up the highest-value matching surcharge for a pickup point. Returns
 * null when no rule matches, no fresh reading exists, or the feature is
 * effectively disabled. Fail-safe by design — any error returns null so
 * pricing falls back to the no-surcharge path.
 */
export async function resolveWeatherSurcharge(
  lat: number | null | undefined,
  lng: number | null | undefined,
  at: Date = new Date(),
): Promise<ResolvedWeatherSurcharge | null> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  let rules: WeatherSurchargeRule[];
  try {
    rules = await db
      .select()
      .from(weatherSurchargeRulesTable)
      .where(eq(weatherSurchargeRulesTable.active, true));
  } catch {
    return null;
  }
  if (rules.length === 0) return null;

  // Resolve which scopes the pickup actually falls into.
  const matchingScopes = new Set<string>();

  // Service-area scope — point-in-polygon test.
  const areaIds = Array.from(
    new Set(
      rules
        .filter((r) => r.scope === "service_area" && r.serviceAreaId)
        .map((r) => r.serviceAreaId as string),
    ),
  );
  if (areaIds.length > 0) {
    const areas = await db.select().from(serviceAreasTable);
    const byId = new Map(areas.map((a) => [a.id, a] as const));
    for (const id of areaIds) {
      const area = byId.get(id);
      if (!area || !area.polygonJson) continue;
      try {
        if (pointInPolygon(lat, lng, area.polygonJson)) {
          matchingScopes.add(`service_area:${id}`);
        }
      } catch {
        // Ignore malformed polygons.
      }
    }
  }

  // Country scope — match by polygon containment first; fall back to "any
  // country rule" if there is exactly one active country rule. Pickup-side
  // reverse-geocoding is intentionally avoided to keep pricing offline.
  const countryRules = rules.filter((r) => r.scope === "country" && r.countryIso);
  if (countryRules.length > 0) {
    const allAreas = await db.select().from(serviceAreasTable);
    const dbCountries = await db.select().from(countriesTable);
    const isoToName = new Map(
      dbCountries.map((c) => [c.isoCode.toUpperCase(), c.name] as const),
    );
    for (const r of countryRules) {
      const iso = (r.countryIso as string).toUpperCase();
      const expectedName = isoToName.get(iso) ?? iso;
      const candidates = allAreas.filter(
        (a) => a.country && a.country.toLowerCase() === expectedName.toLowerCase(),
      );
      const inside = candidates.some((a) => {
        if (!a.polygonJson) return false;
        try {
          return pointInPolygon(lat, lng, a.polygonJson);
        } catch {
          return false;
        }
      });
      if (inside) matchingScopes.add(`country:${iso}`);
    }
  }

  if (matchingScopes.size === 0) return null;

  // Fetch the latest fresh reading per matching scope.
  const cutoff = new Date(Date.now() - WEATHER_MAX_STALE_MS);
  const scopeArr = Array.from(matchingScopes);
  let readings: WeatherReading[] = [];
  try {
    readings = await db
      .select()
      .from(weatherReadingsCacheTable)
      .where(
        and(
          gte(weatherReadingsCacheTable.fetchedAt, cutoff),
          sql`${weatherReadingsCacheTable.scope} = ANY(${scopeArr})`,
        ),
      )
      .orderBy(desc(weatherReadingsCacheTable.fetchedAt));
  } catch {
    return null;
  }

  const latestByScope = new Map<string, WeatherReading>();
  for (const r of readings) {
    if (!latestByScope.has(r.scope)) latestByScope.set(r.scope, r);
  }
  if (latestByScope.size === 0) return null;

  // Pick the highest-effective matching rule.
  let best: ResolvedWeatherSurcharge | null = null;
  let bestScore = 0;

  for (const rule of rules) {
    const scopeKey =
      rule.scope === "country"
        ? `country:${(rule.countryIso ?? "").toUpperCase()}`
        : `service_area:${rule.serviceAreaId ?? ""}`;
    if (!matchingScopes.has(scopeKey)) continue;
    if (!isInTimeWindow(rule, at)) continue;
    const reading = latestByScope.get(scopeKey);
    if (!reading) continue;
    const reason = matchesConditions(rule.conditions ?? {}, reading);
    if (!reason) continue;

    const isMultiplier = rule.kind === "multiplier";
    const candidate: ResolvedWeatherSurcharge = {
      multiplier: isMultiplier ? Math.max(1, rule.value) : 1,
      fixed: isMultiplier ? 0 : Math.max(0, rule.value),
      reason,
      ruleName: rule.name,
      ruleId: rule.id,
    };
    // Compare on a normalized scale so multiplier and fixed rules are
    // ranked consistently — multiplier "score" = (m-1)*100, fixed = value.
    const score = isMultiplier ? (candidate.multiplier - 1) * 100 : candidate.fixed;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

// Re-export the unused symbol so dead-code elimination doesn't drop it
// from a strict build.
export { isNotNull };
