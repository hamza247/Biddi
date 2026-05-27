import { logger } from "./logger";
import { getConfig } from "./settings";

// Biddi maps stack: Google Places + Geocoding for autocomplete / place
// details / forward+reverse geocoding, OSRM for routing geometry. All other
// providers (MapTiler, Nominatim, CARTO Voyager) have been removed; if
// Google isn't configured, geocoding endpoints return null/empty arrays so
// callers can fail gracefully.

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return e.value as T;
}
function setCached<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  if (cache.size > 500) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

export async function getApiKey(): Promise<string> {
  const cfg = await getConfig();
  return cfg.googleMapsApiKey || "";
}

export interface AutocompleteResult {
  placeId: string;
  primary: string;
  secondary: string;
}

// ----- Encode Google polyline (1e5 precision) -------------------------------
// Used to re-encode OSRM GeoJSON coordinates into the polyline format the
// mobile + admin clients consume. OSRM already returns this format when
// `geometries=polyline` is requested; the encoder is kept for any future
// provider that returns GeoJSON instead.
function encodePolyline(coords: [number, number][]): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of coords) {
    for (const raw of [
      Math.round((lat - prevLat) * 1e5),
      Math.round((lng - prevLng) * 1e5),
    ]) {
      let v = raw < 0 ? ~(raw << 1) : raw << 1;
      while (v >= 0x20) {
        output += String.fromCharCode(((0x20 | (v & 0x1f)) + 63));
        v >>= 5;
      }
      output += String.fromCharCode(v + 63);
    }
    prevLat = lat;
    prevLng = lng;
  }
  return output;
}
void encodePolyline;

// ----- Autocomplete (Google only) ------------------------------------------
export async function autocomplete(
  query: string,
  bias?: { lat: number; lng: number },
  sessionToken?: string,
): Promise<AutocompleteResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cfg = await getConfig();
  const key = cfg.googleMapsApiKey;
  if (!key) {
    logger.warn("[maps] autocomplete called but googleMapsApiKey is unset");
    return [];
  }

  const biasKey = bias ? `${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}` : "";
  const cacheKey = `ac:google:${sessionToken ?? "_"}:${q.toLowerCase()}:${biasKey}`;
  const hit = getCached<AutocompleteResult[]>(cacheKey);
  if (hit) return hit;
  try {
    const out = await autocompleteGoogle(q, bias, sessionToken, key);
    setCached(cacheKey, out, 60_000);
    return out;
  } catch (err) {
    logger.warn({ err }, "[maps] google autocomplete failed");
    return [];
  }
}

async function autocompleteGoogle(
  q: string,
  bias: { lat: number; lng: number } | undefined,
  sessionToken: string | undefined,
  key: string,
): Promise<AutocompleteResult[]> {
  if (!key) throw new Error("Google Maps API key not configured");

  type GoogleResponse = {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string;
        structuredFormat?: {
          mainText?: { text: string };
          secondaryText?: { text: string };
        };
        text?: { text: string };
      };
    }>;
    error?: { message?: string };
  };

  const fetchGoogle = async (withBias: boolean): Promise<AutocompleteResult[]> => {
    const body: Record<string, unknown> = { input: q };
    if (sessionToken) body.sessionToken = sessionToken;
    if (withBias && bias) {
      body.locationBias = {
        circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 150000 },
      };
    }
    const r = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify(body),
      },
    );
    const data = (await r.json()) as GoogleResponse;
    if (!r.ok) {
      logger.warn({ status: r.status, err: data.error }, "[maps] google autocomplete failed");
      throw new Error(`Google Places returned ${r.status}`);
    }
    const out: AutocompleteResult[] = [];
    for (const s of data.suggestions ?? []) {
      const p = s.placePrediction;
      if (!p) continue;
      out.push({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      });
    }
    return out;
  };

  const biased = await fetchGoogle(true);
  if (biased.length === 0 && bias) {
    const fallback = await fetchGoogle(false);
    return fallback.slice(0, 8);
  }
  return biased.slice(0, 8);
}

// ----- Place details (Google only) -----------------------------------------
export interface PlaceDetails {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  primary: string;
}

