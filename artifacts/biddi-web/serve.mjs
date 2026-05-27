import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist", "public");
const ssrEntryPath = path.join(__dirname, "dist", "server", "entry-server.js");
const port = Number(process.env.PORT);
if (!port || Number.isNaN(port)) {
  throw new Error("PORT env required");
}
const apiBase = process.env.API_INTERNAL_URL || "http://localhost:80";
const basePath = process.env.BASE_PATH || "/";
// Normalized prefix without trailing slash, used to strip BASE_PATH from
// incoming `req.path` before language/slug parsing. Empty string when the
// app is mounted at the root.
const basePathPrefix = basePath.replace(/\/+$/, "");

function stripBasePath(p) {
  if (!basePathPrefix) return p;
  if (p === basePathPrefix) return "/";
  if (p.startsWith(basePathPrefix + "/")) return p.slice(basePathPrefix.length);
  return p;
}

const app = express();

const indexHtmlPromise = fs.readFile(path.join(distDir, "index.html"), "utf-8");

// Lazily import the SSR bundle. In production a missing bundle means the
// SEO objective is silently violated, so we surface a loud error and
// expose the failure on `/healthz` for monitoring. In non-production we
// keep the older permissive shell-only fallback so local dev keeps
// working when only the client build has run.
let ssrModulePromise = null;
let ssrLoadError = null;
async function getSsrRender() {
  if (!ssrModulePromise) {
    ssrModulePromise = import(ssrEntryPath).catch((err) => {
      ssrLoadError = err;
      const msg = `[biddi-web] SSR bundle failed to load (${err.message}); responses will fall back to shell-only render and SEO will regress.`;
      if (process.env.NODE_ENV === "production") {
        console.error(msg);
      } else {
        console.warn(msg);
      }
      return null;
    });
  }
  const mod = await ssrModulePromise;
  return mod?.render ?? null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape `</script>` so a CMS string can't break out of the JSON island we
// inline into <script> below.
function escapeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const RTL_LANGS = new Set(["ar"]);
function dirForLang(lang) {
  return RTL_LANGS.has(lang) ? "rtl" : "ltr";
}

function pickLangAndSlug(urlPath) {
  const m = urlPath.match(/^\/(en|fr|ar)(?:\/(.*))?$/);
  if (!m) return null;
  const lang = m[1];
  const rest = (m[2] || "").replace(/\/+$/, "");
  if (rest === "") return { lang, slug: "home" };
  const segments = rest.split("/");
  // Wouter's localized route patterns are single-segment (`/:lang/:slug`).
  // Multi-segment URLs (e.g. `/en/foo/bar`) don't match any client route,
  // so we surface them as not-found here — yields slug "404", a 404
  // status, and the localized not-found body, matching client behavior.
  if (segments.length > 1) return { lang, slug: "404" };
  return { lang, slug: segments[0] };
}

// Route-aware SEO fallback for non-CMS routes (auth, status pages). Mirrors
// the client `useSeo({ fallbackTitle })` calls in AuthPages / StatusPages so
// the first-response HTML carries the correct <title> and description even
// before React hydrates. CMS routes (e.g. `/en/about`) are not listed here —
// their meta comes from the API page payload.
const STATIC_ROUTE_SEO = {
  en: {
    signin: { title: "Sign in — BiddiRides", description: "Sign in to your BiddiRides account." },
    signup: { title: "Create account — BiddiRides", description: "Create a BiddiRides account to start riding." },
    "forgot-password": { title: "Forgot password? — BiddiRides", description: "Reset your BiddiRides password." },
    contact: { title: "Contact — BiddiRides", description: "Get in touch with the BiddiRides team." },
    maintenance: { title: "Maintenance — BiddiRides", description: "BiddiRides is temporarily unavailable." },
    "404": { title: "404 — BiddiRides", description: "The page you were looking for doesn't exist." },
  },
  fr: {
    signin: { title: "Se connecter — BiddiRides", description: "Connectez-vous à votre compte BiddiRides." },
    signup: { title: "Créer un compte — BiddiRides", description: "Créez un compte BiddiRides pour commencer." },
    "forgot-password": { title: "Mot de passe oublié ? — BiddiRides", description: "Réinitialisez votre mot de passe BiddiRides." },
    contact: { title: "Contact — BiddiRides", description: "Contactez l'équipe BiddiRides." },
    maintenance: { title: "Maintenance — BiddiRides", description: "BiddiRides est temporairement indisponible." },
    "404": { title: "404 — BiddiRides", description: "La page que vous cherchiez n'existe pas." },
  },
  ar: {
    signin: { title: "تسجيل الدخول — BiddiRides", description: "سجّل الدخول إلى حسابك في BiddiRides." },
    signup: { title: "إنشاء حساب — BiddiRides", description: "أنشئ حساب BiddiRides لبدء التنقل." },
    "forgot-password": { title: "نسيت كلمة المرور؟ — BiddiRides", description: "أعد تعيين كلمة مرور حسابك في BiddiRides." },
    contact: { title: "اتصل بنا — BiddiRides", description: "تواصل مع فريق BiddiRides." },
    maintenance: { title: "صيانة — BiddiRides", description: "BiddiRides غير متاح مؤقتًا." },
    "404": { title: "404 — BiddiRides", description: "الصفحة التي تبحث عنها غير موجودة." },
  },
};

function getStaticRouteSeo(lang, slug) {
  const byLang = STATIC_ROUTE_SEO[lang] || STATIC_ROUTE_SEO.en;
  return byLang[slug] || null;
}

async function fetchPageMeta(slug, lang) {
  try {
    const url = `${apiBase}/api/site/pages/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.page || null;
  } catch {
    return null;
  }
}

async function fetchSettings() {
  try {
    const res = await fetch(`${apiBase}/api/site/settings`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.settings || null;
  } catch {
    return null;
  }
}

const SUPPORTED_LANGS = ["en", "fr", "ar"];
const OG_LOCALES = { en: "en_US", fr: "fr_FR", ar: "ar_AR" };

function alternateUrlForLang(urlPath, currentLang, targetLang, proto, host) {
  const replaced = urlPath.replace(
    new RegExp(`^(${basePathPrefix || ""})/(${SUPPORTED_LANGS.join("|")})(?=/|$)`),
    `$1/${targetLang}`,
  );
  return `${proto}://${host}${replaced}`;
}

function renderMetaTags({ page, settings, lang, urlPath, host, proto, routeSeo }) {
  const title = page?.metaTitle || page?.title || routeSeo?.title || "BiddiRides";
  const desc = page?.metaDescription || routeSeo?.description || "";
  const ogTitle = page?.ogTitle || title;
  const ogDesc = page?.ogDescription || desc;
  const ogImage = page?.ogImage || settings?.defaultOgImage || "";
  const twitterCard = page?.twitterCard || "summary_large_image";
  const robots = page?.robotsIndex === false ? "noindex,nofollow" : "index,follow";
  const canonical = page?.canonicalUrl || `${proto}://${host}${urlPath}`;
  const ogLocale = OG_LOCALES[lang] || OG_LOCALES.en;
  const hreflangs = SUPPORTED_LANGS.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${escapeHtml(alternateUrlForLang(urlPath, lang, l, proto, host))}" />`,
  ).concat(
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(alternateUrlForLang(urlPath, lang, "en", proto, host))}" />`,
  );
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    page?.metaKeywords ? `<meta name="keywords" content="${escapeHtml(page.metaKeywords)}" />` : "",
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    ...hreflangs,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(ogDesc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:locale" content="${escapeHtml(ogLocale)}" />`,
    ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : "",
    `<meta name="twitter:card" content="${escapeHtml(twitterCard)}" />`,
    `<meta name="twitter:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(ogDesc)}" />`,
  ].filter(Boolean).join("\n    ");
}

