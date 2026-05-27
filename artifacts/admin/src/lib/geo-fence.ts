// All known type values, including legacy ones we still need to render if a
// row already uses them. New rows should only ever use types in
// GEO_FENCE_TYPES_VISIBLE below.
export const GEO_FENCE_TYPES_ALL = [
  "service_area",
  "restricted_area",
  "pricing_zone",
  "location_wise_fare",
  "airport_surcharge",
  "vehicle_service_type",
] as const;

export type GeoFenceType = (typeof GEO_FENCE_TYPES_ALL)[number];

// Types shown in admin "Location For" pickers and category filters. The
// legacy `pricing_zone` is hidden because the seed migrates it to
// `location_wise_fare` on boot.
export const GEO_FENCE_TYPES = [
  "service_area",
  "restricted_area",
  "location_wise_fare",
  "airport_surcharge",
  "vehicle_service_type",
] as const satisfies readonly GeoFenceType[];

export const GEO_FENCE_TYPE_LABELS: Record<GeoFenceType, string> = {
  service_area: "Service Area",
  restricted_area: "Restricted Area",
  pricing_zone: "Pricing Zone",
  location_wise_fare: "Location Wise Fare",
  airport_surcharge: "Airport Surcharge",
  vehicle_service_type: "Vehicle/Service Type",
};

export const GEO_FENCE_TYPE_COLORS: Record<GeoFenceType, string> = {
  service_area: "bg-green-100 text-green-700",
  restricted_area: "bg-red-100 text-red-700",
  pricing_zone: "bg-blue-100 text-blue-700",
  location_wise_fare: "bg-indigo-100 text-indigo-700",
  airport_surcharge: "bg-amber-100 text-amber-700",
  vehicle_service_type: "bg-purple-100 text-purple-700",
};

export interface GeoFenceLocation {
  id: string;
  name: string;
  country: string;
  type: GeoFenceType;
  polygonJson: string | null;
  active: boolean;
  createdAt: string;
}

export interface CountryRow {
  id: string;
  name: string;
  isoCode: string;
  active: boolean;
  createdAt: string;
}

/**
 * Convert an ISO 3166-1 alpha-2 country code (e.g. "MA") into its
 * regional-indicator flag emoji (e.g. "🇲🇦"). Returns an empty string for
 * codes that are not exactly two ASCII letters so non-standard or malformed
 * entries don't render as garbage glyphs.
 */
export function countryFlagEmoji(isoCode: string | null | undefined): string {
  if (!isoCode) return "";
  const code = isoCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x41;
  const BASE = 0x1f1e6;
  return String.fromCodePoint(
    BASE + (code.charCodeAt(0) - A),
    BASE + (code.charCodeAt(1) - A),
  );
}