export async function placeDetails(
  placeId: string,
  sessionToken?: string,
): Promise<PlaceDetails | null> {
  const cfg = await getConfig();
  const key = cfg.googleMapsApiKey;
  if (!key) return null;
  const cacheKey = `pd:${placeId}`;
  const hit = getCached<PlaceDetails>(cacheKey);
  if (hit) return hit;
  try {
    const sessionParam = sessionToken
      ? `?sessionToken=${encodeURIComponent(sessionToken)}`
      : "";
    const r = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${sessionParam}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "id,formattedAddress,location,displayName",
        },
      },
    );
    const data = (await r.json()) as {
      id?: string;
      formattedAddress?: string;
      displayName?: { text?: string };
      location?: { latitude?: number; longitude?: number };
    };
    if (!r.ok || !data.location) return null;
    const out: PlaceDetails = {
      placeId: data.id ?? placeId,
      address: data.formattedAddress ?? "",
      lat: data.location.latitude!,
      lng: data.location.longitude!,
      primary: data.displayName?.text ?? data.formattedAddress ?? "",
    };
    setCached(cacheKey, out, 24 * 60 * 60_000);
    return out;
  } catch (err) {
    logger.warn({ err }, "[maps] place details threw");
    return null;
  }
}

// ----- Reverse geocode (Google only) ---------------------------------------
export interface ReverseGeocodeResult {
  address: string;
  primary: string;
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult | null> {
  const cfg = await getConfig();
  const key = cfg.googleMapsApiKey;
  if (!key) return null;
  const cacheKey = `rg:google:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = getCached<ReverseGeocodeResult>(cacheKey);
  if (hit) return hit;
  const out = await reverseGoogle(lat, lng, key);
  if (out) setCached(cacheKey, out, 5 * 60_000);
  return out;
}

async function reverseGoogle(
  lat: number,
  lng: number,
  key: string,
): Promise<ReverseGeocodeResult | null> {
  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(key)}`,
    );
    const data = (await r.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        address_components?: Array<{ long_name: string; types: string[] }>;
      }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    const top = data.results[0];
    const formatted = top.formatted_address ?? "";
    const comps = top.address_components ?? [];
    const route = comps.find((c) => c.types.includes("route"))?.long_name ?? "";
    const num = comps.find((c) => c.types.includes("street_number"))?.long_name ?? "";
    const primary = num ? `${num} ${route}` : route || formatted.split(",")[0];
    return { address: formatted, primary: primary || "Current location" };
  } catch (err) {
    logger.warn({ err }, "[maps] google reverse threw");
    return null;
  }
}

// ----- Forward geocode (Google only) ---------------------------------------
export async function forwardGeocode(
  address: string,
): Promise<{ address: string; lat: number; lng: number } | null> {
  const cfg = await getConfig();
  const key = cfg.googleMapsApiKey;
  if (!key) return null;
  const cacheKey = `fg:google:${address.toLowerCase()}`;
  const hit = getCached<{ address: string; lat: number; lng: number }>(cacheKey);
  if (hit) return hit;
  const out = await forwardGoogle(address, key);
  if (out) setCached(cacheKey, out, 24 * 60 * 60_000);
  return out;
}

async function forwardGoogle(
  address: string,
  key: string,
): Promise<{ address: string; lat: number; lng: number } | null> {
  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`,
    );
    const data = (await r.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    const top = data.results[0];
    const loc = top.geometry?.location;
    if (loc?.lat == null || loc?.lng == null) return null;
    return { address: top.formatted_address ?? address, lat: loc.lat, lng: loc.lng };
  } catch (err) {
    logger.warn({ err }, "[maps] google forward threw");
    return null;
  }
}

// ----- Routing (OSRM only) -------------------------------------------------
export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  polyline: string; // encoded polyline (Google 1e5 format)
}

const OSRM_DEFAULT_BASE = "https://router.project-osrm.org";

export async function osrmRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<RouteResult | null> {
  const cfg = await getConfig();
  const base = process.env.OSRM_BASE_URL || cfg.osmRoutingUrl || OSRM_DEFAULT_BASE;
  const k = (n: number) => n.toFixed(4);
  const cacheKey = `route:osrm:${k(from.lat)},${k(from.lng)}|${k(to.lat)},${k(to.lng)}`;
  const hit = getCached<RouteResult>(cacheKey);
  if (hit) return hit;
  const out = await routeOsrm(from, to, base);
  if (out) setCached(cacheKey, out, 5 * 60_000);
  return out;
}

async function routeOsrm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  base: string,
): Promise<RouteResult | null> {
  try {
    const url =
      `${base.replace(/\/$/, "")}/route/v1/driving/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=polyline`;
    const r = await fetch(url);
    const data = (await r.json()) as {
      code?: string;
      routes?: Array<{ distance: number; duration: number; geometry: string }>;
    };
    if (data.code !== "Ok" || !data.routes?.length) return null;
    const top = data.routes[0];
    return {
      distanceKm: Math.round((top.distance / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.round(top.duration / 60)),
      polyline: top.geometry,
    };
  } catch (err) {
    logger.warn({ err }, "[maps] osrm route threw");
    return null;
  }
}
