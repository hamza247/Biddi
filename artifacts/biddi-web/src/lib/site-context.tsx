import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { api } from "./api";
import type { Lang, SiteSettings } from "./types";
import { LANGS, isRtl } from "./i18n";

interface SiteCtxValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  settings: SiteSettings | null;
  refreshSettings: () => Promise<void>;
}

const SiteContext = createContext<SiteCtxValue | null>(null);

const LANG_KEY = "biddi.web.lang";

function detectLang(pathname: string): Lang {
  const seg = pathname.replace(/^\//, "").split("/")[0];
  if (LANGS.includes(seg as Lang)) return seg as Lang;
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && LANGS.includes(stored as Lang)) return stored as Lang;
  } catch {}
  if (typeof navigator !== "undefined") {
    const nav = navigator.language?.toLowerCase() ?? "";
    if (nav.startsWith("ar")) return "ar";
    if (nav.startsWith("fr")) return "fr";
  }
  return "en";
}

interface SiteProviderProps {
  children: ReactNode;
  initialLang?: Lang;
  initialSettings?: SiteSettings | null;
}

export function SiteProvider({ children, initialLang, initialSettings }: SiteProviderProps) {
  const [location, setLocation] = useLocation();
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? detectLang(location));
  const [settings, setSettings] = useState<SiteSettings | null>(initialSettings ?? null);

  const refreshSettings = async () => {
    try {
      const res = await api<{ settings: SiteSettings }>("/site/settings");
      setSettings(res.settings);
    } catch {
      // Keep any previously-supplied (e.g. SSR) settings on failure.
    }
  };

  useEffect(() => {
    if (!initialSettings) void refreshSettings();
  }, []);

  useEffect(() => {
    const detected = detectLang(location);
    if (detected !== lang) setLangState(detected);
  }, [location]);

  // Reflect the active language and direction on <html> so RTL layout,
  // CSS direction-aware rules, and assistive tech all match the URL.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (next: Lang) => {
    try { localStorage.setItem(LANG_KEY, next); } catch {}
    setLangState(next);
    const segs = location.replace(/^\//, "").split("/");
    if (LANGS.includes(segs[0] as Lang)) {
      segs[0] = next;
    } else {
      segs.unshift(next);
    }
    setLocation("/" + segs.join("/"));
  };

  return (
    <SiteContext.Provider value={{ lang, setLang, settings, refreshSettings }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite must be used within SiteProvider");
  return ctx;
}
