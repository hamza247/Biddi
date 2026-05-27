import { SettingsForm } from "./SettingsForm";
import type { SectionDef } from "./types";

const SECTIONS: SectionDef[] = [
  {
    title: "Footer links",
    fields: [
      { key: "footerFacebookUrl", label: "Facebook URL", kind: "url", placeholder: "https://facebook.com/biddi" },
      { key: "footerTwitterUrl", label: "Twitter / X URL", kind: "url" },
      { key: "footerLinkedinUrl", label: "LinkedIn URL", kind: "url" },
      { key: "footerInstagramUrl", label: "Instagram URL", kind: "url" },
      { key: "footerGoogleUrl", label: "Google URL", kind: "url" },
    ],
  },
  {
    title: "Google OAuth",
    fields: [
      { key: "googleOAuthAppName", label: "App name", kind: "text" },
      { key: "googleOAuthClientId", label: "Client ID", kind: "text" },
      { key: "googleOAuthClientSecret", label: "Client secret", kind: "secret" },
      { key: "googleOAuthRedirectUrl", label: "Redirect URL", kind: "url" },
      { key: "googleOAuthSiteLink", label: "Site link", kind: "url" },
    ],
  },
  {
    title: "Facebook",
    fields: [
      { key: "facebookAppId", label: "Facebook app ID", kind: "text" },
      { key: "facebookClientToken", label: "Facebook client token", kind: "secret" },
      { key: "facebookAppSecret", label: "Facebook app secret", kind: "secret" },
      { key: "facebookPixelId", label: "Facebook Pixel ID", kind: "text" },
    ],
  },
  {
    title: "Social login toggles",
    fields: [
      { key: "socialLoginFacebookDriver", label: "Facebook login (driver)", kind: "boolean" },
      { key: "socialLoginGoogleDriver", label: "Google login (driver)", kind: "boolean" },
      { key: "socialLoginAppleDriver", label: "Apple login (driver)", kind: "boolean" },
      { key: "socialLoginFacebookUser", label: "Facebook login (rider)", kind: "boolean" },
      { key: "socialLoginGoogleUser", label: "Google login (rider)", kind: "boolean" },
      { key: "socialLoginAppleUser", label: "Apple login (rider)", kind: "boolean" },
    ],
  },
  {
    title: "Ads — Google AdMob",
    fields: [
      { key: "adsByGoogleEnabled", label: "Enable Google ads (AdMob)", kind: "boolean" },
      { key: "admobWebClientId", label: "AdMob client ID — Web", kind: "text" },
      { key: "admobIosStoreClientId", label: "AdMob client ID — iOS Store", kind: "text" },
      { key: "admobIosDriverClientId", label: "AdMob client ID — iOS Driver", kind: "text" },
      { key: "admobIosPassengerClientId", label: "AdMob client ID — iOS Passenger", kind: "text" },
    ],
  },
  {
    title: "Ads — Facebook Audience Network",
    fields: [
      { key: "adsByFacebookEnabled", label: "Enable Facebook ads", kind: "boolean" },
      { key: "fbPlacementIos", label: "FB placement ID — iOS", kind: "text" },
      { key: "fbPlacementAndroid", label: "FB placement ID — Android", kind: "text" },
    ],
  },
];

export function SocialTab() {
  return <SettingsForm tab="social" sections={SECTIONS} />;
}
