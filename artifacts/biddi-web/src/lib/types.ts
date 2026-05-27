export type Lang = "en" | "fr" | "ar";

export interface SitePageBlockBase { type: string; [k: string]: any }

export interface SitePageContent {
  heading?: string;
  subheading?: string;
  heroImage?: string;
  blocks: SitePageBlockBase[];
}

export interface SitePage {
  id: string;
  slug: string;
  lang: Lang;
  status: "draft" | "published";
  title: string;
  content: SitePageContent;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: "summary" | "summary_large_image";
  canonicalUrl: string | null;
  robotsIndex: boolean;
  updatedAt: string;
}

export interface SiteSettings {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  contactEmail: string;
  contactPhone: string;
  socialFacebook: string;
  socialTwitter: string;
  socialInstagram: string;
  socialLinkedin: string;
  appStoreUrl: string;
  playStoreUrl: string;
  defaultOgImage: string;
  siteUrl: string;
  footerLogoUrl?: string;
  headerLogoUrl?: string;
}
