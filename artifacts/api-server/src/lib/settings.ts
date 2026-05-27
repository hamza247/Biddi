import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * SETTINGS KEY MAP — single source of truth for the admin General Settings page.
 *
 * Tabs (matches admin UI):
 *   - general:           projectName, adminIsdCode, countryCode, distanceUnit,
 *                        recordsPerPage, driverEmailVerification, userEmailVerification,
 *                        walletAmount1, walletAmount2, walletAmount3,
 *                        googleAnalyticsId, maintenanceModeUser, maintenanceModeDriver,
 *                        enableEmailOptional
 *   - email:             fromName, noReplyEmail, adminEmail, mailFooter,
 *                        mailDeliveryEnabled, sendingDomain,
 *                        smtpHost, smtpPort, smtpUser, smtpPass*, smtpFrom, smtpSecure
 *   - sms:               smsMode, smsDemoCode, twilioAccountSid, twilioAuthToken*,
 *                        twilioFromNumber, moroccansmsToken*, moroccansmsSender,
 *                        moroccansmsPrefix, moroccansmsSubAccount, moroccansmsPassword*,
 *                        moroccansmsUrl, userPhoneVerification, driverPhoneVerification
 *   - social:            facebookAppId, footerFacebookUrl, footerTwitterUrl,
 *                        footerLinkedinUrl, footerInstagramUrl, footerGoogleUrl,
 *                        googleOAuthAppName, googleOAuthClientId,
 *                        googleOAuthClientSecret*, googleOAuthRedirectUrl,
 *                        googleOAuthSiteLink, socialLoginFacebookDriver,
 *                        socialLoginGoogleDriver, socialLoginAppleDriver,
 *                        socialLoginFacebookUser, socialLoginGoogleUser,
 *                        socialLoginAppleUser, facebookClientToken*,
 *                        facebookAppSecret*, adsByGoogleEnabled, admobWebClientId,
 *                        admobIosStoreClientId, admobIosDriverClientId,
 *                        admobIosPassengerClientId, adsByFacebookEnabled,
 *                        fbPlacementIos, fbPlacementAndroid, facebookPixelId
 *   - app:               driverEtaLabelsEnabled (existing) plus a long list of
 *                        feature toggles grouped into Ride/Driver/User/Wallet/
 *                        Referral/Reward/Safety/Accessibility/Advertisement/
 *                        GiftCard/RatingTips/SmartLogin/InterCity/Pool/Booking.
 *   - installation:      captchaSiteKey, captchaSecret*, applePushKeyId,
 *                        applePushKeyFile, appleTeamId*, googleProjectId,
 *                        enableGoogleDirectionDriver, enableGoogleDirectionUser,
 *                        autocompleteMinChars, hereTollEnabled, hereAppId,
 *                        hereAppKey*, hereAppCode*, systemTimeZone
 *   - maps:              googleMapsApiKey*, googleMapsApiKeyWeb*,
 *                        googleMapsApiKeyIos*, googleMapsApiKeyAndroid*,
 *                        mapProviderAutocomplete, mapProviderGeocode,
 *                        mapProviderRouting, osmNominatimUrl, osmRoutingUrl,
 *                        osmContactEmail
 *   - payment:           paymentEnvironment, paymentModes,
 *                        stripePublishableKey, stripeSecretKey*,
 *                        stripeWebhookSecret*, commissionFromWalletForCash,
 *                        minWalletAmount, walletTransferEnabled,
 *                        walletTransferMinAmount, walletTransferOtpMinutes,
 *                        walletTransferMaxPerTxn, walletTransferMaxPerDay,
 *                        adjustSpEarningsAuto, minWithdrawalAmount
 *   - notificationSound: soundNewTripRequest, soundDriverApp, soundUserApp,
 *                        soundVoipCalling
 *
 * Live Map (kept inside the legacy admin page for now): driverIconSize,
 * driverOfflineWindowHours.
 *
 * Keys ending with `*` are SECRETS — masked when read by the admin UI and
 * stripped from logs.
 */

export type SmsMode = "demo_fixed" | "demo_random" | "twilio" | "moroccansms";
export type MapProvider = "google" | "osm";
export type DistanceUnit = "km" | "miles";
export type PaymentEnvironment = "sandbox" | "live";

