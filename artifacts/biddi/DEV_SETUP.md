# Biddi Mobile — Dev Setup Guide

## Expo CLI version

The Expo CLI is **pinned to an exact version** in `package.json`:

```json
"@expo/cli": "54.0.23"
```

This is intentional. Expo CLI minor/patch releases have historically removed or renamed flags (e.g. `--non-interactive` was dropped in SDK 50+ in favour of the `CI` environment variable). Pinning prevents silent startup failures when the lockfile is regenerated or the dependency tree is audited.

**When upgrading Expo SDK**, update `@expo/cli` to the matching CLI version published alongside the new SDK. Check the Expo changelog at https://expo.dev/changelog and the `@expo/cli` npm page for the correct pairing.

A version guard runs automatically at the start of `pnpm run dev` and `pnpm run build`. If the installed CLI differs from the pinned version it exits immediately with a clear error. Run it standalone with:

```
pnpm run check-expo
```

---

## Dev script

```
pnpm --filter @workspace/biddi run dev
```

The full command defined in `package.json`:

```
CI=1
EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN
EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN
EXPO_PUBLIC_REPL_ID=$REPL_ID
REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_DEV_DOMAIN
pnpm exec expo start --localhost --port $PORT
```

### Environment variables

| Variable | Source | Purpose |
|---|---|---|
| `CI=1` | Set in dev script | Runs Expo in non-interactive mode. **This replaces the old `--non-interactive` flag** which was removed in Expo SDK 50. If Expo hangs waiting for keyboard input, verify `CI=1` is still respected by the installed CLI version. |
| `EXPO_PACKAGER_PROXY_URL` | `$REPLIT_EXPO_DEV_DOMAIN` (Replit-injected) | Tells the Expo Go client where to reach the Metro packager through the Replit proxy. Must be `https://` — bare hostnames are rejected. |
| `EXPO_PUBLIC_DOMAIN` | `$REPLIT_DEV_DOMAIN` (Replit-injected) | The public domain for this Replit environment, passed into the app bundle as a build-time constant. Read by `lib/config.ts` to construct API base URLs in the web build. |
| `EXPO_PUBLIC_REPL_ID` | `$REPL_ID` (Replit-injected) | Identifies the Replit environment. Forwarded to Metro so asset URLs are scoped correctly. |
| `REACT_NATIVE_PACKAGER_HOSTNAME` | `$REPLIT_DEV_DOMAIN` (Replit-injected) | Overrides the hostname Metro advertises to connected devices. Required so Expo Go can reach Metro through the Replit proxy rather than a LAN IP. |
| `PORT` | Replit-injected per-artifact port | The TCP port Metro listens on. Replit assigns a unique port per artifact to avoid collisions. **Do not hard-code this value.** |

### Flags

| Flag | Purpose |
|---|---|
| `--localhost` | Binds Metro to `127.0.0.1` only. Traffic reaches it through the Replit reverse-proxy, so LAN binding is not needed. |
| `--port $PORT` | Uses the Replit-assigned port (see `PORT` above). |

---

## Upgrading Expo

Follow these steps to safely move to a new Expo SDK version:

1. Check the [Expo SDK changelog](https://expo.dev/changelog) for any removed CLI flags or renamed env vars.
2. Update `expo` (e.g. `~55.0.x`) and all `expo-*` packages to their new compatible ranges using `npx expo install --fix`.
3. Update `@expo/cli` to the **exact** version that shipped with the new SDK (visible on the npm page or in the SDK changelog). Do not use a range (`^` / `~`).
4. Run the dev script and confirm Metro starts without errors before committing.
5. Update this file and the version comment in `package.json` if any env var or flag behaviour changed.

---

## Voice booking

Voice booking uses `expo-speech-recognition` for speech-to-text and `expo-speech` for TTS confirmation.

### Expo Go limitation

`expo-speech-recognition` requires native modules that **are not available in Expo Go**. The feature gracefully degrades in Expo Go — the mic button opens the sheet but shows a "Requires an EAS dev build" message.

To test voice booking you need an EAS dev build:

```
eas build --profile development --platform ios   # or android
```

Install the resulting build on a physical device (or simulator with mic access), then run:

```
pnpm --filter @workspace/biddi run dev
```

### Permissions

| Platform | Permission | Purpose |
|---|---|---|
| iOS | `NSSpeechRecognitionUsageDescription` | On-device / server-side speech recognition |
| iOS | `NSMicrophoneUsageDescription` | Microphone input |
| Android | `RECORD_AUDIO` | Microphone input |

Both iOS entries are in `app.config.ts → ios.infoPlist`. Android `RECORD_AUDIO` is already in `android.permissions`. `expo-speech-recognition` is listed in the `plugins` array so these are wired up automatically at build time.

### How it works

1. Rider taps the mic button on the home screen.
2. `VoiceBookingSheet` opens and starts listening via `expo-speech-recognition`.
3. Recognised text is stripped of booking-intent prefixes (e.g. "Take me to", "Go to") in EN/AR/FR.
4. The cleaned phrase is sent to the autocomplete API. The first result is selected automatically.
5. `expo-speech` reads back "Going to [destination]?" for confirmation.
6. Rider taps **Confirm** → normal booking flow resumes.

---

## Build script

The production build (`pnpm run build` → `scripts/build.js`) starts Metro internally without the `CI` variable or proxy env vars. It uses `--no-dev --minify --localhost` and polls `http://localhost:8081/status` for up to 60 seconds. If Metro times out, check that `@expo/cli` still accepts `--no-dev` and `--minify` — these were stable as of SDK 54 but should be verified after each upgrade.
