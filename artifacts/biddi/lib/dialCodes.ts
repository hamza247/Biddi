// Curated list of country dial codes for the signup phone picker. Morocco is
// the default; the rest are sorted by name. Flags are rendered separately by
// the picker via the local `CountryFlag` component, which loads bundled PNGs
// from `assets/flags/` keyed off the ISO 3166-1 alpha-2 code below.
export interface DialCode {
  iso2: string;
  name: string;
  dial: string;
}

/** Resolve a `DialCode` from a 2-letter ISO 3166-1 region code (e.g. "MA").
 * Falls back to `null` if the region isn't in our curated list, leaving the
 * caller free to apply its own default. */
export function findDialByIso2(iso2: string | null | undefined): DialCode | null {
  if (!iso2) return null;
  const upper = iso2.toUpperCase();
  return DIAL_CODES.find((d) => d.iso2 === upper) ?? null;
}

const RAW: DialCode[] = [
  { iso2: "MA", name: "Morocco", dial: "+212" },
  { iso2: "DZ", name: "Algeria", dial: "+213" },
  { iso2: "TN", name: "Tunisia", dial: "+216" },
  { iso2: "EG", name: "Egypt", dial: "+20" },
  { iso2: "SA", name: "Saudi Arabia", dial: "+966" },
  { iso2: "AE", name: "United Arab Emirates", dial: "+971" },
  { iso2: "QA", name: "Qatar", dial: "+974" },
  { iso2: "KW", name: "Kuwait", dial: "+965" },
  { iso2: "BH", name: "Bahrain", dial: "+973" },
  { iso2: "OM", name: "Oman", dial: "+968" },
  { iso2: "JO", name: "Jordan", dial: "+962" },
  { iso2: "LB", name: "Lebanon", dial: "+961" },
  { iso2: "TR", name: "Türkiye", dial: "+90" },
  { iso2: "FR", name: "France", dial: "+33" },
  { iso2: "ES", name: "Spain", dial: "+34" },
  { iso2: "IT", name: "Italy", dial: "+39" },
  { iso2: "DE", name: "Germany", dial: "+49" },
  { iso2: "NL", name: "Netherlands", dial: "+31" },
  { iso2: "BE", name: "Belgium", dial: "+32" },
  { iso2: "PT", name: "Portugal", dial: "+351" },
  { iso2: "GB", name: "United Kingdom", dial: "+44" },
  { iso2: "IE", name: "Ireland", dial: "+353" },
  { iso2: "CH", name: "Switzerland", dial: "+41" },
  { iso2: "SE", name: "Sweden", dial: "+46" },
  { iso2: "NO", name: "Norway", dial: "+47" },
  { iso2: "DK", name: "Denmark", dial: "+45" },
  { iso2: "US", name: "United States", dial: "+1" },
  { iso2: "CA", name: "Canada", dial: "+1" },
  { iso2: "MX", name: "Mexico", dial: "+52" },
  { iso2: "BR", name: "Brazil", dial: "+55" },
  { iso2: "AR", name: "Argentina", dial: "+54" },
  { iso2: "CL", name: "Chile", dial: "+56" },
  { iso2: "CO", name: "Colombia", dial: "+57" },
  { iso2: "ZA", name: "South Africa", dial: "+27" },
  { iso2: "NG", name: "Nigeria", dial: "+234" },
  { iso2: "KE", name: "Kenya", dial: "+254" },
  { iso2: "GH", name: "Ghana", dial: "+233" },
  { iso2: "SN", name: "Senegal", dial: "+221" },
  { iso2: "CI", name: "Côte d'Ivoire", dial: "+225" },
  { iso2: "ML", name: "Mali", dial: "+223" },
  { iso2: "MR", name: "Mauritania", dial: "+222" },
  { iso2: "IN", name: "India", dial: "+91" },
  { iso2: "PK", name: "Pakistan", dial: "+92" },
  { iso2: "BD", name: "Bangladesh", dial: "+880" },
  { iso2: "ID", name: "Indonesia", dial: "+62" },
  { iso2: "MY", name: "Malaysia", dial: "+60" },
  { iso2: "PH", name: "Philippines", dial: "+63" },
  { iso2: "SG", name: "Singapore", dial: "+65" },
  { iso2: "TH", name: "Thailand", dial: "+66" },
  { iso2: "VN", name: "Vietnam", dial: "+84" },
  { iso2: "CN", name: "China", dial: "+86" },
  { iso2: "JP", name: "Japan", dial: "+81" },
  { iso2: "KR", name: "South Korea", dial: "+82" },
  { iso2: "AU", name: "Australia", dial: "+61" },
  { iso2: "NZ", name: "New Zealand", dial: "+64" },
];

export const DIAL_CODES: DialCode[] = RAW;

export const DEFAULT_DIAL_CODE: DialCode =
  RAW.find((c) => c.iso2 === "MA") ?? RAW[0];

export function findDialByCode(dial: string): DialCode | undefined {
  return RAW.find((c) => c.dial === dial);
}
