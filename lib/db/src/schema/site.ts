import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type SitePageBlock =
  | { type: "hero"; title?: string; subtitle?: string; image?: string; ctaLabel?: string; ctaHref?: string }
  | { type: "features"; title?: string; items?: { icon?: string; title: string; description: string }[] }
  | { type: "steps"; title?: string; items?: { title: string; description: string }[] }
  | { type: "testimonials"; title?: string; items?: { name: string; role?: string; quote: string; rating?: number }[] }
  | { type: "faq"; title?: string; items?: { question: string; answer: string }[] }
  | { type: "richtext"; title?: string; html: string }
  | { type: "cta"; title?: string; subtitle?: string; ctaLabel?: string; ctaHref?: string }
  | { type: "image"; src: string; alt?: string; caption?: string };

export interface SitePageContent {
  heading?: string;
  subheading?: string;
  heroImage?: string;
  blocks: SitePageBlock[];
}

export const sitePagesTable = pgTable(
  "site_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    lang: text("lang", { enum: ["en", "fr", "ar"] }).notNull().default("en"),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("published"),
    title: text("title").notNull(),
    content: jsonb("content").$type<SitePageContent>().notNull().default({ blocks: [] }),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    metaKeywords: text("meta_keywords"),
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    ogImage: text("og_image"),
    twitterCard: text("twitter_card", { enum: ["summary", "summary_large_image"] })
      .notNull()
      .default("summary_large_image"),
    canonicalUrl: text("canonical_url"),
    robotsIndex: boolean("robots_index").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugLangUnique: uniqueIndex("site_pages_slug_lang_unique").on(t.slug, t.lang),
  }),
);

export type SitePage = typeof sitePagesTable.$inferSelect;
export type InsertSitePage = typeof sitePagesTable.$inferInsert;

export const siteContactSubmissionsTable = pgTable("site_contact_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  subject: text("subject"),
  message: text("message").notNull(),
  status: text("status", { enum: ["new", "read", "archived"] }).notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SiteContactSubmission = typeof siteContactSubmissionsTable.$inferSelect;
export type InsertSiteContactSubmission = typeof siteContactSubmissionsTable.$inferInsert;

export interface SiteGlobalSettings {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  contactEmail: string;
  contactNotificationEmail: string;
  contactPhone: string;
  socialFacebook: string;
  socialTwitter: string;
  socialInstagram: string;
  socialLinkedin: string;
  appStoreUrl: string;
  playStoreUrl: string;
  defaultOgImage: string;
  siteUrl: string;
  footerLogoUrl: string;
  headerLogoUrl: string;
}

export const DEFAULT_SITE_SETTINGS: SiteGlobalSettings = {
  maintenanceMode: false,
  maintenanceMessage: "We'll be back soon. Thanks for your patience.",
  contactEmail: "hello@biddirides.com",
  contactNotificationEmail: "",
  contactPhone: "+212 600 000 000",
  socialFacebook: "",
  socialTwitter: "",
  socialInstagram: "",
  socialLinkedin: "",
  appStoreUrl: "",
  playStoreUrl: "",
  defaultOgImage: "",
  siteUrl: "https://biddirides.com",
  footerLogoUrl: "",
  headerLogoUrl: "",
};
