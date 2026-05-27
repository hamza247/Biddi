import { useMemo, type ReactNode } from "react";
import { Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Lang, SitePage, SiteSettings } from "@/lib/types";
import { SiteProvider } from "@/lib/site-context";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 0, staleTime: 30_000 } },
  });
}

const browserQueryClient = typeof window !== "undefined" ? makeQueryClient() : null;

interface AppProps {
  /** Concrete `<Routes />` element. Differs between client (lazy) and SSR (eager). */
  children: ReactNode;
  /** SSR-only: pre-resolved URL path used by wouter on the server. */
  ssrPath?: string;
  /** Router base path (defaults to `import.meta.env.BASE_URL` on the client). */
  basePath?: string;
  /** SSR-only: provide a request-scoped QueryClient with prefetched data. */
  queryClient?: QueryClient;
  /** SSR-only: skip lang detection (no window/localStorage on server). */
  initialLang?: Lang;
  /** SSR-only: pre-fetched site settings, also avoids a client round-trip. */
  initialSettings?: SiteSettings | null;
  /** SSR + hydration: pre-fetched CMS page, seeded into the React Query cache. */
  initialPage?: SitePage | null;
  /** SSR + hydration: slug paired with `initialPage`, used as the cache key. */
  initialSlug?: string | null;
}

function App({
  children,
  ssrPath,
  basePath,
  queryClient,
  initialLang,
  initialSettings,
  initialPage,
  initialSlug,
}: AppProps) {
  const resolvedBase = (
    basePath ??
    (typeof window !== "undefined"
      ? window.__BIDDI_BASE_PATH__ ?? import.meta.env.BASE_URL
      : "/")
  ).replace(/\/$/, "");

  const client = useMemo(() => queryClient ?? browserQueryClient ?? makeQueryClient(), [queryClient]);

  // Seed the React Query cache so SitePage / HomePage render immediately
  // both during SSR and on client hydration without flashing a loading
  // state. We seed even when `initialPage` is null — that's a definitive
  // "the API said this slug does not exist" answer, which lets SitePage
  // render its inline 404 view synchronously instead of "Loading…".
  if (initialSlug && initialLang) {
    const key = ["site-page", initialSlug, initialLang];
    if (client.getQueryData(key) === undefined) {
      client.setQueryData(key, initialPage ?? null);
    }
  }

  return (
    <QueryClientProvider client={client}>
      <WouterRouter base={resolvedBase} ssrPath={ssrPath}>
        <SiteProvider initialLang={initialLang} initialSettings={initialSettings}>
          {children}
        </SiteProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

declare global {
  interface Window {
    __BIDDI_BASE_PATH__?: string;
    __BIDDI_INITIAL_DATA__?: {
      lang: Lang;
      settings: SiteSettings | null;
      page: SitePage | null;
      slug: string | null;
    };
  }
}

export default App;
