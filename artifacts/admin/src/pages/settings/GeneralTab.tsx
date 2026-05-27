import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SettingsForm } from "./SettingsForm";
import type { SectionDef, SelectOption } from "./types";

const COUNTRIES = [
  { value: "MA", label: "Morocco" },
  { value: "US", label: "United States" },
  { value: "FR", label: "France" },
  { value: "ES", label: "Spain" },
  { value: "GB", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "IT", label: "Italy" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "EG", label: "Egypt" },
  { value: "TN", label: "Tunisia" },
  { value: "DZ", label: "Algeria" },
];

interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  isActive: boolean;
}

function buildSections(currencyOptions: SelectOption[]): SectionDef[] {
  return [
    {
      title: "Project",
      fields: [
        { key: "projectName", label: "Project name", kind: "text", placeholder: "Biddi" },
        { key: "adminIsdCode", label: "Admin ISD code", kind: "text", placeholder: "+212" },
        { key: "countryCode", label: "Country code", kind: "select", options: COUNTRIES },
        {
          key: "distanceUnit",
          label: "Default distance unit",
          kind: "select",
          options: [
            { value: "km", label: "Kilometres (KM)" },
            { value: "miles", label: "Miles" },
          ],
        },
        { key: "recordsPerPage", label: "Records per page", kind: "number", min: 5, max: 500 },
        { key: "googleAnalyticsId", label: "Google Analytics ID", kind: "text", placeholder: "G-XXXXXXX" },
      ],
    },
    {
      title: "Verification",
      fields: [
        {
          key: "driverEmailVerification",
          label: "Driver email verification",
          kind: "boolean",
          help: "Require drivers to verify their email after signup.",
        },
        {
          key: "userEmailVerification",
          label: "User email verification",
          kind: "boolean",
          help: "Require riders to verify their email after signup.",
        },
        {
          key: "enableEmailOptional",
          label: "Email optional at signup",
          kind: "boolean",
          help: "Let users complete signup with phone only — email can be added later.",
        },
      ],
    },
    {
      title: "Display currency",
      description:
        "Money is stored internally in USD and converted to this currency when shown in the rider, driver, and admin apps. Only currencies marked Active in Currency Management appear here.",
      fields: [
        {
          key: "displayCurrency",
          label: "Display currency",
          kind: "select",
          options: currencyOptions,
        },
      ],
    },
    {
      title: "Wallet quick amounts",
      description: "Three preset top-up amounts shown to riders in the wallet.",
      fields: [
        { key: "walletAmount1", label: "Amount 1", kind: "number", min: 0, step: 1 },
        { key: "walletAmount2", label: "Amount 2", kind: "number", min: 0, step: 1 },
        { key: "walletAmount3", label: "Amount 3", kind: "number", min: 0, step: 1 },
      ],
    },
    {
      title: "Maintenance mode",
      fields: [
        {
          key: "maintenanceModeUser",
          label: "Rider app maintenance mode",
          kind: "boolean",
          help: "When on, the rider app shows a maintenance screen and blocks new requests.",
        },
        {
          key: "maintenanceModeDriver",
          label: "Driver app maintenance mode",
          kind: "boolean",
          help: "When on, the driver app shows a maintenance screen and blocks new pickups.",
        },
      ],
    },
  ];
}

const FALLBACK_OPTIONS: SelectOption[] = [
  { value: "USD", label: "USD ($) — US Dollar" },
];

export function GeneralTab() {
  // The select must reflect what's actually available in Currency
  // Management. Disabling EUR there should immediately hide it here.
  // USD is always present (the canonical internal currency) and is
  // pinned active server-side so it can't disappear.
  const { data } = useQuery({
    queryKey: ["/admin/currencies"],
    queryFn: () => api<{ currencies: CurrencyRow[] }>("/admin/currencies"),
    staleTime: 30 * 1000,
  });

  const sections = useMemo(() => {
    const rows = data?.currencies ?? [];
    const active = rows
      .filter((c) => c.isActive)
      .map<SelectOption>((c) => ({
        value: c.code,
        label: `${c.code}${c.symbol && c.symbol !== c.code ? ` (${c.symbol})` : ""} — ${c.name}`,
      }));
    return buildSections(active.length > 0 ? active : FALLBACK_OPTIONS);
  }, [data]);

  return <SettingsForm tab="general" sections={sections} />;
}
