import { Stack } from "expo-router";
import React from "react";

export default function RiderLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="home" />
      <Stack.Screen
        name="destination"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="confirm-ride" />
      <Stack.Screen
        name="pick-on-map"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="bidding" />
      <Stack.Screen name="trip" />
      <Stack.Screen
        name="rate"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}
