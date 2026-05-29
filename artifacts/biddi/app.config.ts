import * as fs from "node:fs";
import * as path from "node:path";
import type { ExpoConfig } from "expo/config";
import { withAndroidManifest } from "expo/config-plugins";

const googleMapsKeyIos = process.env.GOOGLE_API_KEY ?? "";
const googleMapsKeyAndroid = process.env.GOOGLE_API_ANDROID_KEY ?? "";

// Maps stack: Google only (MapTiler/CARTO/Nominatim removed). When the
// platform Google Maps key is missing the map falls back to the raw
// OpenStreetMap tile server inside the Leaflet web fallback.


/**
 * Notification sound files written by `pnpm --filter biddi run sync-sounds`.
 * Each entry is a relative path the expo-notifications plugin will bundle into
 * the iOS bundle and android/app/src/main/res/raw/ at build time.
 */
const RESERVED_PRESET_SOUND_FILES = [
  "./assets/sounds/biddi_default.wav",
  "./assets/sounds/chime.wav",
  "./assets/sounds/ping.wav",
  "./assets/sounds/ringtone.wav",
  "./assets/sounds/alert.wav",
  "./assets/sounds/horn.wav",
];

function loadCustomNotificationSounds(): string[] {
  try {
    const manifestPath = path.resolve(__dirname, "assets/sounds/sounds-manifest.json");
    if (!fs.existsSync(manifestPath)) return [];
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      sounds?: { file: string }[];
    };
    return (data.sounds ?? []).map((s) => s.file);
  } catch {
    return [];
  }
}
// Always bundle the six reserved presets plus any admin-uploaded sounds the
// sync script wrote to assets/sounds-manifest.json. expo-notifications copies
// these into the iOS bundle and android/app/src/main/res/raw/ so they are
// available as OS push-notification sounds.
const allNotificationSounds = [
  ...RESERVED_PRESET_SOUND_FILES,
  ...loadCustomNotificationSounds(),
];

const config: ExpoConfig = {
  name: "Biddi",
  slug: "biddi",
  version: "2.2.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "biddi",
  userInterfaceStyle: "light",
  newArchEnabled: false,
  jsEngine: "jsc",
  splash: {
    image: "./assets/images/icon.png",
    resizeMode: "contain",
    backgroundColor: "#3819A6",
  },
  ios: {
    bundleIdentifier: "com.hamza.customer",
    supportsTablet: false,
    config: {
      usesNonExemptEncryption: false,
      ...(googleMapsKeyIos ? { googleMapsApiKey: googleMapsKeyIos } : {}),
    },
    infoPlist: {
      NSMicrophoneUsageDescription: "Biddi needs microphone access to record voice messages during trips.",
      NSSpeechRecognitionUsageDescription: "Biddi uses speech recognition so you can book rides by voice.",
      NSPhotoLibraryUsageDescription: "Biddi needs photo library access to share images in trip chat.",
      LSApplicationQueriesSchemes: ["comgooglemaps", "waze"],
    },
  },
  android: {
    package: "product.customer.biddi",
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "RECORD_AUDIO", "READ_MEDIA_IMAGES", "READ_EXTERNAL_STORAGE"],
    config: googleMapsKeyAndroid
      ? { googleMaps: { apiKey: googleMapsKeyAndroid } }
      : undefined,
  },
  web: {
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    [
      "expo-router",
      {
        origin: "https://replit.com/",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission: "Allow Biddi to use your location.",
        locationWhenInUsePermission: "Allow Biddi to use your location to find nearby drivers.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/icon.png",
        color: "#3819A6",
        sounds: allNotificationSounds,
      },
    ],
    "expo-speech-recognition",
    "expo-font",
    "expo-web-browser",
    (cfg: ExpoConfig) =>
      withAndroidManifest(cfg, (mod) => {
        const manifest = mod.modResults.manifest;
        if (!manifest.queries) {
          manifest.queries = [];
        }
        const hasWaze = manifest.queries.some(
          (q) =>
            Array.isArray((q as { intent?: unknown[] }).intent) &&
            (q as { intent: { data?: { $?: { "android:scheme"?: string } }[] }[] }).intent.some(
              (intent) =>
                Array.isArray(intent.data) &&
                intent.data.some((d) => d.$?.["android:scheme"] === "waze"),
            ),
        );
        if (!hasWaze) {
          manifest.queries.push({
            intent: [
              {
                action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
                data: [{ $: { "android:scheme": "waze" } }],
              },
            ],
          } as never);
        }
        return mod;
      }),
  ],
  extra: {
    eas: {
      projectId: "792d7801-11c5-4493-9646-be191c0daba8",
    },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
