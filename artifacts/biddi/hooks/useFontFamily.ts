import { useMemo } from "react";

import { useLanguage } from "@/context/LanguageContext";

export interface FontFamilies {
  regular: string;
  medium: string;
  semiBold: string;
  bold: string;
  isRTL: boolean;
  /**
   * Multiplier applied on top of a font size to derive a comfortable
   * line-height for the active script. Mirrors the web (`line-height: 1.7`
   * for Arabic via Cairo) so body copy reads with the same density across
   * web and mobile.
   */
  lineHeightMultiplier: number;
  /**
   * Returns the line-height a body Text of `fontSize` should use for the
   * active language. Mirrors the web's body-copy leading: ~1.7 for Arabic
   * (Cairo) and ~1.4 for Latin scripts (Inter). Use this inline on Text
   * styles that carry meaningful body copy so Arabic users get the same
   * legibility as on the web.
   */
  getBodyLineHeight: (fontSize: number) => number;
}

export function useFontFamily(): FontFamilies {
  const { language } = useLanguage();
  const isArabic = language === "ar";
  const lineHeightMultiplier = isArabic ? 1.7 : 1.4;
  return useMemo(
    () => ({
      regular: isArabic ? "Cairo_400Regular" : "Inter_400Regular",
      medium: isArabic ? "Cairo_500Medium" : "Inter_500Medium",
      semiBold: isArabic ? "Cairo_600SemiBold" : "Inter_600SemiBold",
      bold: isArabic ? "Cairo_700Bold" : "Inter_700Bold",
      isRTL: isArabic,
      lineHeightMultiplier,
      getBodyLineHeight: (fontSize: number) =>
        Math.round(fontSize * lineHeightMultiplier),
    }),
    [isArabic, lineHeightMultiplier],
  );
}