export interface AppConfig {
  // ---- SMS ----
  smsMode: SmsMode;
  smsDemoCode: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  moroccansmsToken: string;
  moroccansmsSender: string;
  moroccansmsPrefix: string;
  moroccansmsSubAccount: string;
  moroccansmsPassword: string;
  moroccansmsUrl: string;
  userPhoneVerification: boolean;
  driverPhoneVerification: boolean;

  // ---- Maps ----
  googleMapsApiKey: string;
  googleMapsApiKeyWeb: string;
  googleMapsApiKeyIos: string;
  googleMapsApiKeyAndroid: string;
  maptilerApiKey: string;
  mapProviderAutocomplete: MapProvider;
  mapProviderGeocode: MapProvider;
  mapProviderRouting: MapProvider;
  osmNominatimUrl: string;
  osmRoutingUrl: string;
  osmContactEmail: string;

  // ---- App / Driver app ----
  driverEtaLabelsEnabled: boolean;
  driverIconSize: number;
  driverOfflineWindowHours: number;
  driverStaleLocationThresholdSeconds: number;

  // ---- Live map default viewport ----
  liveMapDefaultLat: number;
  liveMapDefaultLng: number;
  liveMapDefaultZoom: number;

  // ---- Heatmap (real-time surge) ----
  heatmapEnabled: boolean;
  heatmapRefreshSeconds: number;
  heatmapGridMeters: number;
  heatmapDemandLookbackSeconds: number;
  heatmapSupplyStaleSeconds: number;
  heatmapSurgeThresholdLight: number;
  heatmapSurgeThresholdMedium: number;
  heatmapSurgeThresholdHigh: number;
  heatmapSurgeThresholdVeryHigh: number;
  heatmapLabelMode: "multiplier" | "bonus" | "off";
  heatmapBonusBase: number;

  // ---- Email / SMTP ----
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpSecure: boolean;
  fromName: string;
  noReplyEmail: string;
  adminEmail: string;
  mailFooter: string;
  mailDeliveryEnabled: boolean;
  sendingDomain: string;

  // ---- General ----
  projectName: string;
  adminIsdCode: string;
  countryCode: string;
  distanceUnit: DistanceUnit;
  recordsPerPage: number;
  driverEmailVerification: boolean;
  userEmailVerification: boolean;
  walletAmount1: number;
  walletAmount2: number;
  walletAmount3: number;
  /** ISO-4217 code of the currency shown next to all monetary amounts in
   * the rider/driver/admin apps. Internal math always stays in USD; this
   * controls only the display layer. Falls back to USD when the chosen
   * code isn't an active row in `currencies`. */
  displayCurrency: string;
  googleAnalyticsId: string;
  maintenanceModeUser: boolean;
  maintenanceModeDriver: boolean;
  enableEmailOptional: boolean;

  // ---- Social / Marketing ----
  facebookAppId: string;
  footerFacebookUrl: string;
  footerTwitterUrl: string;
  footerLinkedinUrl: string;
  footerInstagramUrl: string;
  footerGoogleUrl: string;
  googleOAuthAppName: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googleOAuthRedirectUrl: string;
  googleOAuthSiteLink: string;
  socialLoginFacebookDriver: boolean;
  socialLoginGoogleDriver: boolean;
  socialLoginAppleDriver: boolean;
  socialLoginFacebookUser: boolean;
  socialLoginGoogleUser: boolean;
  socialLoginAppleUser: boolean;
  facebookClientToken: string;
  facebookAppSecret: string;
  adsByGoogleEnabled: boolean;
  admobWebClientId: string;
  admobIosStoreClientId: string;
  admobIosDriverClientId: string;
  admobIosPassengerClientId: string;
  adsByFacebookEnabled: boolean;
  fbPlacementIos: string;
  fbPlacementAndroid: string;
  facebookPixelId: string;

  // ---- Installation ----
  captchaSiteKey: string;
  captchaSecret: string;
  applePushKeyId: string;
  applePushKeyFile: string;
  appleTeamId: string;
  googleProjectId: string;
  enableGoogleDirectionDriver: boolean;
  enableGoogleDirectionUser: boolean;
  autocompleteMinChars: number;
  hereTollEnabled: boolean;
  hereAppId: string;
  hereAppKey: string;
  hereAppCode: string;
  systemTimeZone: string;

