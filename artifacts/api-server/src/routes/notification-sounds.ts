import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import {
  db,
  notificationSoundsTable,
  notificationSoundsBuildTable,
  settingsTable,
} from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAdmin } from "../middlewares/auth";
import { invalidateConfigCache } from "../lib/settings";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Reserved slugs come from the original six bundled-in-app presets. Admins
 * cannot create or delete a library row using these names — they always
 * resolve to the bundled native sound on the mobile app.
 */
export const RESERVED_SLUGS = new Set<string>([
  "default",
  "chime",
  "ping",
  "ringtone",
  "alert",
  "horn",
]);

/** Sound categories that map to the four `sound*` settings keys. */
export const SOUND_CATEGORY_TO_SETTING_KEY = {
  newTripRequest: "soundNewTripRequest",
  driverApp: "soundDriverApp",
  userApp: "soundUserApp",
  voipCalling: "soundVoipCalling",
} as const;
export type SoundCategory = keyof typeof SOUND_CATEGORY_TO_SETTING_KEY;

const ALLOWED_AUDIO_MIME = new Set<string>([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/x-caf",
  "audio/ogg",
]);
const MAX_SOUND_BYTES = 1024 * 1024; // 1 MB
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

const RequestUploadBody = z.object({
  name: z.string().min(1).max(200),
  size: z.number().int().min(1).max(MAX_SOUND_BYTES),
  contentType: z.string().min(1).max(80),
});

const FinalizeBody = z.object({
  objectPath: z.string().regex(/^\/objects\/uploads\/[A-Za-z0-9._-]{1,128}$/),
  slug: z.string().regex(SLUG_RE),
  displayName: z.string().min(1).max(120),
  mimeType: z.string().min(1).max(80),
  sizeBytes: z.number().int().min(1).max(MAX_SOUND_BYTES),
  checksum: z.string().min(4).max(128),
});

const RenameBody = z.object({
  displayName: z.string().min(1).max(120),
});

const BuildHashBody = z.object({
  manifestHash: z.string().min(4).max(128),
  bundledSounds: z
    .array(
      z.object({
        slug: z.string().regex(SLUG_RE),
        checksum: z.string().min(4).max(128),
      }),
    )
    .max(200)
    .optional(),
});

function publicUrlFor(objectPath: string): string {
  // Object storage routes are mounted by the api-server under /api.
  return `/api/storage${objectPath}`;
}

async function getCurrentBuild(): Promise<{
  hash: string | null;
  bundled: { slug: string; checksum: string }[];
}> {
  const [row] = await db
    .select({
      hash: notificationSoundsBuildTable.manifestHash,
      bundledSounds: notificationSoundsBuildTable.bundledSounds,
    })
    .from(notificationSoundsBuildTable)
    .limit(1);
  return {
    hash: row?.hash ?? null,
    bundled: Array.isArray(row?.bundledSounds) ? row.bundledSounds : [],
  };
}

function computeManifestHash(
  rows: { slug: string; checksum: string }[],
): string {
  const sorted = [...rows].sort((a, b) => a.slug.localeCompare(b.slug));
  const payload = sorted.map((r) => `${r.slug}:${r.checksum}`).join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * GET /admin/notification-sounds
 *
 * Lists every uploaded sound plus the hash currently shipped in the mobile
 * build, so the admin UI can compute per-row "in current build" badges.
 */
router.get(
  "/admin/notification-sounds",
  requireAdmin,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(notificationSoundsTable)
      .orderBy(notificationSoundsTable.createdAt);
    const build = await getCurrentBuild();
    const currentManifestHash = computeManifestHash(rows);
    const bundledMap = new Map(build.bundled.map((b) => [b.slug, b.checksum]));
    res.json({
      sounds: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        displayName: r.displayName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        checksum: r.checksum,
        url: publicUrlFor(r.objectPath),
        createdAt: r.createdAt.toISOString(),
        // True only when the *exact* uploaded file (matching checksum) is
        // shipped in the latest mobile build. Renaming or replacing a sound
        // flips this back to false until the next sync + EAS rebuild.
        inCurrentBuild: bundledMap.get(r.slug) === r.checksum,
      })),
      build: {
        manifestHash: build.hash,
        currentManifestHash,
        upToDate: build.hash !== null && build.hash === currentManifestHash,
      },
      reservedSlugs: Array.from(RESERVED_SLUGS),
    });
  },
);

/**
 * POST /admin/notification-sounds/upload-url
 *
 * Mirrors the generic upload-url flow but applies the audio-only MIME and
 * 1 MB size limits used for notification sounds.
 */
