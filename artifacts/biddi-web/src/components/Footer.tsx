import { Link } from "wouter";
import { useEffect, useState } from "react";
import { Facebook, Twitter, Instagram, Linkedin } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { tr } from "@/lib/i18n";

function FooterLogo({ url }: { url?: string }) {
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

export function Footer() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const link = (slug: string, label: string) => (
    <Link href={`/${lang}/${slug}`} className="block py-1 text-sm text-muted-foreground hover:text-foreground transition-colors">{label}</Link>
  );
  return (
    <footer className="border-t border-border bg-card mt-20">
      <div className="container-page py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <FooterLogo url={settings?.footerLogoUrl || undefined} />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm">{T.footer.tagline}</p>
          <div className="flex gap-3 mt-4">
            {settings?.socialFacebook && <a href={settings.socialFacebook} target="_blank" rel="noopener noreferrer" className="p-2 rounded-full bg-muted hover:bg-border" aria-label="Facebook"><Facebook className="w-4 h-4" /></a>}
            {settings?.socialTwitter && <a href={settings.socialTwitter} target="_blank" rel="noopener noreferrer" className="p-2 rounded-full bg-muted hover:bg-border" aria-label="Twitter"><Twitter className="w-4 h-4" /></a>}
            {settings?.socialInstagram && <a href={settings.socialInstagram} target="_blank" rel="noopener noreferrer" className="p-2 rounded-full bg-muted hover:bg-border" aria-label="Instagram"><Instagram className="w-4 h-4" /></a>}
            {settings?.socialLinkedin && <a href={settings.socialLinkedin} target="_blank" rel="noopener noreferrer" className="p-2 rounded-full bg-muted hover:bg-border" aria-label="LinkedIn"><Linkedin className="w-4 h-4" /></a>}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">{T.footer.product}</h4>
          {link("how-it-works", T.nav.how)}
          {link("intercity", T.nav.intercity)}
          {link("rental-packages", T.nav.rentals)}
          {link("trust-safety", T.footer.trustSafety)}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">{T.footer.company}</h4>
          {link("about", T.nav.about)}
          {link("contact", T.nav.contact)}
          {link("help", T.nav.help)}
          {link("faq", T.nav.faq)}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">{T.footer.legal}</h4>
          {link("privacy", T.footer.privacy)}
          {link("terms", T.footer.terms)}
          {link("legal", T.footer.legalNotice)}
          {link("safety-guidelines", T.footer.safetyGuidelines)}
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page py-4 flex flex-col sm:flex-row justify-between gap-3 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} BiddiRides. {T.footer.rights}</div>
          {settings?.contactEmail && <div>{settings.contactEmail}</div>}
        </div>
      </div>
    </footer>
  );
}
