import { renderToString } from "react-dom/server";
import App from "./App";
import { Routes } from "./routes.server";
import type { Lang, SitePage, SiteSettings } from "./lib/types";

interface RenderArgs {
  url: string;
  basePath: string;
  lang: Lang;
  slug: string | null;
  page: SitePage | null;
  settings: SiteSettings | null;
}

export function render({ url, basePath, lang, slug, page, settings }: RenderArgs): string {
  // Per-request render. Wouter's `ssrPath` pins the route to this URL and
  // `basePath` mirrors the client config so route matching is identical.
  // The eager `Routes` import (see `routes.server.tsx`) ensures every
  // route component is rendered synchronously without Suspense fallback.
  return renderToString(
    <App
      ssrPath={url}
      basePath={basePath}
      initialLang={lang}
      initialSettings={settings}
      initialPage={page}
      initialSlug={slug}
    >
      <Routes />
    </App>,
  );
}
