import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Save, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { TabSettingsResponse } from "./types";

interface ToggleField {
  key: string;
  label: string;
  help?: string;
}
interface NumberField {
  key: string;
  label: string;
  help?: string;
  min?: number;
  max?: number;
}
interface SelectField {
  key: string;
  label: string;
  help?: string;
  options: { value: string; label: string }[];
}
interface Group {
  id: string;
  title: string;
  description?: string;
  toggles: ToggleField[];
  numbers?: NumberField[];
  selects?: SelectField[];
}

const GROUPS: Group[] = [
  {
    id: "ride",
    title: "Ride",
    toggles: [
      { key: "appRideEnableScheduledRides", label: "Scheduled rides", help: "Riders can book trips for a future time." },
      { key: "appRideEnableMultiStop", label: "Multi-stop trips", help: "Allow adding extra stops on a single trip." },
      { key: "appRideEnableFareEditing", label: "Fare editing", help: "Drivers/admins can adjust the fare after the trip." },
      { key: "appRideShowDriverDetailsBeforeAccept", label: "Show driver details before accept" },
    ],
  },
  {
    id: "driver",
    title: "Driver",
    toggles: [
      { key: "driverEtaLabelsEnabled", label: "Driver ETA labels", help: "Show ETA pill badges on the driver home map." },
      { key: "appDriverEnableDocumentReupload", label: "Document re-upload" },
      { key: "appDriverEnableEarningsBreakdown", label: "Earnings breakdown screen" },
      { key: "appDriverAutoAcceptEnabled", label: "Auto-accept rides" },
    ],
    numbers: [
      {
        key: "driverStaleLocationThresholdSeconds",
        label: "Stale location alert threshold (seconds)",
        help: "Drivers whose last GPS ping is older than this get a warning state on the live map and admins receive a toast. Range: 30–110s (capped below the 120s server eviction window).",
        min: 30,
        max: 110,
      },
    ],
  },
  {
    id: "user",
    title: "User",
    toggles: [
      { key: "appUserEnableProfileEdit", label: "Profile editing" },
      { key: "appUserEnableFavoriteDrivers", label: "Favourite drivers" },
      { key: "appUserEnableSaveAddresses", label: "Saved addresses" },
    ],
  },
  {
    id: "wallet",
    title: "Wallet",
    toggles: [
      { key: "appWalletEnableTopUp", label: "Wallet top-up" },
      { key: "appWalletEnableWithdrawalRequest", label: "Withdrawal request" },
    ],
  },
  {
    id: "referral",
    title: "Referral",
    toggles: [{ key: "appReferralEnabled", label: "Referral program" }],
    numbers: [
      { key: "appReferralBonusUser", label: "Rider bonus", min: 0 },
      { key: "appReferralBonusDriver", label: "Driver bonus", min: 0 },
    ],
  },
  {
    id: "reward",
    title: "Reward",
    toggles: [{ key: "appRewardEnabled", label: "Driver rewards", help: "Use the Reward Settings page to configure tiers." }],
  },
  {
    id: "safety",
    title: "Safety",
    toggles: [
      { key: "appSafetyEnableSosButton", label: "SOS button" },
      { key: "appSafetyEnableTripSharing", label: "Trip sharing" },
      { key: "appSafetyEnableEmergencyContacts", label: "Emergency contacts" },
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility",
    toggles: [
      { key: "appAccessibilityEnableLargeText", label: "Large text mode" },
      { key: "appAccessibilityEnableHighContrast", label: "High contrast mode" },
    ],
  },
  {
    id: "ads",
    title: "Advertisement",
    toggles: [{ key: "appAdvertisementShowBanners", label: "Show in-app banner ads" }],
  },
  {
    id: "giftcard",
    title: "Gift Card",
    toggles: [{ key: "appGiftCardEnabled", label: "Gift cards" }],
  },
  {
    id: "rating",
    title: "Rating & Tips",
    toggles: [
      { key: "appRatingEnabled", label: "Trip ratings" },
      { key: "appTipsEnabled", label: "Driver tips" },
    ],
  },
  {
    id: "smartlogin",
    title: "Smart Login",
    toggles: [{ key: "appSmartLoginEnabled", label: "Smart login (biometrics / saved sessions)" }],
  },
  {
    id: "intercity",
    title: "InterCity",
    toggles: [{ key: "appInterCityEnabled", label: "InterCity rides" }],
  },
  {
    id: "pool",
    title: "Pool",
    toggles: [{ key: "appPoolEnabled", label: "Ride pooling / shared rides" }],
  },
  {
    id: "queuedRides",
    title: "Queued Ride Requests",
    description:
      "Drivers on an active trip can receive, accept, and queue ONE upcoming ride whose pickup is near their current dropoff. The queued ride auto-activates when the current trip completes.",
    toggles: [
      {
        key: "queuedRidesEnabled",
        label: "Enable queued ride requests",
        help: "Master switch — when off, drivers will never be offered a queued next-ride and the queue feature is dormant.",
      },
    ],
    numbers: [
      {
        key: "queuedRidesRadiusKm",
        label: "Pickup radius (km)",
        help: "How close a candidate ride's pickup must be to the driver's current dropoff.",
        min: 0.1,
        max: 50,
      },
      {
        key: "queuedRidesExpirySeconds",
        label: "Candidate expiry (seconds)",
        help: "How long an offered candidate stays valid before it disappears from the driver's UI.",
        min: 5,
        max: 600,
      },
      {
        key: "queuedRidesLeadDistanceKm",
        label: "Offer when ≤ this far from dropoff (km)",
        help: "Only start offering queued candidates once the driver is within this distance of their current dropoff.",
        min: 0.1,
        max: 25,
      },
      {
        key: "queuedRidesLeadMinutes",
        label: "Offer when ≤ this many minutes left",
        help: "Alternative threshold based on remaining trip minutes.",
        min: 0,
        max: 60,
      },
      {
        key: "queuedRidesMaxPerDriver",
        label: "Max queued rides per driver",
        help: "Upper cap on how many rides a single driver can hold in their queue at once.",
        min: 1,
        max: 5,
      },
    ],
  },
  {
    id: "destinationMode",
    title: "Driver Destination Mode",
    description:
      "Drivers set a destination address and only receive ride requests heading toward it. Daily usage is capped to limit cherry-picking.",
    toggles: [
      {
        key: "destinationModeEnabled",
        label: "Enable destination mode",
        help: "Master switch — when off, the driver app hides the feature and the filter is never applied.",
      },
      {
        key: "destinationModeAutoDisableOnTrip",
        label: "Auto-disable on matching trip",
        help: "When the driver completes a ride whose dropoff matches their destination, the filter switches off automatically.",
      },
    ],
    numbers: [
      {
        key: "destinationModeMaxPerDay",
        label: "Max activations per driver per day",
        help: "How many times a driver can turn destination mode on within a 24h window.",
        min: 0,
        max: 20,
      },
      {
        key: "destinationModeMatchRadiusKm",
        label: "Dropoff match radius (km)",
        help: "Ride dropoff is considered a match if it is within this radius of the driver's destination.",
        min: 0.1,
        max: 50,
      },
      {
        key: "destinationModeCorridorKm",
        label: "Corridor width (km)",
        help: "Cross-track distance from the pickup→dropoff bearing toward the destination. Rides whose route is within this corridor count as 'on the way'.",
        min: 0.1,
        max: 25,
      },
      {
        key: "destinationModeAutoDisableMinutes",
        label: "Auto-disable after (minutes, 0 = off)",
        help: "Optional time-based auto-disable. Set to 0 to require manual deactivation.",
        min: 0,
        max: 720,
      },
    ],
  },
  {
    id: "booking",
    title: "Booking",
    toggles: [{ key: "appBookingEnableFutureRides", label: "Future bookings" }],
    numbers: [
      { key: "appBookingMaxAdvanceDays", label: "Max advance days", min: 1, max: 365 },
    ],
  },
  {
    id: "heatmap",
    title: "Heatmap (real-time surge)",
    description:
      "Server-side aggregator that computes surge zones from open ride requests vs online drivers and pushes them to the driver app over Socket.IO.",
    toggles: [
      { key: "heatmapEnabled", label: "Enable surge heatmap", help: "When off, the driver map shows no zones and no broadcasts are emitted." },
    ],
    numbers: [
      { key: "heatmapRefreshSeconds", label: "Refresh interval (s)", help: "How often the aggregator recomputes & broadcasts. 5–120s.", min: 5, max: 120 },
      { key: "heatmapGridMeters", label: "Grid cell size (m)", help: "Approx. cell width; 500 ≈ a city block. 100–5000m.", min: 100, max: 5000 },
      { key: "heatmapDemandLookbackSeconds", label: "Demand lookback (s)", help: "How far back to count open ride requests. 30–3600s.", min: 30, max: 3600 },
      { key: "heatmapSupplyStaleSeconds", label: "Supply staleness (s)", help: "Drivers whose last GPS ping is older than this don't count as supply.", min: 30, max: 600 },
      { key: "heatmapSurgeThresholdLight", label: "Tier — light surge ≥", help: "demand/(supply+1) cut for the lightest zone." },
      { key: "heatmapSurgeThresholdMedium", label: "Tier — medium surge ≥" },
      { key: "heatmapSurgeThresholdHigh", label: "Tier — high surge ≥" },
      { key: "heatmapSurgeThresholdVeryHigh", label: "Tier — very high surge ≥" },
      { key: "heatmapBonusBase", label: "Bonus base ($)", help: "Per-tier bonus shown to drivers when label mode = bonus.", min: 0 },
    ],
    selects: [
      {
        key: "heatmapLabelMode",
        label: "Floating label",
        help: "What appears on each zone — surge multiplier (e.g. 1.5x), $ bonus, or no label.",
        options: [
          { value: "multiplier", label: "Surge multiplier (1.5x)" },
          { value: "bonus", label: "Dollar bonus (+$3)" },
          { value: "off", label: "No label" },
        ],
      },
    ],
  },
];

type Values = Record<string, string | number | boolean>;

export function AppSettingsTab() {
  const qc = useQueryClient();
  const queryKey = ["/admin/settings/app"] as const;

  const { data, isLoading, refetch, isFetching } = useQuery<TabSettingsResponse>({
    queryKey,
    queryFn: () => api<TabSettingsResponse>("/admin/settings/app"),
  });

  const [values, setValues] = useState<Values>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g, i) => [g.id, i < 4])),
  );

  useEffect(() => {
    if (!data) return;
    const init: Values = {};
    for (const g of GROUPS) {
      for (const t of g.toggles) init[t.key] = !!data.settings[t.key];
      for (const n of g.numbers ?? []) init[n.key] = Number(data.settings[n.key] ?? 0);
      for (const s of g.selects ?? []) init[s.key] = String(data.settings[s.key] ?? s.options[0].value);
    }
    setValues(init);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Values) =>
      api<TabSettingsResponse>("/admin/settings/app", { method: "PUT", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const counts = useMemo(() => {
    const m: Record<string, { on: number; total: number }> = {};
    for (const g of GROUPS) {
      let on = 0;
      for (const t of g.toggles) if (values[t.key]) on++;
      m[g.id] = { on, total: g.toggles.length };
    }
    return m;
  }, [values]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {GROUPS.map((g) => {
        const open = openGroups[g.id];
        return (
          <div key={g.id} className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !s[g.id] }))}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 rounded-t-lg"
              aria-expanded={open}
            >
              <div className="flex items-center gap-2 min-w-0">
                {open ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="font-medium text-sm">{g.title}</span>
                <span className="text-xs text-muted-foreground">
                  ({counts[g.id].on}/{counts[g.id].total} on)
                </span>
              </div>
            </button>
            {open && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t">
                {g.toggles.map((t) => (
                  <div
                    key={t.key}
                    className="flex items-start justify-between gap-4 p-3 rounded-md border border-border"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.label}</div>
                      {t.help && (
                        <div className="text-xs text-muted-foreground mt-0.5">{t.help}</div>
                      )}
                    </div>
                    <Switch
                      checked={!!values[t.key]}
                      onCheckedChange={(v) =>
                        setValues((prev) => ({ ...prev, [t.key]: v }))
                      }
                      aria-label={t.label}
                    />
                  </div>
                ))}
                {g.selects && g.selects.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {g.selects.map((s) => (
                      <div key={s.key}>
                        <Label htmlFor={`f-${s.key}`}>{s.label}</Label>
                        <select
                          id={`f-${s.key}`}
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={String(values[s.key] ?? s.options[0].value)}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [s.key]: e.target.value }))
                          }
                        >
                          {s.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {s.help && (
                          <p className="text-xs text-muted-foreground mt-1">{s.help}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {g.numbers && g.numbers.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {g.numbers.map((n) => (
                      <div key={n.key}>
                        <Label htmlFor={`f-${n.key}`}>{n.label}</Label>
                        <Input
                          id={`f-${n.key}`}
                          type="number"
                          min={n.min}
                          max={n.max}
                          value={String(values[n.key] ?? 0)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setValues((prev) => ({
                              ...prev,
                              [n.key]: v === "" ? "" : Number(v),
                            }));
                          }}
                          className="mt-1"
                        />
                        {n.help && (
                          <p className="text-xs text-muted-foreground mt-1">{n.help}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
        <Button onClick={() => save.mutate(values)} disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save changes
        </Button>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching || save.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Reset
        </Button>
      </div>
    </div>
  );
}
