# Biddi (Expo)

The Biddi rider/driver mobile app.

## Notification sounds

Notification sounds in this app come from two sources:

1. **OS push sound** (lock screen, banner, or notification center). The Expo
   push payload sends a `sound` filename. iOS and Android can only play files
   that are **bundled into the native app at build time** — there is no way to
   download a new sound and have the OS play it for a push.
2. **In-app playback** (e.g. ringtone while a ride request screen is visible,
   or a VOIP ring). This is handled by `lib/notificationSounds.ts`, which
   downloads the file at runtime and plays it via `expo-av`.

### Adding or updating sounds

1. An admin uploads a new sound at `/admin` → Settings → Notification sounds.
   The file is stored in object storage and registered as a library entry.
2. To make that sound available to OS push notifications, run:

   ```bash
   API_BASE=https://your-replit-domain ADMIN_API_TOKEN=... \
     pnpm --filter biddi run sync-sounds
   ```

   This downloads every uploaded sound into `assets/sounds/`, writes
   `sounds-manifest.json`, and reports the resulting hash back to the API so
   the admin UI can flag which sounds are "in current build".
3. Run an EAS build and ship it. New sounds will play in OS push notifications
   on the new build; older builds fall back to the system default.

In-app playback works **immediately** (no rebuild required) for any uploaded
sound.

### Reserved slugs

The slugs `default`, `chime`, `ping`, `ringtone`, `alert`, and `horn` are
reserved for the bundled system presets and cannot be uploaded.
