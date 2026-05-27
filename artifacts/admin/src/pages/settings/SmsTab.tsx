import { SettingsForm } from "./SettingsForm";
import type { SectionDef } from "./types";

const SECTIONS: SectionDef[] = [
  {
    title: "Delivery mode",
    fields: [
      {
        key: "smsMode",
        label: "SMS mode",
        kind: "select",
        options: [
          { value: "demo_fixed", label: "Demo (fixed code)" },
          { value: "demo_random", label: "Demo (random code)" },
          { value: "twilio", label: "Twilio (real SMS)" },
          { value: "moroccansms", label: "MoroccanSMS (bulksms.ma)" },
        ],
        help: "Switch to Twilio or MoroccanSMS before going live with real users.",
      },
      { key: "smsDemoCode", label: "Demo code (4–8 digits)", kind: "text", placeholder: "1122" },
    ],
  },
  {
    title: "Twilio",
    fields: [
      { key: "twilioAccountSid", label: "Account SID", kind: "text", placeholder: "ACxxxxxxxx" },
      { key: "twilioAuthToken", label: "Auth token", kind: "secret" },
      { key: "twilioFromNumber", label: "From number", kind: "text", placeholder: "+15555550123" },
    ],
  },
  {
    title: "MoroccanSMS (bulksms.ma)",
    fields: [
      { key: "moroccansmsToken", label: "API token", kind: "secret" },
      { key: "moroccansmsSender", label: "Sender name (max 11 chars)", kind: "text", placeholder: "Biddi" },
      { key: "moroccansmsPrefix", label: "Default country prefix", kind: "text", placeholder: "212" },
      { key: "moroccansmsUrl", label: "API URL", kind: "url", placeholder: "https://api.bulksms.ma" },
      { key: "moroccansmsSubAccount", label: "Sub-account", kind: "text", placeholder: "135_212" },
      { key: "moroccansmsPassword", label: "Password", kind: "secret" },
    ],
  },
  {
    title: "Phone verification",
    fields: [
      {
        key: "userPhoneVerification",
        label: "Require rider phone verification",
        kind: "boolean",
        help: "Riders must verify their phone via OTP before signup completes.",
      },
      {
        key: "driverPhoneVerification",
        label: "Require driver phone verification",
        kind: "boolean",
        help: "Drivers must verify their phone via OTP before signup completes.",
      },
    ],
  },
];

export function SmsTab() {
  return <SettingsForm tab="sms" sections={SECTIONS} />;
}
