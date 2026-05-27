import { SettingsForm } from "./SettingsForm";
import type { SectionDef } from "./types";

const SECTIONS: SectionDef[] = [
  {
    title: "Environment",
    fields: [
      {
        key: "paymentEnvironment",
        label: "Payment environment",
        kind: "select",
        options: [
          { value: "sandbox", label: "Sandbox (test)" },
          { value: "live", label: "Live (production)" },
        ],
        help: "Switch between sandbox keys (no real charges) and live keys.",
      },
    ],
  },
  {
    title: "Accepted payment modes",
    description: "Toggle each method on/off. Riders only see the modes you enable here.",
    fields: [
      { key: "paymentModeCash", label: "Cash", kind: "boolean" },
      { key: "paymentModeCard", label: "Card", kind: "boolean" },
      { key: "paymentModeWallet", label: "Wallet", kind: "boolean" },
    ],
  },
  {
    title: "Stripe gateway",
    fields: [
      { key: "stripePublishableKey", label: "Publishable key", kind: "text", placeholder: "pk_…" },
      { key: "stripeSecretKey", label: "Secret key", kind: "secret" },
      { key: "stripeWebhookSecret", label: "Webhook secret", kind: "secret" },
    ],
  },
  {
    title: "Wallet",
    fields: [
      {
        key: "commissionFromWalletForCash",
        label: "Take commission from driver wallet on cash rides",
        kind: "boolean",
      },
      { key: "minWalletAmount", label: "Min wallet balance", kind: "number", min: 0, step: 1 },
      {
        key: "minWithdrawalAmount",
        label: "Min withdrawal amount",
        kind: "number",
        min: 0,
        step: 1,
        help: "Drivers cannot request withdrawals below this amount.",
      },
      {
        key: "adjustSpEarningsAuto",
        label: "Adjust service-provider earnings automatically",
        kind: "boolean",
      },
    ],
  },
  {
    title: "Wallet money transfer",
    fields: [
      { key: "walletTransferEnabled", label: "Enable wallet money transfer", kind: "boolean" },
      { key: "walletTransferMinAmount", label: "Min transfer amount", kind: "number", min: 0 },
      {
        key: "walletTransferOtpMinutes",
        label: "OTP validity (minutes)",
        kind: "number",
        min: 1,
        max: 60,
      },
      { key: "walletTransferMaxPerTxn", label: "Max per transaction", kind: "number", min: 0 },
      { key: "walletTransferMaxPerDay", label: "Max per day", kind: "number", min: 0 },
    ],
  },
];

export function PaymentTab() {
  return <SettingsForm tab="payment" sections={SECTIONS} />;
}
