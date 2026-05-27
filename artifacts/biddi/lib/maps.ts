import { Linking, Platform } from "react-native";
import { api } from "./api";

export interface AutocompleteResult {
  placeId: string;
  primary: string;
  secondary: string;
}

export interface PlaceDetailsResult {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  primary: string;
}

export interface ReverseResult {
  address: string;
  primary: string;
}

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  polyline: string;
}

export async function fetchAutocomplete(
  q: string,
  bias?: { lat: number; lng: number },
  session?: string,
): Promise<AutocompleteResult[]> {
  const params = new URLSearchParams({ q });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lng", String(bias.lng));
  }
  if (session) params.set("session", session);
  const r = await api<{ results: AutocompleteResult[] }>(
    `/maps/autocomplete?${params.toString()}`,
  );
  return r.results;
}

export async function fetchPlaceDetails(
  placeId: string,
  session?: string,
): Promise<PlaceDetailsResult | null> {
  try {
    const qs = session ? `?session=${encodeURIComponent(session)}` : "";
    const r = await api<{ place: PlaceDetailsResult }>(
      `/maps/place/${encodeURIComponent(placeId)}${qs}`,
    );
    return r.place;
  } catch {
    return null;
  }
}

/** Generate a Google-compatible session token (UUID v4-ish). */
export function newSessionToken(): string {
  // Don't depend on crypto.randomUUID — RN doesn't have it everywhere.
  let s = "";
  for (let i = 0; i < 32; i++) {
    const r = Math.floor(Math.random() * 16);
    s += r.toString(16);
  }
  return s;
}

export async function fetchReverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseResult | null> {
  try {
    const r = await api<{ result: ReverseResult }>(
      `/maps/reverse?lat=${lat}&lng=${lng}`,
    );
    return r.result;
  } catch {
    return null;
  }
}

export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<RouteResult | null> {
  try {
    const r = await api<{ route: RouteResult }>(
      `/maps/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`,
    );
    return r.route;
  } catch {
    return null;
  }
}

export interface NavDestination {
  lat: number;
  lng: number;
  label?: string;
}

/**
 * Returns which external navigation apps are available on the device.
 * On Android, Google Maps is always considered available because `openNavApp`
 * falls back to the Google Maps web URL when the native app is not installed.
 * Apple Maps is only offered on iOS.
 * Waze is shown only when the native app is installed (no web fallback).
 */
export async function checkNavApps(): Promise<{ google: boolean; apple: boolean; waze: boolean }> {
  if (Platform.OS !== "ios") {
    // Android: Google is always reachable (native app or web fallback). No Apple Maps.
    const waze = await Linking.canOpenURL("waze://").catch(() => false);
    return { google: true, apple: false, waze: waze as boolean };
  }
  const [google, apple, waze] = await Promise.all([
    Linking.canOpenURL("comgooglemaps://").catch(() => false),
    Linking.canOpenURL("maps://").catch(() => false),
    Linking.canOpenURL("waze://").catch(() => false),
  ]);
  return { google: google as boolean, apple: apple as boolean, waze: waze as boolean };
}

/**
 * Opens the specified navigation app with directions to the given destination.
 * For Google Maps, falls back to the web URL if the native app is not installed (Android).
 * Waze requires the native app to be installed — callers should guard with `checkNavApps`.
 */
export async function openNavApp(
  app: "google" | "apple" | "waze",
  dest: NavDestination,
): Promise<void> {
  if (app === "google") {
    const nativeAvailable = await Linking.canOpenURL("comgooglemaps://").catch(() => false);
    if (nativeAvailable) {
      const q = dest.label ? `&q=${encodeURIComponent(dest.label)}` : "";
      await Linking.openURL(
        `comgooglemaps://?daddr=${dest.lat},${dest.lng}${q}&directionsmode=driving`,
      );
    } else {
      await Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`,
      );
    }
  } else if (app === "waze") {
    await Linking.openURL(`waze://?ll=${dest.lat},${dest.lng}&navigate=yes`);
  } else {
    await Linking.openURL(`maps://?daddr=${dest.lat},${dest.lng}&dirflg=d`);
  }
}

/**
 * Decode a Google encoded polyline into a list of {latitude, longitude}.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(
  encoded: string,
): { latitude: number; longitude: number }[] {
  if (!encoded) return [];
  const coords: { latitude: number; longitude: number }[] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}