  // ---- Payment / Wallet ----
  paymentEnvironment: PaymentEnvironment;
  paymentModeCash: boolean;
  paymentModeCard: boolean;
  paymentModeWallet: boolean;
  stripePublishableKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  commissionFromWalletForCash: boolean;
  minWalletAmount: number;
  walletTransferEnabled: boolean;
  walletTransferMinAmount: number;
  walletTransferOtpMinutes: number;
  walletTransferMaxPerTxn: number;
  walletTransferMaxPerDay: number;
  adjustSpEarningsAuto: boolean;
  minWithdrawalAmount: number;

  // ---- Notification Sounds ----
  soundNewTripRequest: string;
  soundDriverApp: string;
  soundUserApp: string;
  soundVoipCalling: string;

  // ---- App feature toggles (grouped in admin UI) ----
  appRideEnableScheduledRides: boolean;
  appRideEnableMultiStop: boolean;
  appRideEnableFareEditing: boolean;
  appRideShowDriverDetailsBeforeAccept: boolean;
  appDriverEnableDocumentReupload: boolean;
  appDriverEnableEarningsBreakdown: boolean;
  appDriverAutoAcceptEnabled: boolean;
  appUserEnableProfileEdit: boolean;
  appUserEnableFavoriteDrivers: boolean;
  appUserEnableSaveAddresses: boolean;
  appWalletEnableTopUp: boolean;
  appWalletEnableWithdrawalRequest: boolean;
  appReferralEnabled: boolean;
  appReferralBonusUser: number;
  appReferralBonusDriver: number;
  appRewardEnabled: boolean;
  appSafetyEnableSosButton: boolean;
  appSafetyEnableTripSharing: boolean;
  appSafetyEnableEmergencyContacts: boolean;
  appAccessibilityEnableLargeText: boolean;
  appAccessibilityEnableHighContrast: boolean;
  appAdvertisementShowBanners: boolean;
  appGiftCardEnabled: boolean;
  appRatingEnabled: boolean;
  appTipsEnabled: boolean;
  appSmartLoginEnabled: boolean;
  appInterCityEnabled: boolean;
  appPoolEnabled: boolean;
  appBookingEnableFutureRides: boolean;
  appBookingMaxAdvanceDays: number;