function injectMeta(html, { page, settings, lang, urlPath, host, proto, routeSeo }) {
  const meta = renderMetaTags({ page, settings, lang, urlPath, host, proto, routeSeo });
  const dir = dirForLang(lang);
  let next = html
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, "");
  // Replace the entire <html ...> opening tag so both `lang` and `dir`
  // reflect the resolved request language on the very first byte.
  next = next.replace(/<html[^>]*>/, `<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}">`);
  next = next.replace("</head>", `    ${meta}\n  </head>`);
  return next;
}

function injectBody(html, { appHtml, initialData }) {
  const dataScript = `<script>window.__BIDDI_BASE_PATH__=${escapeJsonForScript(basePath)};window.__BIDDI_INITIAL_DATA__=${escapeJsonForScript(initialData)};</script>`;
  // Replace the empty root container with the SSR-rendered markup, and
  // inline the initial data right before it so main.tsx sees it on first
  // execution. Using a regex tolerates whitespace/attributes Vite may add.
  const rootRe = /<div\s+id="root"[^>]*>\s*<\/div>/;
  if (rootRe.test(html)) {
    return html.replace(rootRe, `${dataScript}<div id="root">${appHtml}</div>`);
  }
  // Fallback: append before </body>.
  return html.replace("</body>", `${dataScript}<div id="root">${appHtml}</div></body>`);
}

app.get("/healthz", async (_req, res) => {
  // Touch the SSR module so a missing/broken bundle is reflected here
  // rather than only surfacing on the first user request.
  const render = await getSsrRender();
  const ssrOk = !ssrLoadError && typeof render === "function";
  res.status(ssrOk ? 200 : 503).json({
    ok: ssrOk,
    ssr: ssrOk ? "ready" : "unavailable",
    error: ssrLoadError ? String(ssrLoadError.message || ssrLoadError) : undefined,
  });
});

// Server-side redirect for the root URL so crawlers/users don't receive
// an empty shell while a client-side redirect runs. Uses an Accept-
// Language hint to pick `fr` vs the default `en`.
function pickLangFromHeader(header) {
  if (!header) return "en";
  const langs = String(header)
    .split(",")
    .map((p) => p.split(";")[0].trim().toLowerCase());
  for (const l of langs) {
    if (l === "ar" || l.startsWith("ar-") || l.startsWith("ar_")) return "ar";
    if (l === "fr" || l.startsWith("fr-")) return "fr";
    if (l === "en" || l.startsWith("en-")) return "en";
  }
  return "en";
}