router.post(
  "/admin/notification-sounds/upload-url",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }
    const { contentType, size } = parsed.data;
    if (!ALLOWED_AUDIO_MIME.has(contentType.toLowerCase())) {
      res.status(400).json({
        error:
          "Unsupported audio format. Allowed: mp3, wav, m4a, aac, caf, ogg.",
      });
      return;
    }
    if (size > MAX_SOUND_BYTES) {
      res.status(400).json({ error: `File too large. Max ${MAX_SOUND_BYTES} bytes.` });
      return;
    }
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (err) {
      req.log.error({ err }, "[sounds] failed to issue upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * POST /admin/notification-sounds/finalize
 *
 * Sets the object ACL to public and writes a library row. Slug must be
 * URL-safe and not conflict with one of the reserved bundled-preset names.
 */
router.post(
  "/admin/notification-sounds/finalize",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = FinalizeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid finalize payload", details: parsed.error.issues });
      return;
    }
    const { objectPath, slug, displayName, mimeType, sizeBytes, checksum } = parsed.data;
    if (RESERVED_SLUGS.has(slug)) {
      res.status(400).json({ error: "Slug conflicts with a reserved system preset" });
      return;
    }
    if (!ALLOWED_AUDIO_MIME.has(mimeType.toLowerCase())) {
      res.status(400).json({ error: "Unsupported audio format" });
      return;
    }
    const [existing] = await db
      .select({ id: notificationSoundsTable.id })
      .from(notificationSoundsTable)
      .where(eq(notificationSoundsTable.slug, slug))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Slug already in use" });
      return;
    }
    try {
      const adminId = (req as Request & { adminId?: string }).adminId ?? null;
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        objectPath,
        { owner: adminId ?? "admin", visibility: "public" },
      );
      const [row] = await db
        .insert(notificationSoundsTable)
        .values({
          slug,
          displayName,
          mimeType,
          sizeBytes,
          objectPath: normalized,
          checksum,
          createdByAdminId: adminId,
        })
        .returning();
      res.json({
        sound: {
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          checksum: row.checksum,
          url: publicUrlFor(row.objectPath),
          createdAt: row.createdAt.toISOString(),
        },
      });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded object not found" });
        return;
      }
      req.log.error({ err }, "[sounds] failed to finalize upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

router.patch(
  "/admin/notification-sounds/:id",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = RenameBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid rename payload" });
      return;
    }
    const id = String((req.params.id as string));
    const [updated] = await db
      .update(notificationSoundsTable)
      .set({ displayName: parsed.data.displayName })
      .where(eq(notificationSoundsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Sound not found" });
      return;
    }
    res.json({ ok: true });
  },
);

router.delete(
  "/admin/notification-sounds/:id",
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = String((req.params.id as string));
    const [row] = await db
      .select()
      .from(notificationSoundsTable)
      .where(eq(notificationSoundsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Sound not found" });
      return;
    }
    // Refuse to delete a sound that is currently assigned to one of the four
    // category settings — admin must reassign first.
    const settingRows = await db.select().from(settingsTable);
    const inUseFor: string[] = [];
    for (const s of settingRows) {
      if (
        Object.values(SOUND_CATEGORY_TO_SETTING_KEY).includes(
          s.key as (typeof SOUND_CATEGORY_TO_SETTING_KEY)[SoundCategory],
        ) &&
        s.value === row.slug
      ) {
        inUseFor.push(s.key);
      }
    }
    if (inUseFor.length > 0) {
      res.status(409).json({
        error: "Sound is currently assigned",
        inUseFor,
      });
      return;
    }
    await db.delete(notificationSoundsTable).where(eq(notificationSoundsTable.id, id));
    invalidateConfigCache();
    res.json({ ok: true });
  },
);

/**
 * GET /notification-sounds/manifest
 *
 * Public, unauthenticated. Used by the mobile build sync script and by the
 * mobile app at runtime to resolve a slug to a downloadable file. Returns
 * the URL the client should download from plus a checksum for cache busting.
 */
router.get(
  "/notification-sounds/manifest",
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(notificationSoundsTable)
      .orderBy(notificationSoundsTable.slug);
    const manifestHash = computeManifestHash(rows);
    res.setHeader("cache-control", "public, max-age=15");
    res.json({
      manifestHash,
      sounds: rows.map((r) => ({
        slug: r.slug,
        displayName: r.displayName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        checksum: r.checksum,
        url: publicUrlFor(r.objectPath),
      })),
    });
  },
);

/**
 * GET /notification-sounds/active
 *
 * Public endpoint used by the mobile app to resolve the four category slugs
 * to actual sounds plus a manifest entry per uploaded sound. Cached briefly
 * so the mobile app does not hammer the API.
 */
router.get(
  "/notification-sounds/active",
  async (_req: Request, res: Response) => {
    const [rows, settingRows] = await Promise.all([
      db.select().from(notificationSoundsTable).orderBy(notificationSoundsTable.slug),
      db.select().from(settingsTable),
    ]);
    const settingsMap = new Map(settingRows.map((r) => [r.key, r.value]));
    const readSlug = (key: string): string => {
      const v = settingsMap.get(key);
      return typeof v === "string" ? v : "default";
    };
    const active: Record<SoundCategory, string> = {
      newTripRequest: readSlug("soundNewTripRequest"),
      driverApp: readSlug("soundDriverApp"),
      userApp: readSlug("soundUserApp"),
      voipCalling: readSlug("soundVoipCalling"),
    };
    res.setHeader("cache-control", "public, max-age=15");
    res.json({
      active,
      manifestHash: computeManifestHash(rows),
      sounds: rows.map((r) => ({
        slug: r.slug,
        displayName: r.displayName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        checksum: r.checksum,
        url: publicUrlFor(r.objectPath),
      })),
    });
  },
);

/**
 * POST /admin/notification-sounds/build-hash
 *
 * Called by the sync script after it writes files into the Expo project.
 * Records the hash of the manifest the build was produced from so the admin
 * UI can show whether an uploaded sound is shipped in the latest build.
 */
router.post(
  "/admin/notification-sounds/build-hash",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = BuildHashBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid manifestHash" });
      return;
    }
    const bundled = parsed.data.bundledSounds ?? [];
    await db
      .insert(notificationSoundsBuildTable)
      .values({
        id: 1,
        manifestHash: parsed.data.manifestHash,
        bundledSounds: bundled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationSoundsBuildTable.id,
        set: {
          manifestHash: parsed.data.manifestHash,
          bundledSounds: bundled,
          updatedAt: new Date(),
        },
      });
    res.json({ ok: true });
  },
);

export default router;