  // ---- Queued ride requests (back-to-back trips) ----
  queuedRidesEnabled: boolean;
  queuedRidesRadiusKm: number;
  queuedRidesExpirySeconds: number;
  queuedRidesLeadDistanceKm: number;
  queuedRidesLeadMinutes: number;
  queuedRidesMaxPerDriver: number;
  destinationModeEnabled: boolean;
  destinationModeMaxPerDay: number;
  destinationModeMatchRadiusKm: number;
  destinationModeCorridorKm: number;
  destinationModeAutoDisableOnTrip: boolean;
  destinationModeAutoDisableMinutes: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  // SMS
  smsMode: "demo_fixed",
  smsDemoCode: "1122",
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioFromNumber: "",
  moroccansmsToken: "",
  moroccansmsSender: "Biddi",
  moroccansmsPrefix: "212",
  moroccansmsSubAccount: "",
  moroccansmsPassword: "",
  moroccansmsUrl: "https://api.bulksms.ma",
  userPhoneVerification: true,
  driverPhoneVerification: true,
  // Maps
  googleMapsApiKey: "",
  googleMapsApiKeyWeb: "",
  googleMapsApiKeyIos: "",
  googleMapsApiKeyAndroid: "",
  maptilerApiKey: "",
  mapProviderAutocomplete: "google",
  mapProviderGeocode: "google",
  mapProviderRouting: "google",
  osmNominatimUrl: "https://nominatim.openstreetmap.org",
  osmRoutingUrl: "https://router.project-osrm.org",
  osmContactEmail: "",
  // App
  driverEtaLabelsEnabled: true,
  driverIconSize: 40,
  driverOfflineWindowHours: 6,
  driverStaleLocationThresholdSeconds: 90,
  // Live map default viewport (falls back to Morocco if unset)
  liveMapDefaultLat: 31.79,
  liveMapDefaultLng: -7.09,
  liveMapDefaultZoom: 6,
  // Heatmap defaults: 15s refresh on a 500m grid, 10-min lookback for demand,
  // 2-min staleness for supply. Tier thresholds (light/medium/high/very high)
  // follow the standard Uber-style 1.0 / 1.2 / 1.5 / 2.0 surge cuts.
  heatmapEnabled: true,
  heatmapRefreshSeconds: 15,
  heatmapGridMeters: 500,
  heatmapDemandLookbackSeconds: 600,
  heatmapSupplyStaleSeconds: 120,
  heatmapSurgeThresholdLight: 1.0,
  heatmapSurgeThresholdMedium: 1.2,
  heatmapSurgeThresholdHigh: 1.5,
  heatmapSurgeThresholdVeryHigh: 2.0,
  heatmapLabelMode: "multiplier",
  heatmapBonusBase: 2,
  // Email
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  smtpSecure: false,
  fromName: "Biddi",
  noReplyEmail: "",
  adminEmail: "",
  mailFooter: "",
  mailDeliveryEnabled: false,
  sendingDomain: "",
  // General
  projectName: "Biddi",
  adminIsdCode: "+212",
  countryCode: "MA",
  distanceUnit: "km",
  recordsPerPage: 25,
  driverEmailVerification: false,
  userEmailVerification: false,
  walletAmount1: 50,
  walletAmount2: 100,
  walletAmount3: 200,
  displayCurrency: "USD",
  googleAnalyticsId: "",
  maintenanceModeUser: false,
  maintenanceModeDriver: false,
  enableEmailOptional: true,
  // Social
  facebookAppId: "",
  footerFacebookUrl: "",
  footerTwitterUrl: "",
  footerLinkedinUrl: "",
  footerInstagramUrl: "",
  footerGoogleUrl: "",
  googleOAuthAppName: "",
  googleOAuthClientId: "",
  googleOAuthClientSecret: "",
  googleOAuthRedirectUrl: "",
  googleOAuthSiteLink: "",
  socialLoginFacebookDriver: false,
  socialLoginGoogleDriver: false,
  socialLoginAppleDriver: false,
  socialLoginFacebookUser: false,
  socialLoginGoogleUser: false,
  socialLoginAppleUser: false,
  facebookClientToken: "",
  facebookAppSecret: "",
  adsByGoogleEnabled: false,
  admobWebClientId: "",
  admobIosStoreClientId: "",
  admobIosDriverClientId: "",
  admobIosPassengerClientId: "",
  adsByFacebookEnabled: false,
  fbPlacementIos: "",
  fbPlacementAndroid: "",
  facebookPixelId: "",
  // Installation
  captchaSiteKey: "",
  captchaSecret: "",
  applePushKeyId: "",
  applePushKeyFile: "",
  appleTeamId: "",
  googleProjectId: "",
  enableGoogleDirectionDriver: true,
  enableGoogleDirectionUser: true,
  autocompleteMinChars: 3,
  hereTollEnabled: false,
  hereAppId: "",
  hereAppKey: "",
  hereAppCode: "",
  systemTimeZone: "Africa/Casablanca",
  // Payment
  paymentEnvironment: "sandbox",
  paymentModeCash: true,
  paymentModeCard: false,
  paymentModeWallet: true,
  stripePublishableKey: "",
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  commissionFromWalletForCash: false,
  minWalletAmount: 10,
  walletTransferEnabled: false,
  walletTransferMinAmount: 10,
  walletTransferOtpMinutes: 5,
  walletTransferMaxPerTxn: 500,
  walletTransferMaxPerDay: 2000,
  adjustSpEarningsAuto: true,
  minWithdrawalAmount: 10,
  // Notification sounds
  soundNewTripRequest: "default",
  soundDriverApp: "default",
  soundUserApp: "default",
  soundVoipCalling: "default",
  // App feature toggles
  appRideEnableScheduledRides: true,
  appRideEnableMultiStop: false,
  appRideEnableFareEditing: false,
  appRideShowDriverDetailsBeforeAccept: true,
  appDriverEnableDocumentReupload: true,
  appDriverEnableEarningsBreakdown: true,
  appDriverAutoAcceptEnabled: false,
  appUserEnableProfileEdit: true,
  appUserEnableFavoriteDrivers: false,
  appUserEnableSaveAddresses: true,
  appWalletEnableTopUp: true,
  appWalletEnableWithdrawalRequest: true,
  appReferralEnabled: true,
  appReferralBonusUser: 10,
  appReferralBonusDriver: 10,
  appRewardEnabled: true,
  appSafetyEnableSosButton: true,
  appSafetyEnableTripSharing: true,
  appSafetyEnableEmergencyContacts: true,
  appAccessibilityEnableLargeText: false,
  appAccessibilityEnableHighContrast: false,
  appAdvertisementShowBanners: false,
  appGiftCardEnabled: false,
  appRatingEnabled: true,
  appTipsEnabled: true,
  appSmartLoginEnabled: true,
  appInterCityEnabled: false,
  appPoolEnabled: false,
  appBookingEnableFutureRides: true,
  appBookingMaxAdvanceDays: 30,
  // Queued ride requests
  queuedRidesEnabled: true,
  queuedRidesRadiusKm: 3,
  queuedRidesExpirySeconds: 45,
  queuedRidesLeadDistanceKm: 2,
  queuedRidesLeadMinutes: 4,
  queuedRidesMaxPerDriver: 1,
  destinationModeEnabled: true,
  destinationModeMaxPerDay: 2,
  destinationModeMatchRadiusKm: 5,
  destinationModeCorridorKm: 3,
  destinationModeAutoDisableOnTrip: true,
  destinationModeAutoDisableMinutes: 0,
};

