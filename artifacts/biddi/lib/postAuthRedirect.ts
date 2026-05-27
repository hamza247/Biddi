import type { Router } from "expo-router";

import type { User } from "@/lib/types";

/** Centralised post-authentication routing logic so that every successful
 * sign-in (password, OTP, biometric) lands on the right surface based on the
 * user's app mode and driver onboarding status. The legacy "needs profile
 * completion" check is handled by the caller before invoking this. */
export function routeAfterAuth(router: Router, user: User): void {
  if (user.appMode === "driver") {
    if (user.driverStatus === "approved") {
      router.replace("/(driver)/home");
      return;
    }
    // Driver who hasn't finished onboarding — send them to the application
    // flow rather than the rider home.
    router.replace("/become-driver");
    return;
  }
  router.replace("/(rider)/home");
}
