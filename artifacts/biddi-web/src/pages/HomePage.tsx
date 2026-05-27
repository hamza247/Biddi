import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Apple, Smartphone, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { SitePage } from "@/lib/types";
import { useSite } from "@/lib/site-context";
import { useSeo } from "@/lib/seo";
import { BlockRenderer } from "@/components/BlockRenderer";
import { tr } from "@/lib/i18n";

export function HomePage() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const { data } = useQuery({
    queryKey: ["site-page", "home", lang],
    queryFn: () => api<{ page: SitePage }>(`/site/pages/home?lang=${lang}`).then((r) => r.page),
    retry: 0,
  });

  useSeo({ page: data ?? null, settings });

  const c = data?.content;

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 via-background to-background" />
        <div className="container-page py-20 md:py-28 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {T.home.badge}
          </span>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight max-w-4xl mx-auto leading-[1.05]">
            {c?.heading || T.home.defaultHeading}
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            {c?.subheading}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href={`/${lang}/signup`} className="btn-primary">
              {T.nav.signup} <ArrowRight className="w-4 h-4 rtl:-scale-x-100" />
            </Link>
            <Link href={`/${lang}/how-it-works`} className="btn-outline">{T.cta.learnMore}</Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            <a href={settings?.appStoreUrl || "#"} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background hover:opacity-90 transition">
              <Apple className="w-4 h-4" /> App Store
            </a>
            <a href={settings?.playStoreUrl || "#"} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background hover:opacity-90 transition">
              <Smartphone className="w-4 h-4" /> Google Play
            </a>
          </div>
        </div>
      </section>

      <BlockRenderer blocks={c?.blocks ?? []} />
    </>
  );
}
