import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import {
  db,
  sitePagesTable,
  siteContactSubmissionsTable,
  settingsTable,
  DEFAULT_SITE_SETTINGS,
  type SiteGlobalSettings,
  type SitePageContent,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { checkLimit } from "../lib/rateLimit";

const router: IRouter = Router();

const SITE_SETTING_KEY = "siteGlobalSettings";

async function getSiteSettings(): Promise<SiteGlobalSettings> {
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, SITE_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_SITE_SETTINGS };
  const raw = row.value as unknown;
  const parsed: Record<string, unknown> =
    typeof raw === "string"
      ? (() => {
          try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
        })()
      : raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
  return { ...DEFAULT_SITE_SETTINGS, ...parsed };
}

async function setSiteSettings(next: SiteGlobalSettings): Promise<void> {
  const value = JSON.stringify(next);
  await db
    .insert(settingsTable)
    .values({ key: SITE_SETTING_KEY, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

const langSchema = z.enum(["en", "fr", "ar"]);

// =====================================================
// PUBLIC ENDPOINTS
// =====================================================

router.get("/site/settings", async (_req, res) => {
  const settings = await getSiteSettings();
  res.json({ settings });
});

function parseLangOr400(input: unknown, res: import("express").Response): "en" | "fr" | "ar" | null {
  const r = langSchema.safeParse(input);
  if (!r.success) {
    res.status(400).json({ error: "invalid_lang" });
    return null;
  }
  return r.data;
}

router.get("/site/pages", async (req, res) => {
  const lang = parseLangOr400(req.query.lang ?? "en", res);
  if (!lang) return;
  const rows = await db
    .select({
      slug: sitePagesTable.slug,
      lang: sitePagesTable.lang,
      title: sitePagesTable.title,
      metaDescription: sitePagesTable.metaDescription,
      updatedAt: sitePagesTable.updatedAt,
    })
    .from(sitePagesTable)
    .where(and(eq(sitePagesTable.lang, lang), eq(sitePagesTable.status, "published")));
  res.json({ pages: rows });
});

async function fetchPublishedPage(slug: string, lang: "en" | "fr" | "ar") {
  const [page] = await db
    .select()
    .from(sitePagesTable)
    .where(and(eq(sitePagesTable.slug, slug), eq(sitePagesTable.lang, lang)))
    .limit(1);
  if (!page || page.status !== "published") return null;
  return page;
}

router.get("/site/pages/:slug", async (req, res) => {
  const lang = parseLangOr400(req.query.lang ?? "en", res);
  if (!lang) return;
  const slug = String((req.params.slug as string));
  const page = await fetchPublishedPage(slug, lang);
  if (!page) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ page });
});

// Path-only variant (used by the OpenAPI client; same data as the query
// variant above). Both are kept so that legacy clients keep working.
router.get("/site/pages/:lang/:slug", async (req, res) => {
  const langParse = langSchema.safeParse((req.params.lang as string));
  if (!langParse.success) { res.status(404).json({ error: "not_found" }); return; }
  const lang = langParse.data;
  const slug = String((req.params.slug as string));
  const page = await fetchPublishedPage(slug, lang);
  if (!page) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ page });
});

