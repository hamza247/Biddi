/**
 * Sync admin-uploaded notification sounds into the Expo project so the next
 * EAS build ships them as native push-notification resources.
 *
 * Usage: pnpm --filter biddi run sync-sounds
 *
 * What it does:
 *   1. Fetches /api/notification-sounds/manifest.
 *   2. Downloads each sound into artifacts/biddi/assets/sounds/.
 *   3. Writes artifacts/biddi/assets/sounds/sounds.lock.json (slug→checksum).
 *   4. Patches artifacts/biddi/assets/sounds/sounds-manifest.json which is
 *      consumed by app.config.ts to register each sound with
 *      expo-notifications and copy them into the iOS bundle and
 *      android/app/src/main/res/raw/.
 *   5. POSTs the manifest hash back to /api/admin/notification-sounds/build-hash
 *      so the admin UI can mark the sounds as "in current build".
 *
 * Requires env vars:
 *   - API_BASE          (e.g. https://your-replit-domain)
 *   - ADMIN_API_TOKEN   (admin bearer token, used only for build-hash POST)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SOUNDS_DIR = path.resolve(REPO_ROOT, "artifacts", "biddi", "assets", "sounds");

interface ManifestEntry {
  slug: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  url: string;
}

interface ManifestResponse {
  manifestHash: string;
  sounds: ManifestEntry[];
}

function extensionFor(mimeType: string, slug: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("wav") || m.includes("wave")) return ".wav";
  if (m.includes("m4a") || m.includes("aac") || m.includes("mp4")) return ".m4a";
  if (m.includes("caf")) return ".caf";
  if (m.includes("ogg")) return ".ogg";
  // Best-effort fallback — preserve any extension already encoded into the slug.
  const dot = slug.lastIndexOf(".");
  if (dot >= 0) return slug.slice(dot);
  return ".mp3";
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const fullUrl = url.startsWith("http") ? url : `${process.env.API_BASE!.replace(/\/+$/, "")}${url}`;
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`Download ${fullUrl} failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function main(): Promise<void> {
  const base = (process.env.API_BASE ?? "").replace(/\/+$/, "");
  if (!base) {
    console.error("API_BASE env var is required (e.g. https://your-replit-domain)");
    process.exit(1);
  }

  console.log(`[sync-sounds] fetching manifest from ${base}/api/notification-sounds/manifest`);
  const res = await fetch(`${base}/api/notification-sounds/manifest`);
  if (!res.ok) {
    console.error(`[sync-sounds] failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const manifest = (await res.json()) as ManifestResponse;

  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  // Wipe stale uploaded files so deleted sounds disappear from the bundle.
  // Reserved preset files (default/chime/ping/ringtone/alert/horn .wav) are
  // checked into the repo and must be preserved.
  const RESERVED = new Set([
    "default.wav", "chime.wav", "ping.wav", "ringtone.wav", "alert.wav", "horn.wav",
    "sounds-manifest.json", "sounds.lock.json",
  ]);
  for (const f of fs.readdirSync(SOUNDS_DIR)) {
    if (RESERVED.has(f)) continue;
    fs.unlinkSync(path.join(SOUNDS_DIR, f));
  }

  const fileEntries: { slug: string; file: string; checksum: string }[] = [];
  for (const entry of manifest.sounds) {
    const ext = extensionFor(entry.mimeType, entry.slug);
    const filename = `${entry.slug}${ext}`;
    const dest = path.join(SOUNDS_DIR, filename);
    console.log(`[sync-sounds] downloading ${entry.slug} → ${filename}`);
    await downloadFile(entry.url, dest);
    const actualChecksum = createHash("sha256")
      .update(fs.readFileSync(dest))
      .digest("hex");
    fileEntries.push({ slug: entry.slug, file: `./assets/sounds/${filename}`, checksum: actualChecksum });
  }

  // Write the manifest consumed by app.config.ts at build time.
  fs.writeFileSync(
    path.join(SOUNDS_DIR, "sounds-manifest.json"),
    JSON.stringify({ sounds: fileEntries }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(SOUNDS_DIR, "sounds.lock.json"),
    JSON.stringify(
      { manifestHash: manifest.manifestHash, sounds: fileEntries },
      null,
      2,
    ) + "\n",
  );

  // POST the hash back so the admin UI can show "in current build" badges.
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (adminToken) {
    const r = await fetch(`${base}/api/admin/notification-sounds/build-hash`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        manifestHash: manifest.manifestHash,
        bundledSounds: fileEntries.map((e) => ({ slug: e.slug, checksum: e.checksum })),
      }),
    });
    if (!r.ok) {
      console.warn(
        `[sync-sounds] failed to publish build hash: HTTP ${r.status} (admin UI will continue showing "not in current build")`,
      );
    } else {
      console.log("[sync-sounds] published build hash to admin");
    }
  } else {
    console.warn(
      "[sync-sounds] ADMIN_API_TOKEN not set — skipping build-hash POST",
    );
  }

  console.log(
    `[sync-sounds] wrote ${fileEntries.length} sound(s). Now run an EAS build to ship them.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