export const SETTINGS_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[];

export const BOOLEAN_KEYS = new Set<keyof AppConfig>([
  "driverEtaLabelsEnabled",
  "smtpSecure",
  "userPhoneVerification",
  "driverPhoneVerification",
  "mailDeliveryEnabled",
  "driverEmailVerification",
  "userEmailVerification",
  "maintenanceModeUser",
  "maintenanceModeDriver",
  "enableEmailOptional",
  "socialLoginFacebookDriver",
  "socialLoginGoogleDriver",
  "socialLoginAppleDriver",
  "socialLoginFacebookUser",
  "socialLoginGoogleUser",
  "socialLoginAppleUser",
  "adsByGoogleEnabled",
  "adsByFacebookEnabled",
  "enableGoogleDirectionDriver",
  "enableGoogleDirectionUser",
  "hereTollEnabled",
  "paymentModeCash",
  "paymentModeCard",
  "paymentModeWallet",
  "commissionFromWalletForCash",
  "walletTransferEnabled",
  "adjustSpEarningsAuto",
  "appRideEnableScheduledRides",
  "appRideEnableMultiStop",
  "appRideEnableFareEditing",
  "appRideShowDriverDetailsBeforeAccept",
  "appDriverEnableDocumentReupload",
  "appDriverEnableEarningsBreakdown",
  "appDriverAutoAcceptEnabled",
  "appUserEnableProfileEdit",
  "appUserEnableFavoriteDrivers",
  "appUserEnableSaveAddresses",
  "appWalletEnableTopUp",
  "appWalletEnableWithdrawalRequest",
  "appReferralEnabled",
  "appRewardEnabled",
  "appSafetyEnableSosButton",
  "appSafetyEnableTripSharing",
  "appSafetyEnableEmergencyContacts",
  "appAccessibilityEnableLargeText",
  "appAccessibilityEnableHighContrast",
  "appAdvertisementShowBanners",
  "appGiftCardEnabled",
  "appRatingEnabled",
  "appTipsEnabled",
  "appSmartLoginEnabled",
  "appInterCityEnabled",
  "appPoolEnabled",
  "appBookingEnableFutureRides",
  "heatmapEnabled",
  "queuedRidesEnabled",
  "destinationModeEnabled",
  "destinationModeAutoDisableOnTrip",
]);

export const NUMBER_KEYS = new Set<keyof AppConfig>([
  "driverIconSize",
  "driverOfflineWindowHours",
  "driverStaleLocationThresholdSeconds",
  "liveMapDefaultLat",
  "liveMapDefaultLng",
  "liveMapDefaultZoom",
  "smtpPort",
  "minWithdrawalAmount",
  "recordsPerPage",
  "walletAmount1",
  "walletAmount2",
  "walletAmount3",
  "autocompleteMinChars",
  "minWalletAmount",
  "walletTransferMinAmount",
  "walletTransferOtpMinutes",
  "walletTransferMaxPerTxn",
  "walletTransferMaxPerDay",
  "appReferralBonusUser",
  "appReferralBonusDriver",
  "appBookingMaxAdvanceDays",
  "heatmapRefreshSeconds",
  "heatmapGridMeters",
  "heatmapDemandLookbackSeconds",
  "heatmapSupplyStaleSeconds",
  "heatmapSurgeThresholdLight",
  "heatmapSurgeThresholdMedium",
  "heatmapSurgeThresholdHigh",
  "heatmapSurgeThresholdVeryHigh",
  "heatmapBonusBase",
  "queuedRidesRadiusKm",
  "queuedRidesExpirySeconds",
  "queuedRidesLeadDistanceKm",
  "queuedRidesLeadMinutes",
  "queuedRidesMaxPerDriver",
  "destinationModeMaxPerDay",
  "destinationModeMatchRadiusKm",
  "destinationModeCorridorKm",
  "destinationModeAutoDisableMinutes",
]);

