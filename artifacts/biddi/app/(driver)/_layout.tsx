import { Stack } from "expo-router";
import React from "react";

export default function DriverLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="trip" />
      <Stack.Screen
        name="earnings"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="wallet"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="quests"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="quest-detail"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="destination"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="rate"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="trip-detail"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="incoming-bidding"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="my-bids"
        options={{ animation: "slide_from_right" }}
      />
    </Stack>
  );
}
