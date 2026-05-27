import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useSite } from "@/lib/site-context";
import { tr } from "@/lib/i18n";
import { useSeo } from "@/lib/seo";
import { api } from "@/lib/api";
import { BlockRenderer } from "@/components/BlockRenderer";
import type { Lang, SitePage } from "@/lib/types";
import { Wrench } from "lucide-react";

function MaintenanceLogo({ url }: { url?: string }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  if (url && !errored) {
    return (
      <img
        src={url}
        alt="BiddiRides"
        className="max-h-12 w-auto object-contain"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">B</span>
      <span className="font-display font-bold text-lg">BiddiRides</span>
    </>
  );
}

function useCmsPage(slug: string, lang: Lang) {
  return useQuery({
    queryKey: ["site-page", slug, lang],
    queryFn: () => api<{ page: SitePage }>(`/site/pages/${slug}?lang=${lang}`).then((r) => r.page),
    retry: 0,
  });
}

export function NotFoundPage() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const { data } = useCmsPage("404", lang);
  useSeo({ page: data ?? null, settings, fallbackTitle: "404 — BiddiRides" });
  const heading = data?.content.heading || T.status.notFoundHeading;
  const sub = data?.content.subheading || T.status.notFoundSub;
  return (
    <div className="container-page py-32 text-center">
      <div className="text-7xl font-display font-bold text-primary">404</div>
      <h1 className="font-display text-2xl md:text-3xl font-bold mt-4">{heading}</h1>
      <p className="text-muted-foreground mt-3 max-w-md mx-auto">{sub}</p>
      <Link href={`/${lang}/`} className="btn-primary mt-8 inline-flex">{T.nav.home}</Link>
      {data?.content.blocks && data.content.blocks.length > 0 && (
        <div className="mt-12 text-start"><BlockRenderer blocks={data.content.blocks} /></div>
      )}
    </div>
  );
}

export function MaintenancePage({ message }: { message?: string }) {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const { data } = useCmsPage("maintenance", lang);
  useSeo({ page: data ?? null, settings, fallbackTitle: "Maintenance — BiddiRides" });
  const heading = data?.content.heading || T.status.maintenanceHeading;
  const sub = message || data?.content.subheading || T.status.maintenanceSub;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6 text-center">
      <div className="max-w-2xl">
        <div className="flex items-center justify-center gap-2 mb-6">
          <MaintenanceLogo url={settings?.footerLogoUrl || undefined} />
        </div>
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-secondary/10 text-secondary mb-6">
          <Wrench className="w-8 h-8" />
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">{heading}</h1>
        <p className="text-muted-foreground mt-3 max-w-md mx-auto">{sub}</p>
        {data?.content.blocks && data.content.blocks.length > 0 && (
          <div className="mt-10 text-start"><BlockRenderer blocks={data.content.blocks} /></div>
        )}
      </div>
    </div>
  );
}
