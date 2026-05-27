import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Menu, X, Globe } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { tr, LANGS, isRtl } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const LANG_LABELS: Record<Lang, string> = { en: "EN", fr: "FR", ar: "العربية" };

function HeaderLogo({ url }: { url?: string }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  if (url && !errored) {
    return (
      <img
        src={url}
        alt="BiddiRides"
        className="h-9 md:h-10 w-auto max-w-[180px] object-contain"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">B</span>
      <span className="font-display font-bold text-lg text-foreground">BiddiRides</span>
    </>
  );
}

export function Header() {
  const { lang, setLang, settings } = useSite();
  const T = tr(lang);
  const rtl = isRtl(lang);
  const [open, setOpen] = useState(false);
  const [loc] = useLocation();

  const link = (slug: string, label: string) => {
    const href = slug === "" ? `/${lang}/` : `/${lang}/${slug}`;
    const active = loc === href || (slug !== "" && loc === `/${lang}/${slug}`);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        className={`px-3 py-2 text-sm font-medium transition-colors ${active ? "text-primary" : "text-foreground/80 hover:text-foreground"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b border-border">
      <div className="container-page flex items-center justify-between h-16">
        <Link href={`/${lang}/`} className="flex items-center gap-2">
          <HeaderLogo url={settings?.headerLogoUrl || undefined} />
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {link("how-it-works", T.nav.how)}
          {link("intercity", T.nav.intercity)}
          {link("rental-packages", T.nav.rentals)}
          {link("faq", T.nav.faq)}
          {link("about", T.nav.about)}
          {link("contact", T.nav.contact)}
        </nav>
        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <select
              aria-label={T.footer.language}
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="appearance-none bg-transparent border border-border rounded-full ps-8 pe-3 py-1.5 text-sm font-medium hover:bg-muted cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {LANGS.map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
            </select>
            <Globe className={`w-4 h-4 absolute ${rtl ? "right-2.5" : "left-2.5"} top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none`} />
          </div>
          <Link href={`/${lang}/signin`} className="btn-outline !py-1.5 !px-4 text-sm">{T.nav.signin}</Link>
          <Link href={`/${lang}/signup`} className="btn-primary !py-1.5 !px-4 text-sm">{T.nav.signup}</Link>
        </div>
        <button className="md:hidden p-2" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="container-page py-3 flex flex-col">
            {link("how-it-works", T.nav.how)}
            {link("intercity", T.nav.intercity)}
            {link("rental-packages", T.nav.rentals)}
            {link("faq", T.nav.faq)}
            {link("about", T.nav.about)}
            {link("contact", T.nav.contact)}
            <div className="flex items-center gap-2 mt-3">
              <select
                aria-label={T.footer.language}
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                className="border border-border rounded-full px-3 py-1.5 text-sm bg-card"
              >
                {LANGS.map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
              </select>
              <Link href={`/${lang}/signin`} onClick={() => setOpen(false)} className="btn-outline !py-1.5 !px-4 text-sm flex-1">{T.nav.signin}</Link>
              <Link href={`/${lang}/signup`} onClick={() => setOpen(false)} className="btn-primary !py-1.5 !px-4 text-sm flex-1">{T.nav.signup}</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