export const SECRET_KEYS = new Set<keyof AppConfig>([
  "twilioAuthToken",
  "moroccansmsToken",
  "moroccansmsPassword",
  "smtpPass",
  "googleMapsApiKey",
  "googleMapsApiKeyWeb",
  "googleMapsApiKeyIos",
  "googleMapsApiKeyAndroid",
  "googleOAuthClientSecret",
  "facebookClientToken",
  "facebookAppSecret",
  "captchaSecret",
  "appleTeamId",
  "applePushKeyFile",
  "hereAppKey",
  "hereAppCode",
  "stripeSecretKey",
  "stripeWebhookSecret",
]);

/**
 * Tab → keys map. Used by per-tab GET/PUT endpoints to scope reads/writes.
 * Keys may appear in only one tab.
 */
export const TAB_KEYS: Record<string, (keyof AppConfig)[]> = {
  general: [
    "projectName", "adminIsdCode", "countryCode", "distanceUnit", "recordsPerPage",
    "driverEmailVerification", "userEmailVerification", "walletAmount1", "walletAmount2",
    "walletAmount3", "displayCurrency", "googleAnalyticsId", "maintenanceModeUser", "maintenanceModeDriver",
    "enableEmailOptional",
  ],
  email: [
    "fromName", "noReplyEmail", "adminEmail", "mailFooter", "mailDeliveryEnabled",
    "sendingDomain", "smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFrom",
    "smtpSecure",
  ],
  sms: [
    "smsMode", "smsDemoCode", "twilioAccountSid", "twilioAuthToken", "twilioFromNumber",
    "moroccansmsToken", "moroccansmsSender", "moroccansmsPrefix", "moroccansmsSubAccount",
    "moroccansmsPassword", "moroccansmsUrl", "userPhoneVerification", "driverPhoneVerification",
  ],
  social: [
    "facebookAppId", "footerFacebookUrl", "footerTwitterUrl", "footerLinkedinUrl",
    "footerInstagramUrl", "footerGoogleUrl", "googleOAuthAppName", "googleOAuthClientId",
    "googleOAuthClientSecret", "googleOAuthRedirectUrl", "googleOAuthSiteLink",
    "socialLoginFacebookDriver", "socialLoginGoogleDriver", "socialLoginAppleDriver",
    "socialLoginFacebookUser", "socialLoginGoogleUser", "socialLoginAppleUser",
    "facebookClientToken", "facebookAppSecret", "adsByGoogleEnabled", "admobWebClientId",
    "admobIosStoreClientId", "admobIosDriverClientId", "admobIosPassengerClientId",
    "adsByFacebookEnabled", "fbPlacementIos", "fbPlacementAndroid", "facebookPixelId",
  ],
  app: [
    "driverEtaLabelsEnabled",
    "driverStaleLocationThresholdSeconds",
    "appRideEnableScheduledRides", "appRideEnableMultiStop", "appRideEnableFareEditing",
    "appRideShowDriverDetailsBeforeAccept", "appDriverEnableDocumentReupload",
    "appDriverEnableEarningsBreakdown", "appDriverAutoAcceptEnabled",
    "appUserEnableProfileEdit", "appUserEnableFavoriteDrivers", "appUserEnableSaveAddresses",
    "appWalletEnableTopUp", "appWalletEnableWithdrawalRequest",
    "appReferralEnabled", "appReferralBonusUser", "appReferralBonusDriver",
    "appRewardEnabled",
    "appSafetyEnableSosButton", "appSafetyEnableTripSharing", "appSafetyEnableEmergencyContacts",
    "appAccessibilityEnableLargeText", "appAccessibilityEnableHighContrast",
    "appAdvertisementShowBanners", "appGiftCardEnabled",
    "appRatingEnabled", "appTipsEnabled",
    "appSmartLoginEnabled", "appInterCityEnabled", "appPoolEnabled",
    "appBookingEnableFutureRides", "appBookingMaxAdvanceDays",
    "heatmapEnabled", "heatmapRefreshSeconds", "heatmapGridMeters",
    "heatmapDemandLookbackSeconds", "heatmapSupplyStaleSeconds",
    "heatmapSurgeThresholdLight", "heatmapSurgeThresholdMedium",
    "heatmapSurgeThresholdHigh", "heatmapSurgeThresholdVeryHigh",
    "heatmapLabelMode", "heatmapBonusBase",
    "queuedRidesEnabled", "queuedRidesRadiusKm", "queuedRidesExpirySeconds",
    "queuedRidesLeadDistanceKm", "queuedRidesLeadMinutes", "queuedRidesMaxPerDriver",
    "destinationModeEnabled", "destinationModeMaxPerDay",
    "destinationModeMatchRadiusKm", "destinationModeCorridorKm",
    "destinationModeAutoDisableOnTrip", "destinationModeAutoDisableMinutes",
  ],
  installation: [
    "captchaSiteKey", "captchaSecret", "applePushKeyId", "applePushKeyFile", "appleTeamId",
    "googleProjectId", "enableGoogleDirectionDriver", "enableGoogleDirectionUser",
    "autocompleteMinChars", "hereTollEnabled", "hereAppId", "hereAppKey", "hereAppCode",
    "systemTimeZone",
  ],
  maps: [
    "googleMapsApiKey", "googleMapsApiKeyWeb", "googleMapsApiKeyIos", "googleMapsApiKeyAndroid",
    "maptilerApiKey",
    "mapProviderAutocomplete", "mapProviderGeocode", "mapProviderRouting",
    "osmNominatimUrl", "osmRoutingUrl", "osmContactEmail",
    "liveMapDefaultLat", "liveMapDefaultLng", "liveMapDefaultZoom",
  ],
  payment: [
    "paymentEnvironment", "paymentModeCash", "paymentModeCard", "paymentModeWallet",
    "stripePublishableKey", "stripeSecretKey", "stripeWebhookSecret",
    "commissionFromWalletForCash", "minWalletAmount", "walletTransferEnabled",
    "walletTransferMinAmount", "walletTransferOtpMinutes", "walletTransferMaxPerTxn",
    "walletTransferMaxPerDay", "adjustSpEarningsAuto", "minWithdrawalAmount",
  ],
  notificationSound: [
    "soundNewTripRequest", "soundDriverApp", "soundUserApp", "soundVoipCalling",
  ],
};

