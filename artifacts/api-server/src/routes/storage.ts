import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireAdmin, requireUser } from "../middlewares/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Server-enforced limits for the admin image upload flow.
const ALLOWED_UPLOAD_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Only accept the exact shape that request-url returns:
// "/objects/uploads/<uuid-or-similar>". This blocks attempts to flip
// the ACL on arbitrary objects in the bucket.
const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._-]{1,128}$/;
const FinalizeBody = z.object({
  objectPath: z.string().regex(OBJECT_PATH_RE, "Invalid objectPath"),
});

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Admin-only.
 * The client sends JSON metadata (name, size, contentType) — NOT the file —
 * then uploads the file directly to the returned presigned URL.
 */
router.post(
  "/storage/uploads/request-url",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    const { name, size, contentType } = parsed.data;

    if (!ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
      res.status(400).json({
        error: "Unsupported content type. Allowed: PNG, JPEG, WebP, GIF, SVG, PDF.",
      });
      return;
    }
    if (size > MAX_UPLOAD_BYTES) {
      res.status(400).json({
        error: `File too large. Max ${MAX_UPLOAD_BYTES} bytes.`,
      });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * POST /storage/uploads/finalize
 *
 * Called by the admin client after uploading the file bytes via the presigned
 * URL. Stamps the resulting object with a public-read ACL policy so it can
 * later be served by GET /storage/objects/* without authentication.
 *
 * Without this step, the GET endpoint will refuse to serve the object — making
 * objects private-by-default even though the route itself is open.
 */
router.post(
  "/storage/uploads/finalize",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = FinalizeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing objectPath" });
      return;
    }

    try {
      const adminId = (req as Request & { adminId?: string }).adminId ?? "admin";
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        parsed.data.objectPath,
        {
          owner: adminId,
          visibility: "public",
        },
      );
      res.json({ objectPath: normalized });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded object not found" });
        return;
      }
      req.log.error({ err: error }, "Error finalizing upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

// Profile photos must be raster images only (no PDF/SVG).
const ALLOWED_PROFILE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * POST /storage/uploads/profile-request-url
 *
 * Request a presigned URL for a profile photo upload. Requires a valid
 * user session. Restricted to raster image types only.
 */
router.post(
  "/storage/uploads/profile-request-url",
  requireUser,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    const { name, size, contentType } = parsed.data;

    if (!ALLOWED_PROFILE_MIME_TYPES.has(contentType)) {
      res.status(400).json({
        error: "Unsupported content type. Allowed: JPEG, PNG, WebP, GIF.",
      });
      return;
    }
    if (size > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: `File too large. Max ${MAX_UPLOAD_BYTES} bytes.` });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating profile upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * POST /storage/uploads/profile-finalize
 *
 * Called after uploading a profile photo. Sets the object ACL to public and
 * saves the resulting path as the authenticated user's photoUrl.
 */
router.post(
  "/storage/uploads/profile-finalize",
  requireUser,
  async (req: Request, res: Response) => {
    const parsed = FinalizeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing objectPath" });
      return;
    }

    try {
      const userId = req.userId!;
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        parsed.data.objectPath,
        { owner: userId, visibility: "public" },
      );

      await db
        .update(usersTable)
        .set({ photoUrl: `/api/storage${normalized}` })
        .where(eq(usersTable.id, userId));

      res.json({ objectPath: normalized });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded object not found" });
        return;
      }
      req.log.error({ err: error }, "Error finalizing profile upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

/**
 * POST /storage/uploads/driver-request-url
 *
 * Request a presigned URL for a driver document upload. Requires a valid
 * user session (not admin). Enforces the same MIME type and size limits.
 */
router.post(
  "/storage/uploads/driver-request-url",
  requireUser,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    const { name, size, contentType } = parsed.data;

    if (!ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
      res.status(400).json({
        error: "Unsupported content type. Allowed: PNG, JPEG, WebP, GIF, SVG, PDF.",
      });
      return;
    }
    if (size > MAX_UPLOAD_BYTES) {
      res.status(400).json({
        error: `File too large. Max ${MAX_UPLOAD_BYTES} bytes.`,
      });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating driver upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * POST /storage/uploads/driver-finalize
 *
 * Called by the driver client after uploading file bytes via the presigned
 * URL. Sets the object ACL to public so it can be viewed by admins.
 */
router.post(
  "/storage/uploads/driver-finalize",
  requireUser,
  async (req: Request, res: Response) => {
    const parsed = FinalizeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing objectPath" });
      return;
    }

    try {
      const userId = req.userId ?? "user";
      const normalized = await objectStorageService.trySetObjectEntityAclPolicy(
        parsed.data.objectPath,
        {
          owner: userId,
          visibility: "public",
        },
      );
      res.json({ objectPath: normalized });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded object not found" });
        return;
      }
      req.log.error({ err: error }, "Error finalizing driver upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = (req.params.filePath as string);
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR. Each object's ACL policy
 * (set during finalize) determines whether it can be served. Objects without
 * a policy, or with `visibility: "private"`, return 404.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = (req.params.path as string);
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const canRead = await objectStorageService.canAccessObjectEntity({
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canRead) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
