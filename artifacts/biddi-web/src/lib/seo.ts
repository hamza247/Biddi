import { useEffect } from "react";
import type { SitePage, SiteSettings } from "./types";
import { useSite } from "./site-context";
import { LANGS } from "./i18n";
import type { Lang } from "./types";

interface SeoOptions {
  page?: SitePage | null;
  settings?: SiteSettings | null;
  fallbackTitle?: string;
  fallbackDescription?: string;
}

const OG_LOCALES: Record<Lang, string> = { en: "en_US", fr: "fr_FR", ar: "ar_AR" };

function setMeta(name: string, value: string | null, attr: "name" | "property" = "name") {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!value) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function setLink(rel: string, href: string | null) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!href) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setHreflangs(currentLang: Lang) {
  if (typeof document === "undefined") return;
  // Remove existing alternates so we can re-emit a fresh set when the
  // active language (and therefore the URL) changes.
  document.head
    .querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')
    .forEach((el) => el.remove());
  const { pathname, search, hash, origin } = window.location;
  const replacePath = (target: Lang) =>
    pathname.replace(new RegExp(`^/(${LANGS.join("|")})(?=/|$)`), `/${target}`);
  const append = (hreflang: string, href: string) => {
    const link = document.createElement("link");
    link.setAttribute("rel", "alternate");
    link.setAttribute("hreflang", hreflang);
    link.setAttribute("href", href);
    document.head.appendChild(link);
  };
  for (const l of LANGS) {
    append(l, `${origin}${replacePath(l)}${search}${hash}`);
  }
  append("x-default", `${origin}${replacePath("en")}${search}${hash}`);
  void currentLang; // keeps a hook on lang to re-run the effect on switch
}

export function useSeo({ page, settings, fallbackTitle, fallbackDescription }: SeoOptions) {
  const { lang } = useSite();
  useEffect(() => {
    const title = page?.metaTitle || page?.title || fallbackTitle || "BiddiRides";
    const desc = page?.metaDescription || fallbackDescription || "";
    document.title = title;
    setMeta("description", desc);
    setMeta("keywords", page?.metaKeywords || null);
    setMeta("og:title", page?.ogTitle || title, "property");
    setMeta("og:description", page?.ogDescription || desc, "property");
    setMeta("og:locale", OG_LOCALES[lang] || OG_LOCALES.en, "property");
    const ogImage = page?.ogImage || settings?.defaultOgImage || null;
    setMeta("og:image", ogImage, "property");
    setMeta("og:type", "website", "property");
    setMeta("twitter:card", page?.twitterCard || "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", desc);
    setMeta("twitter:image", ogImage);
    setMeta("robots", page?.robotsIndex === false ? "noindex,nofollow" : "index,follow");
    setLink("canonical", page?.canonicalUrl || null);
    setHreflangs(lang);
  }, [page, settings, fallbackTitle, fallbackDescription, lang]);
}
