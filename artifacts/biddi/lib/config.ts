import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { api } from "./api";

export type MapProvider = "google" | "osm";

export interface PublicConfig {
  // Per-platform Google Maps keys. Each is independently restricted in Google
  // Cloud (Web→referrer, iOS→bundle ID, Android→SHA-1). The server applies
  // a fallback to the admin's generic "server" key when a platform key is
  // empty, so the field already contains the correct value to use — clients
  // just pick the field matching Platform.OS via getPlatformMapsKey().
  googleMapsApiKeyWeb: string;
  googleMapsApiKeyIos: string;
  googleMapsApiKeyAndroid: string;
  // Boolean signal — true when the admin has configured a server key, used by
  // screens that need to know whether server-side Google proxy endpoints
  // (autocomplete/geocode) are usable, without exposing the actual key value.
  hasServerMapsKey: boolean;
  smsMode: string;
  mapProviderAutocomplete: MapProvider;
  mapProviderGeocode: MapProvider;
  mapProviderRouting: MapProvider;
  // Driver app feature flags
  driverEtaLabelsEnabled: boolean;
  // Real-time surge heatmap
  heatmapEnabled: boolean;
  heatmapRefreshSeconds: number;
  heatmapLabelMode: "multiplier" | "bonus" | "off";
  heatmapBonusBase: number;
  // Currency configured by the platform admin for rider/driver-facing
  // displays. The internal accounting currency is always USD; this is
  // applied at the presentation layer only.
  displayCurrency: string;
  displaySymbol: string;
  // Formatting rules the operator chose for the display currency.
  // Mobile apps must apply these so amounts render exactly the way the
  // admin configured them (e.g. `10,00 MAD` vs `$10.00`). Optional so
  // older API servers (without these fields) still parse cleanly — the
  // `formatCurrency` helper falls back to comma/dot/before/2dp when
  // any field is missing.
  displayDecimalPlaces?: number;
  displaySymbolPosition?: "before" | "after";
  displayThousandsSeparator?: "comma" | "dot" | "space";
  displayDecimalSeparator?: "dot" | "comma";
  // USD → displayCurrency multiplier. Clients multiply USD-denominated
  // numeric values (bid amounts, fare breakdown line items) by this to
  // render the converted amount that pairs with `displaySymbol`. 1 when
  // the rate is unknown.
  displayRate: number;
}

const FALLBACK: PublicConfig = {
  googleMapsApiKeyWeb: "",
  googleMapsApiKeyIos: "",
  googleMapsApiKeyAndroid: "",
  hasServerMapsKey: false,
  smsMode: "demo_fixed",
  mapProviderAutocomplete: "google",
  mapProviderGeocode: "google",
  mapProviderRouting: "google",
  driverEtaLabelsEnabled: true,
  heatmapEnabled: true,
  heatmapRefreshSeconds: 15,
  heatmapLabelMode: "multiplier",
  heatmapBonusBase: 2,
  displayCurrency: "USD",
  displaySymbol: "$",
  displayDecimalPlaces: 2,
  displaySymbolPosition: "before",
  displayThousandsSeparator: "comma",
  displayDecimalSeparator: "dot",
  displayRate: 1,
};

/**
 * Returns the right Google Maps API key for the current platform. The server
 * already applies fallback to the generic server key (when a platform key is
 * empty) before returning the response, so we just pick the matching field.
 */
export function getPlatformMapsKey(cfg: PublicConfig): string {
  if (Platform.OS === "web") return cfg.googleMapsApiKeyWeb || "";
  if (Platform.OS === "ios") return cfg.googleMapsApiKeyIos || "";
  if (Platform.OS === "android") return cfg.googleMapsApiKeyAndroid || "";
  return "";
}

let cache: PublicConfig | null = null;
const listeners = new Set<(cfg: PublicConfig) => void>();

export async function loadConfig(force = false): Promise<PublicConfig> {
  if (cache && !force) return cache;
  try {
    // Tolerate the legacy "googleMapsApiKey" field shape from older API
    // server deployments — derive hasServerMapsKey from it if the newer
    // explicit boolean isn't present in the response.
    const r = await api<Partial<PublicConfig> & { googleMapsApiKey?: string }>(
      "/config/public",
    );
    const merged = { ...FALLBACK, ...r } as PublicConfig;
    if (typeof r.hasServerMapsKey !== "boolean") {
      merged.hasServerMapsKey = !!r.googleMapsApiKey;
    }
    cache = merged;
    listeners.forEach((l) => l(cache!));
    return cache;
  } catch {
    if (!cache) cache = FALLBACK;
    return cache;
  }
}

export function useConfig(opts?: { refreshOnMount?: boolean }): PublicConfig {
  const [cfg, setCfg] = useState<PublicConfig>(cache ?? FALLBACK);
  useEffect(() => {
    listeners.add(setCfg);
    // refreshOnMount=true forces a fresh fetch on every mount, even if a
    // cache exists. Use this on screens where stale config would block the
    // user (e.g. destination search rejects searches when maps appear
    // unconfigured).
    if (!cache || opts?.refreshOnMount) loadConfig(true);
    else setCfg(cache);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") loadConfig(true);
    });
    return () => {
      listeners.delete(setCfg);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return cfg;
}

export function isMapsConfigured(): boolean {
  if (!cache) return false;
  // The base map is standardized to Google Roadmap, so a platform key is
  // required (the server has already applied fallback from the generic
  // server key when a platform key is empty).
  return !!getPlatformMapsKey(cache);
}