// Public SEO handlers — exported so they can be mounted at the site root
// (`/sitemap.xml`, `/robots.txt`) by app.ts where crawlers expect them.
export const handleSitemapXml: RequestHandler = async (req, res) => {
  const settings = await getSiteSettings();
  const baseUrl = settings.siteUrl?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
  const rows = await db
    .select({ slug: sitePagesTable.slug, lang: sitePagesTable.lang, updatedAt: sitePagesTable.updatedAt })
    .from(sitePagesTable)
    .where(and(eq(sitePagesTable.status, "published"), eq(sitePagesTable.robotsIndex, true)));
  const urls = rows
    .map((r) => {
      const path = r.slug === "home" ? `/${r.lang}/` : `/${r.lang}/${r.slug}`;
      return `<url><loc>${baseUrl}${path}</loc><lastmod>${r.updatedAt.toISOString()}</lastmod></url>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  res.setHeader("content-type", "application/xml; charset=utf-8");
  res.send(xml);
};

export const handleRobotsTxt: RequestHandler = async (req, res) => {
  const settings = await getSiteSettings();
  const baseUrl = settings.siteUrl?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
  const body = settings.maintenanceMode
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.send(body);
};

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
  message: z.string().min(5).max(5000),
});

router.post("/site/contact", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  // Rate-limit submissions per IP and per email to deter contact-form spam.
  const ip = req.ip || "unknown";
  const ipLimit = checkLimit(`contact:ip:${ip}`, 10, 60 * 60_000);
  const emailLimit = checkLimit(`contact:email:${data.email.toLowerCase()}`, 5, 60 * 60_000);
  if (!ipLimit.ok || !emailLimit.ok) {
    const retry = Math.max(ipLimit.retryAfterMs, emailLimit.retryAfterMs);
    res.setHeader("retry-after", Math.ceil(retry / 1000).toString());
    res.status(429).json({ error: "too_many_requests" });
    return;
  }
  const [row] = await db
    .insert(siteContactSubmissionsTable)
    .values({
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      subject: data.subject || null,
      message: data.message,
    })
    .returning();
  // Best-effort email notification.
  try {
    const settings = await getSiteSettings();
    const recipient = settings.contactNotificationEmail || settings.contactEmail;
    if (recipient) {
      const baseUrl = settings.siteUrl?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
      const adminLink = `${baseUrl}/admin/website/submissions`;
      await sendEmail({
        to: recipient,
        subject: `[BiddiRides] New contact: ${data.subject || data.name}`,
        html: `<h2>New contact submission</h2>
        <p><b>Name:</b> ${escapeHtml(data.name)}</p>
        <p><b>Email:</b> ${escapeHtml(data.email)}</p>
        ${data.phone ? `<p><b>Phone:</b> ${escapeHtml(data.phone)}</p>` : ""}
        ${data.subject ? `<p><b>Subject:</b> ${escapeHtml(data.subject)}</p>` : ""}
        <p><b>Message:</b></p>
        <p>${escapeHtml(data.message).replace(/\n/g, "<br/>")}</p>
        <hr/>
        <p><a href="${escapeHtml(adminLink)}">View in admin</a></p>`,
      });
    }
  } catch (err) {
    logger.warn({ err }, "[site] contact email failed");
  }
  res.status(200).json({ ok: true, id: row.id });
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =====================================================
// ADMIN ENDPOINTS
// =====================================================

router.get("/admin/site/pages", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      slug: sitePagesTable.slug,
      lang: sitePagesTable.lang,
      title: sitePagesTable.title,
      status: sitePagesTable.status,
      updatedAt: sitePagesTable.updatedAt,
    })
    .from(sitePagesTable)
    .orderBy(sitePagesTable.slug, sitePagesTable.lang);
  res.json({ pages: rows });
});

router.get("/admin/site/pages/:slug/:lang", requireAdmin, async (req, res) => {
  const lang = parseLangOr400((req.params.lang as string), res);
  if (!lang) return;
  const slug = String((req.params.slug as string));
  const [page] = await db
    .select()
    .from(sitePagesTable)
    .where(and(eq(sitePagesTable.slug, slug), eq(sitePagesTable.lang, lang)))
    .limit(1);
  if (!page) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ page });
});

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), title: z.string().optional(), subtitle: z.string().optional(), image: z.string().optional(), ctaLabel: z.string().optional(), ctaHref: z.string().optional() }),
  z.object({ type: z.literal("features"), title: z.string().optional(), items: z.array(z.object({ icon: z.string().optional(), title: z.string(), description: z.string() })).optional() }),
  z.object({ type: z.literal("steps"), title: z.string().optional(), items: z.array(z.object({ title: z.string(), description: z.string() })).optional() }),
  z.object({ type: z.literal("testimonials"), title: z.string().optional(), items: z.array(z.object({ name: z.string(), role: z.string().optional(), quote: z.string(), rating: z.number().optional() })).optional() }),
  z.object({ type: z.literal("faq"), title: z.string().optional(), items: z.array(z.object({ question: z.string(), answer: z.string() })).optional() }),
  z.object({ type: z.literal("richtext"), title: z.string().optional(), html: z.string() }),
  z.object({ type: z.literal("cta"), title: z.string().optional(), subtitle: z.string().optional(), ctaLabel: z.string().optional(), ctaHref: z.string().optional() }),
  z.object({ type: z.literal("image"), src: z.string(), alt: z.string().optional(), caption: z.string().optional() }),
]);

const pageContentSchema = z.object({
  heading: z.string().optional(),
  subheading: z.string().optional(),
  heroImage: z.string().optional(),
  blocks: z.array(blockSchema).default([]),
});

const upsertPageSchema = z.object({
  slug: z.string().min(1).max(120),
  lang: langSchema,
  status: z.enum(["draft", "published"]).default("published"),
  title: z.string().min(1).max(200),
  content: pageContentSchema,
  metaTitle: z.string().max(200).nullable().optional(),
  metaDescription: z.string().max(400).nullable().optional(),
  metaKeywords: z.string().max(400).nullable().optional(),
  ogTitle: z.string().max(200).nullable().optional(),
  ogDescription: z.string().max(400).nullable().optional(),
  ogImage: z.string().max(800).nullable().optional(),
  twitterCard: z.enum(["summary", "summary_large_image"]).default("summary_large_image"),
  canonicalUrl: z.string().max(800).nullable().optional(),
  robotsIndex: z.boolean().default(true),
});

router.post("/admin/site/pages", requireAdmin, async (req, res) => {
  const parsed = upsertPageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const [existing] = await db
    .select({ id: sitePagesTable.id })
    .from(sitePagesTable)
    .where(and(eq(sitePagesTable.slug, data.slug), eq(sitePagesTable.lang, data.lang)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "page_exists" });
    return;
  }
  const [row] = await db
    .insert(sitePagesTable)
    .values({
      slug: data.slug,
      lang: data.lang,
      status: data.status,
      title: data.title,
      content: data.content,
      metaTitle: data.metaTitle ?? null,
      metaDescription: data.metaDescription ?? null,
      metaKeywords: data.metaKeywords ?? null,
      ogTitle: data.ogTitle ?? null,
      ogDescription: data.ogDescription ?? null,
      ogImage: data.ogImage ?? null,
      twitterCard: data.twitterCard,
      canonicalUrl: data.canonicalUrl ?? null,
      robotsIndex: data.robotsIndex,
    })
    .returning();
  res.status(201).json({ page: row });
});

router.delete("/admin/site/pages/:slug/:lang", requireAdmin, async (req, res) => {
  const lang = parseLangOr400((req.params.lang as string), res);
  if (!lang) return;
  const slug = String((req.params.slug as string));
  const [deleted] = await db
    .delete(sitePagesTable)
    .where(and(eq(sitePagesTable.slug, slug), eq(sitePagesTable.lang, lang)))
    .returning({ id: sitePagesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.put("/admin/site/pages/:slug/:lang", requireAdmin, async (req, res) => {
  const lang = parseLangOr400((req.params.lang as string), res);
  if (!lang) return;
  const slug = String((req.params.slug as string));
  // Body may include a new `slug` (rename). Lang is fixed by URL.
  const incomingSlug = typeof req.body?.slug === "string" && req.body.slug.trim().length > 0
    ? req.body.slug.trim()
    : slug;
  const parsed = upsertPageSchema.safeParse({ ...req.body, slug: incomingSlug, lang });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  // If renaming, ensure no other row already uses the new slug+lang.
  if (data.slug !== slug) {
    const [conflict] = await db
      .select({ id: sitePagesTable.id })
      .from(sitePagesTable)
      .where(and(eq(sitePagesTable.slug, data.slug), eq(sitePagesTable.lang, lang)))
      .limit(1);
    if (conflict) {
      res.status(409).json({ error: "slug_in_use" });
      return;
    }
  }
  const [existing] = await db
    .select({ id: sitePagesTable.id })
    .from(sitePagesTable)
    .where(and(eq(sitePagesTable.slug, slug), eq(sitePagesTable.lang, lang)))
    .limit(1);
  const updateValues = {
    slug: data.slug,
    status: data.status,
    title: data.title,
    content: data.content,
    metaTitle: data.metaTitle ?? null,
    metaDescription: data.metaDescription ?? null,
    metaKeywords: data.metaKeywords ?? null,
    ogTitle: data.ogTitle ?? null,
    ogDescription: data.ogDescription ?? null,
    ogImage: data.ogImage ?? null,
    twitterCard: data.twitterCard,
    canonicalUrl: data.canonicalUrl ?? null,
    robotsIndex: data.robotsIndex,
    updatedAt: new Date(),
  };
  let row;
  if (existing) {
    [row] = await db
      .update(sitePagesTable)
      .set(updateValues)
      .where(eq(sitePagesTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(sitePagesTable)
      .values({ ...updateValues, lang })
      .returning();
  }
  res.json({ page: row });
});

router.get("/admin/site/settings", requireAdmin, async (_req, res) => {
  const settings = await getSiteSettings();
  res.json({ settings });
});

const settingsSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().max(800).optional(),
  contactEmail: z.string().max(200).optional(),
  contactNotificationEmail: z.string().max(200).optional(),
  contactPhone: z.string().max(40).optional(),
  socialFacebook: z.string().max(400).optional(),
  socialTwitter: z.string().max(400).optional(),
  socialInstagram: z.string().max(400).optional(),
  socialLinkedin: z.string().max(400).optional(),
  appStoreUrl: z.string().max(400).optional(),
  playStoreUrl: z.string().max(400).optional(),
  defaultOgImage: z.string().max(800).optional(),
  siteUrl: z.string().max(400).optional(),
  footerLogoUrl: z.string().max(800).optional(),
  headerLogoUrl: z.string().max(800).optional(),
});

router.patch("/admin/site/settings", requireAdmin, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const current = await getSiteSettings();
  const next: SiteGlobalSettings = { ...current, ...parsed.data };
  await setSiteSettings(next);
  res.json({ settings: next });
});

router.get("/admin/site/contact-submissions", requireAdmin, async (req, res) => {
  const status = req.query.status as string | undefined;
  const where = status === "new" || status === "read" || status === "archived"
    ? eq(siteContactSubmissionsTable.status, status)
    : undefined;
  const rows = await (where ? db.select().from(siteContactSubmissionsTable).where(where) : db.select().from(siteContactSubmissionsTable))
    .orderBy(desc(siteContactSubmissionsTable.createdAt))
    .limit(500);
  res.json({ submissions: rows });
});

const submissionStatusSchema = z.object({ status: z.enum(["new", "read", "archived"]) });

router.patch("/admin/site/contact-submissions/:id", requireAdmin, async (req, res) => {
  const parsed = submissionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
    return;
  }
  const id = String((req.params.id as string));
  const [row] = await db
    .update(siteContactSubmissionsTable)
    .set({ status: parsed.data.status })
    .where(eq(siteContactSubmissionsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ submission: row });
});

router.delete("/admin/site/contact-submissions/:id", requireAdmin, async (req, res) => {
  const id = String((req.params.id as string));
  await db.delete(siteContactSubmissionsTable).where(eq(siteContactSubmissionsTable.id, id));
  res.json({ ok: true });
});

export default router;
