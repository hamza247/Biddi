import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";

export default function Index() {
  const { ready, user } = useAuth();
  const c = useColors();

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;
  // Legacy users created with phone-only OTP haven't set an email/password
  // yet. Force them through the completion screen before using the app.
  if (!user.email || !user.hasPassword) return <Redirect href={"/complete-profile" as never} />;
  if (user.appMode === "driver") {
    // Approved drivers go to their dashboard; mid-onboarding drivers go back
    // to the application flow so they can finish.
    if (user.driverStatus === "approved") return <Redirect href="/(driver)/home" />;
    return <Redirect href="/become-driver" />;
  }
  return <Redirect href="/(rider)/home" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
