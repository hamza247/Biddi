import { SettingsForm } from "./SettingsForm";
import type { SectionDef } from "./types";

const TIMEZONES = [
  "UTC",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/Rome",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
].map((tz) => ({ value: tz, label: tz }));

const SECTIONS: SectionDef[] = [
  {
    title: "ReCAPTCHA",
    fields: [
      { key: "captchaSiteKey", label: "Captcha site key", kind: "text" },
      { key: "captchaSecret", label: "Captcha secret key", kind: "secret" },
    ],
  },
  {
    title: "Apple push notifications",
    fields: [
      { key: "applePushKeyId", label: "Apple push key ID", kind: "text" },
      { key: "applePushKeyFile", label: "Apple push key file name", kind: "secret" },
      { key: "appleTeamId", label: "Apple Team ID", kind: "secret" },
    ],
  },
  {
    title: "Google services",
    fields: [
      { key: "googleProjectId", label: "Google project ID", kind: "text" },
      {
        key: "enableGoogleDirectionDriver",
        label: "Enable Google Directions (driver)",
        kind: "boolean",
      },
      {
        key: "enableGoogleDirectionUser",
        label: "Enable Google Directions (rider)",
        kind: "boolean",
      },
      {
        key: "autocompleteMinChars",
        label: "Autocomplete min characters",
        kind: "number",
        min: 1,
        max: 10,
        help: "Minimum chars typed before address autocomplete fires.",
      },
    ],
  },
  {
    title: "HERE — toll cost",
    fields: [
      { key: "hereTollEnabled", label: "Enable HERE toll cost lookup", kind: "boolean" },
      { key: "hereAppId", label: "HERE App ID", kind: "text" },
      { key: "hereAppKey", label: "HERE App Key", kind: "secret" },
      { key: "hereAppCode", label: "HERE App Code", kind: "secret" },
    ],
  },
  {
    title: "System",
    fields: [
      {
        key: "systemTimeZone",
        label: "System time zone",
        kind: "select",
        options: TIMEZONES,
        help: "IANA timezone used for scheduled reports and time-based rules.",
      },
    ],
  },
];

export function InstallationTab() {
  return <SettingsForm tab="installation" sections={SECTIONS} />;
}