let cache: AppConfig | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

function fromEnv(): Partial<AppConfig> {
  const env: Partial<AppConfig> = {};
  if (process.env.TWILIO_ACCOUNT_SID) env.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  if (process.env.TWILIO_AUTH_TOKEN) env.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  if (process.env.TWILIO_FROM_NUMBER) env.twilioFromNumber = process.env.TWILIO_FROM_NUMBER;
  if (process.env.MOROCCANSMS_TOKEN) env.moroccansmsToken = process.env.MOROCCANSMS_TOKEN;
  if (process.env.MOROCCANSMS_SENDER) env.moroccansmsSender = process.env.MOROCCANSMS_SENDER;
  if (process.env.GOOGLE_API_KEY) env.googleMapsApiKey = process.env.GOOGLE_API_KEY;
  if (process.env.GOOGLE_API_KEY) env.googleMapsApiKeyIos = process.env.GOOGLE_API_KEY;
  if (process.env.GOOGLE_API_WEB_KEY) env.googleMapsApiKeyWeb = process.env.GOOGLE_API_WEB_KEY;
  if (process.env.GOOGLE_API_ANDROID_KEY) env.googleMapsApiKeyAndroid = process.env.GOOGLE_API_ANDROID_KEY;
  if (process.env.SMTP_HOST) env.smtpHost = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) env.smtpPort = parseInt(process.env.SMTP_PORT, 10);
  if (process.env.SMTP_USER) env.smtpUser = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) env.smtpPass = process.env.SMTP_PASS;
  if (process.env.SMTP_FROM) env.smtpFrom = process.env.SMTP_FROM;
  if (process.env.SMTP_SECURE) env.smtpSecure = process.env.SMTP_SECURE === "true";
  return env;
}

