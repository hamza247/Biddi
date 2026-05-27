import { Audio, AVPlaybackSource } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { api, getBaseUrl } from "./api";

/**
 * Resolve a sound URL from the manifest to an absolute URL the native
 * downloader can fetch. The server returns relative paths like
 * `/api/storage/objects/...`; expo-file-system requires absolute URIs on
 * native, so we prefix the configured API base when needed.
 */
export function resolveSoundUrl(url: string, base: string = getBaseUrl()): string {
  if (/^https?:\/\//i.test(url)) return url;
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = url.startsWith("/") ? url : `/${url}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * In-app notification sound playback.
 *
 * Three resolution tiers, in order:
 *   1. Reserved bundled preset slugs (default, chime, ping, ringtone, alert,
 *      horn) — always available because the audio files ship with the app.
 *   2. Uploaded library sounds — downloaded from object storage on first use,
 *      cached on disk under `${cacheDirectory}biddi-sounds/`, then played via
 *      expo-av. Cache invalidates when the slug or checksum changes.
 *   3. Fallback to the bundled `default` preset if any step above fails
 *      (manifest unreachable, network error, slug not found, etc.) so the
 *      user still hears something audible for incoming requests.
 */

export type SoundCategory =
  | "newTripRequest"
  | "driverApp"
  | "userApp"
  | "voipCalling";

interface ManifestEntry {
  slug: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  url: string;
}

interface ActiveResponse {
  active: Record<SoundCategory, string>;
  manifestHash: string;
  sounds: ManifestEntry[];
}

/**
 * Reserved slugs that always resolve to bundled native asset files. These
 * survive a fresh install with no network access and act as the audible
 * fallback when uploaded sound resolution fails.
 */
const RESERVED_PRESETS: Record<string, AVPlaybackSource> = {
  default: require("../assets/sounds/default.wav"),
  chime: require("../assets/sounds/chime.wav"),
  ping: require("../assets/sounds/ping.wav"),
  ringtone: require("../assets/sounds/ringtone.wav"),
  alert: require("../assets/sounds/alert.wav"),
  horn: require("../assets/sounds/horn.wav"),
};

let manifestCache: { fetchedAt: number; data: ActiveResponse } | null = null;
const MANIFEST_TTL_MS = 60_000;

async function getActive(): Promise<ActiveResponse | null> {
  if (manifestCache && Date.now() - manifestCache.fetchedAt < MANIFEST_TTL_MS) {
    return manifestCache.data;
  }
  try {
    const data = await api<ActiveResponse>("/notification-sounds/active");
    manifestCache = { fetchedAt: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}

function cacheDir(): string {
  const base = FileSystem.cacheDirectory ?? "";
  return `${base}biddi-sounds/`;
}

async function ensureCacheDir(): Promise<void> {
  const dir = cacheDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function downloadSound(entry: ManifestEntry): Promise<string | null> {
  try {
    await ensureCacheDir();
    const safeSlug = entry.slug.replace(/[^a-z0-9_-]/gi, "_");
    const file = `${cacheDir()}${safeSlug}-${entry.checksum.slice(0, 16)}`;
    const info = await FileSystem.getInfoAsync(file);
    if (info.exists) return file;
    const result = await FileSystem.downloadAsync(resolveSoundUrl(entry.url), file);
    if (result.status >= 200 && result.status < 300) return file;
    return null;
  } catch {
    return null;
  }
}

let currentSound: Audio.Sound | null = null;

async function unloadCurrent(): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.unloadAsync();
    } catch {
      /* ignore */
    }
    currentSound = null;
  }
}

async function playSource(source: AVPlaybackSource, loop: boolean): Promise<boolean> {
  try {
    await unloadCurrent();
    const { sound } = await Audio.Sound.createAsync(source, {
      isLooping: loop,
      shouldPlay: true,
    });
    currentSound = sound;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the slug currently assigned to `category`, then play it. Bundled
 * preset slugs play instantly from the app bundle. Uploaded library slugs are
 * downloaded once and cached. Any failure falls back to the bundled `default`
 * preset so the user always hears something audible. Returns true when
 * playback started.
 */
export async function playCategorySound(
  category: SoundCategory,
  loop = false,
): Promise<boolean> {
  const active = await getActive();
  const slug = active?.active[category] ?? "default";

  // Tier 1: bundled reserved presets always work, even offline.
  if (slug in RESERVED_PRESETS) {
    return playSource(RESERVED_PRESETS[slug], loop);
  }

  // Tier 2: uploaded library sound.
  const entry = active?.sounds.find((s) => s.slug === slug);
  if (entry) {
    const localPath = await downloadSound(entry);
    if (localPath && (await playSource({ uri: localPath }, loop))) {
      return true;
    }
  }

  // Tier 3: audible fallback to the bundled default.
  return playSource(RESERVED_PRESETS.default, loop);
}

export async function stopCategorySound(): Promise<void> {
  await unloadCurrent();
}

/**
 * Force a fresh manifest fetch on next playback. Call after the user changes
 * accounts or returns from background, so updated admin assignments take
 * effect without waiting out the TTL.
 */
export function invalidateSoundManifest(): void {
  manifestCache = null;
}