function redirectToDefaultLang(req, res) {
  const lang = pickLangFromHeader(req.headers["accept-language"]);
  const target = `${basePathPrefix || ""}/${lang}/`;
  res.redirect(302, target);
}

app.get("/", redirectToDefaultLang);
// When deployed under a non-root BASE_PATH (e.g. `/marketing`), the bare
// prefix should also redirect into the localized tree instead of falling
// through to the SSR handler with no language match.
if (basePathPrefix) {
  app.get(basePathPrefix, redirectToDefaultLang);
  app.get(basePathPrefix + "/", redirectToDefaultLang);
}

app.get(/.*/, async (req, res, next) => {
  // Static assets: anything with a file extension or under /assets goes to static handler
  if (/\.[a-zA-Z0-9]+$/.test(req.path) || req.path.startsWith("/assets/")) return next();

  // Strip BASE_PATH so a deploy mounted at e.g. `/marketing` still parses
  // `/marketing/en/about` as lang=en, slug=about.
  const routePath = stripBasePath(req.path);
  const match = pickLangAndSlug(routePath);
  const lang = match?.lang || "en";
  // For non-localized URLs (e.g. `/foo`) we treat the slug as "404" so
  // metadata/prefetch correctly describe a not-found resource instead of
  // pretending the home page lives there.
  const slug = match?.slug || (routePath === "/" ? "home" : "404");

  // We always try the CMS first so any slug that exists in the CMS (e.g.
  // a CMS-managed `maintenance` or `404` page) wins. `routeSeo` provides
  // a route-aware fallback for non-CMS routes (signin / signup /
  // forgot-password / etc.) so first-response meta is still correct when
  // the API has nothing for that slug.
  const routeSeo = getStaticRouteSeo(lang, slug);
  const [page, settings, html, render] = await Promise.all([
    fetchPageMeta(slug, lang),
    fetchSettings(),
    indexHtmlPromise,
    getSsrRender(),
  ]);

  const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();

  // If neither the CMS nor the static-route map has anything for this
  // slug, fall back to the localized 404 meta so unmatched URLs (e.g.
  // `/en/not-real`) advertise themselves as not-found to crawlers
  // instead of inheriting a generic "BiddiRides" title.
  const effectiveRouteSeo =
    routeSeo || (!page && slug !== "home" ? getStaticRouteSeo(lang, "404") : null);

  let out = injectMeta(html, {
    page,
    settings,
    lang,
    urlPath: req.path,
    host,
    proto,
    routeSeo: effectiveRouteSeo,
  });

  if (render) {
    let appHtml = "";
    try {
      appHtml = render({
        url: req.path,
        basePath,
        lang,
        slug,
        page,
        settings,
      });
    } catch (err) {
      // SSR failures must never take down the page: fall back to client-only.
      console.warn("[biddi-web] SSR render failed, serving shell:", err);
      appHtml = "";
    }
    out = injectBody(out, {
      appHtml,
      initialData: { lang, settings, page, slug },
    });
  }

  // Two not-found cases produce a 404 status:
  //   1. Localized URL (e.g. `/en/no-such-page`) — match is non-null but
  //      neither the CMS nor the static-route map knows the slug.
  //   2. Non-localized URL (e.g. `/foo`) — match is null and we forced
  //      slug="404" above, so `page` is null too.
  const isUnknownLocalized =
    match !== null && !page && (slug === "404" || (!routeSeo && slug !== "home"));
  const isUnknownNonLocalized = match === null && routePath !== "/";
  const isUnknownRoute = isUnknownLocalized || isUnknownNonLocalized;

  res.setHeader("content-type", "text/html; charset=utf-8");
  // Short TTL + stale-while-revalidate keeps marketing pages fast at the
  // edge while still picking up CMS edits within a minute. 404 responses
  // are not cached so a freshly-published slug surfaces immediately.
  if (isUnknownRoute) {
    res.setHeader("cache-control", "no-store");
    res.status(404);
  } else {
    res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
  }
  res.send(out);
});

app.use(express.static(distDir, { index: false, maxAge: "1h" }));

// In production we require the SSR bundle to load successfully on boot —
// silently degrading to a shell render would silently regress SEO. In
// non-production we keep the permissive behavior.
async function ensureSsrReadyInProd() {
  if (process.env.NODE_ENV !== "production") return;
  const render = await getSsrRender();
  if (!render) {
    console.error(
      `[biddi-web] FATAL: SSR bundle (${ssrEntryPath}) unavailable in production. Refusing to start.`,
    );
    process.exit(1);
  }
}

ensureSsrReadyInProd().then(() => {
  app.listen(port, "0.0.0.0", () => {
    console.log(`[biddi-web] serving on :${port} (api=${apiBase}, ssr=${ssrEntryPath})`);
  });
});