export async function getConfig(force = false): Promise<AppConfig> {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache;
  const rows = await db.select().from(settingsTable);
  const merged: AppConfig = { ...DEFAULT_CONFIG, ...fromEnv() };
  for (const r of rows) {
    const k = r.key as keyof AppConfig;
    if (SETTINGS_KEYS.includes(k)) {
      const v = r.value as unknown;
      if (BOOLEAN_KEYS.has(k)) {
        (merged as any)[k] = v !== "false" && v !== false && v !== null && v !== undefined;
      } else if (NUMBER_KEYS.has(k)) {
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (Number.isFinite(n)) (merged as any)[k] = n;
      } else if (typeof v === "string") {
        (merged as any)[k] = v;
      } else if (v != null) {
        (merged as any)[k] = String(v);
      }
    }
  }
  cache = merged;
  cacheAt = Date.now();
  return merged;
}

export function invalidateConfigCache() {
  cache = null;
  cacheAt = 0;
}

/** Slugs that map to bundled native sound files in the mobile app. */
const RESERVED_SOUND_SLUGS = new Set<string>([
  "default", "chime", "ping", "ringtone", "alert", "horn",
]);
const SOUND_SETTING_KEYS = new Set<string>([
  "soundNewTripRequest", "soundDriverApp", "soundUserApp", "soundVoipCalling",
]);

async function loadValidSoundSlugs(): Promise<Set<string>> {
  const { notificationSoundsTable } = await import("@workspace/db");
  const rows = await db
    .select({ slug: notificationSoundsTable.slug })
    .from(notificationSoundsTable);
  return new Set([...RESERVED_SOUND_SLUGS, ...rows.map((r) => r.slug)]);
}

export class SettingsValidationError extends Error {
  status = 400;
  constructor(public key: string, public reason: string) {
    super(`invalid value for ${key}: ${reason}`);
    this.name = "SettingsValidationError";
  }
}

export async function setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const entries = Object.entries(patch).filter(([k]) =>
    SETTINGS_KEYS.includes(k as keyof AppConfig),
  );
  // Validate that any sound* assignment refers to "default", a reserved
  // bundled preset, or an existing uploaded library row. Without this check a
  // direct API call could persist a stale slug and have pushes silently fall
  // back to the OS default sound.
  const soundEntries = entries.filter(([k]) => SOUND_SETTING_KEYS.has(k));
  if (soundEntries.length > 0) {
    const valid = await loadValidSoundSlugs();
    for (const [k, v] of soundEntries) {
      const slug = typeof v === "string" ? v : String(v ?? "");
      if (!slug || !valid.has(slug)) {
        throw new SettingsValidationError(
          k,
          `unknown sound slug "${slug}" — must be "default", a reserved preset, or an uploaded library slug`,
        );
      }
    }
  }
  for (const [k, v] of entries) {
    const key = k as keyof AppConfig;
    let value: unknown;
    if (NUMBER_KEYS.has(key)) {
      value = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    } else if (BOOLEAN_KEYS.has(key)) {
      value = v === true || v === "true" ? "true" : "false";
    } else {
      value = typeof v === "string" ? v : String(v ?? "");
    }
    await db
      .insert(settingsTable)
      .values({ key: k, value: value as any, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: value as any, updatedAt: new Date() },
      });
  }
  invalidateConfigCache();
  return getConfig(true);
}

export function redactConfig(cfg: AppConfig): AppConfig & { _hasSecrets: Record<string, boolean> } {
  const out: any = { ...cfg };
  const flags: Record<string, boolean> = {};
  for (const k of SECRET_KEYS) {
    flags[k] = !!cfg[k];
    out[k] = "";
  }
  out._hasSecrets = flags;
  return out;
}

/**
 * Strip secret values from an arbitrary patch payload before logging it.
 * Use when echoing settings PUT bodies into request logs.
 */
export function redactPatchForLog(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (SECRET_KEYS.has(k as keyof AppConfig)) {
      out[k] = v ? "[redacted]" : "";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function ensureSettingsSeeded(): Promise<void> {
  try {
    const rows = await db
      .select({ key: settingsTable.key })
      .from(settingsTable)
      .where(eq(settingsTable.key, "smsMode"));
    if (rows.length > 0) return;
    await setConfig({ smsMode: "demo_fixed", smsDemoCode: "1122" });
    logger.info("[settings] seeded default smsMode=demo_fixed code=1122");
  } catch (err) {
    logger.error({ err }, "[settings] failed to seed defaults");
  }
}
