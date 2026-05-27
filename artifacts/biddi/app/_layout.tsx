import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
} from "@expo-google-fonts/cairo";
import { Feather } from "@expo/vector-icons";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { I18nManager, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StripeProvider } from "@stripe/stripe-react-native";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReconnectingBanner } from "@/components/ReconnectingBanner";
import { AppProvider } from "@/context/AppContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { type AppLanguage, getSavedLanguage, initI18n } from "@/i18n";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="complete-profile" />
      <Stack.Screen name="(rider)" />
      <Stack.Screen name="(driver)" />
      <Stack.Screen
        name="profile"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="become-driver"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="personal-info"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="reupload-docs"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="referrals"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="quick-replies"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...Feather.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Cairo_400Regular,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
  });

  const [initialLanguage, setInitialLanguage] = useState<AppLanguage | null>(null);

  useEffect(() => {
    getSavedLanguage().then((lang) => {
      I18nManager.forceRTL(lang === "ar");
      initI18n(lang);
      setInitialLanguage(lang);
    });
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && initialLanguage !== null) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, initialLanguage]);

  if ((!fontsLoaded && !fontError) || initialLanguage === null) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <LanguageProvider initialLanguage={initialLanguage}>
              <QueryClientProvider client={queryClient}>
              <StripeProvider
                publishableKey={
                  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
                }
                merchantIdentifier="merchant.com.biddi"
              >
              <AppProvider>
                <View style={{ flex: 1 }}>
                  <StatusBar style="dark" />
                  <RootLayoutNav />
                  <ReconnectingBanner />
                </View>
              </AppProvider>
              </StripeProvider>
              </QueryClientProvider>
            </LanguageProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
