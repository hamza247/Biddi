import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./ar.json";
import en from "./en.json";
import fr from "./fr.json";

export type AppLanguage = "en" | "ar" | "fr";

export const LANGUAGE_KEY = "@biddi_language";

export const LANGUAGES: { code: AppLanguage; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية" },
  { code: "fr", label: "French", nativeLabel: "Français" },
];

export async function getSavedLanguage(): Promise<AppLanguage> {
  try {
    const lang = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (lang === "en" || lang === "ar" || lang === "fr") return lang;
  } catch {
    // ignore
  }
  return "en";
}

export async function saveLanguage(lang: AppLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function initI18n(language: AppLanguage = "en"): void {
  if (i18n.isInitialized) {
    i18n.changeLanguage(language);
    return;
  }
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        ar: { translation: ar },
        fr: { translation: fr },
      },
      lng: language,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
}

export default i18n;
