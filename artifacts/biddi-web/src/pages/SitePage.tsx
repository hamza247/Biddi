import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SitePage } from "@/lib/types";
import { useSite } from "@/lib/site-context";
import { useSeo } from "@/lib/seo";
import { BlockRenderer } from "@/components/BlockRenderer";
import { Link } from "wouter";
import { tr } from "@/lib/i18n";

function Inline404() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const { data } = useQuery({
    queryKey: ["site-page", "404", lang],
    queryFn: () => api<{ page: SitePage }>(`/site/pages/404?lang=${lang}`).then((r) => r.page),
    retry: 0,
  });
  useSeo({ page: data ?? null, settings, fallbackTitle: "404 — BiddiRides" });
  const heading = data?.content.heading || T.sitePage.notFoundHeading;
  const sub = data?.content.subheading || T.sitePage.notFoundSub;
  return (
    <div className="container-page py-32 text-center">
      <div className="text-7xl font-display font-bold text-primary">404</div>
      <h1 className="font-display text-3xl font-bold mt-4">{heading}</h1>
      <p className="text-muted-foreground mt-3 max-w-md mx-auto">{sub}</p>
      <Link href={`/${lang}/`} className="btn-primary mt-8 inline-flex">{T.nav.home}</Link>
      {data?.content.blocks && data.content.blocks.length > 0 && (
        <div className="mt-12 text-start"><BlockRenderer blocks={data.content.blocks} /></div>
      )}
    </div>
  );
}

interface Props {
  slug: string;
  /** When provided, replaces the auto hero. Used for sign-in/up etc. */
  customHero?: { title?: string; subtitle?: string };
  children?: React.ReactNode;
}

export function SitePage({ slug, customHero, children }: Props) {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["site-page", slug, lang],
    queryFn: () => api<{ page: SitePage }>(`/site/pages/${slug}?lang=${lang}`).then((r) => r.page),
    retry: 0,
  });

  useSeo({ page: data ?? null, settings, fallbackTitle: customHero?.title || slug, fallbackDescription: customHero?.subtitle });

  // `data === undefined` means the cache is genuinely empty (still
  // fetching). When the SSR / hydration layer seeded the cache with
  // `null` (page not found) or a real page, we render the matching view
  // synchronously so search engines and the first paint never see
  // "Loading…".
  if (isLoading && data === undefined) {
    return <div className="container-page py-32 text-center text-muted-foreground">{T.sitePage.loading}</div>;
  }
  if (isError || !data) {
    return <Inline404 />;
  }

  const c = data.content;
  return (
    <>
      <section className="container-page py-12 md:py-20 text-center">
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">{customHero?.title || c.heading || data.title}</h1>
        {(customHero?.subtitle || c.subheading) && (
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">{customHero?.subtitle || c.subheading}</p>
        )}
      </section>
      {children}
      <BlockRenderer blocks={c.blocks ?? []} />
    </>
  );
}
