import * as Updates from "expo-updates";
import React, { createContext, useCallback, useContext, useState } from "react";
import { Alert, I18nManager } from "react-native";

import i18n, { type AppLanguage, saveLanguage } from "@/i18n";

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: async () => {},
});

export function LanguageProvider({
  children,
  initialLanguage,
}: {
  children: React.ReactNode;
  initialLanguage: AppLanguage;
}) {
  const [language, setLanguageState] = useState<AppLanguage>(initialLanguage);

  const setLanguage = useCallback(async (lang: AppLanguage) => {
    setLanguageState(lang);
    await saveLanguage(lang);
    i18n.changeLanguage(lang);

    const needsRtlChange =
      (lang === "ar" && !I18nManager.isRTL) ||
      (lang !== "ar" && I18nManager.isRTL);

    if (needsRtlChange) {
      I18nManager.forceRTL(lang === "ar");
      Alert.alert(
        i18n.t("language.restartRequired"),
        i18n.t("language.restartMessage"),
        [
          {
            text: i18n.t("language.reloadLater"),
            style: "cancel",
          },
          {
            text: i18n.t("language.reloadNow"),
            onPress: async () => {
              try {
                await Updates.reloadAsync();
              } catch {
                Alert.alert(
                  i18n.t("language.restartRequired"),
                  i18n.t("language.reloadFailed"),
                );
              }
            },
          },
        ],
      );
    }
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
