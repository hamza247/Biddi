// EXPO_PUBLIC_DOMAIN is provided automatically in Replit. Falls back to a configurable base.
export function defaultApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE;
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://localhost:8080";
}

/**
 * Returns true when an explicit environment URL is configured via
 * EXPO_PUBLIC_API_BASE or EXPO_PUBLIC_DOMAIN. When this is true, the
 * environment URL should take unconditional priority over any persisted URL.
 */
export function hasEnvApiBase(): boolean {
  return !!(process.env.EXPO_PUBLIC_API_BASE || process.env.EXPO_PUBLIC_DOMAIN);
}
