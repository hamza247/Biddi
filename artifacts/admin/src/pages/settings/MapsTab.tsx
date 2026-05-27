import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  Save,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  PlayCircle,
} from "lucide-react";
import { MaskedSecretInput } from "./MaskedSecretInput";
import type { TabSettingsResponse } from "./types";
import {
  testGoogleMapsKey,
  type GoogleMapsLoadResult,
} from "@/lib/google-maps-loader";

type SubTab = "general" | "android" | "ios";
type Provider = "google" | "osm";

// Tiles are no longer admin-configurable: the base map is standardized to
// Google Roadmap everywhere. The remaining provider-per-feature settings
// only cover non-tile features (autocomplete, geocoding, routing).
const PROVIDER_FEATURES: { key: string; label: string }[] = [
  { key: "mapProviderAutocomplete", label: "Autocomplete" },
  { key: "mapProviderGeocode", label: "Geocoding" },
  { key: "mapProviderRouting", label: "Routing & ETA" },
];

type Values = Record<string, string | number | boolean>;

export function MapsTab() {
  const qc = useQueryClient();
  const queryKey = ["/admin/settings/maps"] as const;

  const { data, isLoading, refetch, isFetching } = useQuery<TabSettingsResponse>({
    queryKey,
    queryFn: () => api<TabSettingsResponse>("/admin/settings/maps"),
  });

  const [sub, setSub] = useState<SubTab>("general");
  const [values, setValues] = useState<Values>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GoogleMapsLoadResult | null>(
    null,
  );

  useEffect(() => {
    if (!data) return;
    const v: Values = {};
    for (const k of Object.keys(data.settings)) v[k] = data.settings[k];
    // secrets always start blank
    for (const k of [
      "googleMapsApiKey",
      "googleMapsApiKeyWeb",
      "googleMapsApiKeyIos",
      "googleMapsApiKeyAndroid",
    ]) {
      v[k] = "";
    }
    setValues(v);
  }, [data]);

  const set = (k: string, v: Values[string]) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const save = useMutation({
    mutationFn: (body: Values) =>
      api<TabSettingsResponse>("/admin/settings/maps", { method: "PUT", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Maps settings saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const onTestWebKey = async () => {
    const key = String(values.googleMapsApiKeyWeb ?? "").trim();
    if (!key) {
      toast({
        title: "Enter a key first",
        description:
          "Type the Google Maps web key into the field above before testing.",
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testGoogleMapsKey(key);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const onSave = () => {
    const body: Values = {};
    for (const [k, v] of Object.entries(values)) {
      const isSecret = k.startsWith("googleMapsApiKey");
      if (isSecret && (v === "" || v == null)) continue;
      body[k] = v;
    }
    save.mutate(body);
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const has = data._hasSecrets;

  return (
    <div className="space-y-6">
      <div className="border-b border-border">
        <div className="flex gap-1 flex-wrap">
          {(["general", "android", "ios"] as SubTab[]).map((k) => {
            const active = sub === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSub(k)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {k === "general" ? "General" : k === "android" ? "Android" : "iOS App"}
              </button>
            );
          })}
        </div>
      </div>

      {sub === "general" && (
        <div className="space-y-6">
          <div className="rounded-md border border-blue-300/40 bg-blue-50 dark:bg-blue-900/20 p-3 flex gap-2 text-xs text-blue-900 dark:text-blue-100">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Maps stack: Google + OSRM.</strong> Geocoding,
              autocomplete, and place details all run through Google. Ride
              routing geometry uses OSRM. Base map tiles come from Google
              Roadmap; if no Google web key is configured, admin maps fall
              back to the raw OpenStreetMap tile server so the page is
              never blank. MapTiler, Nominatim, and CARTO have been removed
              from the stack.
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Google server API key</h3>
            <Label htmlFor="gmaps-server">API key</Label>
            <div className="mt-1">
              <MaskedSecretInput
                id="gmaps-server"
                value={String(values.googleMapsApiKey ?? "")}
                onChange={(v) => set("googleMapsApiKey", v)}
                hasSaved={has.googleMapsApiKey}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Used by the API server for backend Google calls. Restrict by IP in Google Cloud
              Console.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Google web panel key</h3>
            <Label htmlFor="gmaps-web">API key (Web)</Label>
            <div className="mt-1">
              <MaskedSecretInput
                id="gmaps-web"
                value={String(values.googleMapsApiKeyWeb ?? "")}
                onChange={(v) => {
                  set("googleMapsApiKeyWeb", v);
                  if (testResult) setTestResult(null);
                }}
                hasSaved={has.googleMapsApiKeyWeb}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Restrict by HTTP referrer to your *.replit.dev and production domains.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTestWebKey}
                disabled={
                  testing || !String(values.googleMapsApiKeyWeb ?? "").trim()
                }
                data-testid="button-test-google-web-key"
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <PlayCircle className="w-4 h-4 mr-2" />
                )}
                Test key
              </Button>
              <span className="text-xs text-muted-foreground">
                Runs a one-off load against the value above without saving.
              </span>
            </div>
            {testResult && (
              <div
                className={`mt-2 rounded-md border p-3 text-xs flex gap-2 ${
                  testResult.status === "ready"
                    ? "border-green-300/40 bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100"
                    : "border-red-300/40 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100"
                }`}
                data-testid="result-test-google-web-key"
              >
                {testResult.status === "ready" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div>
                  {testResult.status === "ready" ? (
                    <>
                      <strong>Key works.</strong> The Google Maps JavaScript
                      API loaded successfully with this value. Save changes to
                      apply it everywhere.
                    </>
                  ) : testResult.status === "auth-failed" ? (
                    <>
                      <strong>Key was rejected ({testResult.reason}).</strong>{" "}
                      {testResult.message}
                    </>
                  ) : (
                    <>
                      <strong>Could not test the key.</strong>{" "}
                      {testResult.message}
                    </>
                  )}
                </div>
              </div>
            )}
            <div
              className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1"
              data-testid="hint-google-web-key-prereqs"
            >
              <div className="font-semibold text-foreground">
                For this key to load Google Roadmap tiles in the admin panel:
              </div>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>
                  Enable <strong>Maps JavaScript API</strong> on the Google
                  Cloud project that owns this key.
                </li>
                <li>
                  Enable <strong>billing</strong> on that same Google Cloud
                  project.
                </li>
                <li>
                  Add the following domains to the key's{" "}
                  <strong>HTTP referrer restrictions</strong> in Google Cloud
                  Console:
                  <ul className="list-none mt-1 space-y-0.5">
                    {(
                      [
                        "localhost",
                        "127.0.0.1",
                        typeof window !== "undefined" ? window.location.origin : null,
                      ] as (string | null)[]
                    )
                      .filter(Boolean)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .map((domain) => (
                        <li key={domain as string}>
                          <code className="px-1 py-0.5 rounded bg-background border border-border text-foreground">
                            {domain}
                          </code>
                        </li>
                      ))}
                    <li className="text-muted-foreground italic">
                      + your production domain (add after deploying)
                    </li>
                  </ul>
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 text-xs text-amber-900 dark:text-amber-100">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Restrict your Google keys</strong> in Google Cloud Console before going
              live: Web → HTTP referrer, Android → package + SHA-1, iOS → bundle ID.
              Unrestricted keys can be abused and will be billed to your account.
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Live map default viewport</h3>
            <p className="text-xs text-muted-foreground">
              The position the live map opens to before any drivers come online.
              Once drivers are plotted the map auto-fits to the fleet, as usual.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="live-map-lat">Latitude</Label>
                <Input
                  id="live-map-lat"
                  type="number"
                  step="0.0001"
                  min={-90}
                  max={90}
                  value={String(values.liveMapDefaultLat ?? "")}
                  onChange={(e) =>
                    set("liveMapDefaultLat", e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="31.79"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="live-map-lng">Longitude</Label>
                <Input
                  id="live-map-lng"
                  type="number"
                  step="0.0001"
                  min={-180}
                  max={180}
                  value={String(values.liveMapDefaultLng ?? "")}
                  onChange={(e) =>
                    set("liveMapDefaultLng", e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="-7.09"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="live-map-zoom">Zoom level</Label>
                <Input
                  id="live-map-zoom"
                  type="number"
                  step="1"
                  min={1}
                  max={18}
                  value={String(values.liveMapDefaultZoom ?? "")}
                  onChange={(e) =>
                    set("liveMapDefaultZoom", e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="6"
                  className="mt-1"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: zoom 5–7 for a country view, 10–12 for a city view.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Routing endpoint (OSRM)</h3>
            <p className="text-xs text-muted-foreground">
              All ride routing geometry comes from OSRM. Point at a
              self-hosted instance if you don't want to rely on the public
              demo server. Geocoding + autocomplete are always Google.
            </p>
            <div>
              <Label htmlFor="osm-osrm">OSRM base URL</Label>
              <Input
                id="osm-osrm"
                value={String(values.osmRoutingUrl ?? "")}
                onChange={(e) => set("osmRoutingUrl", e.target.value)}
                placeholder="https://router.project-osrm.org"
                className="mt-1"
              />
            </div>
          </div>
        </div>
      )}

      {sub === "android" && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Android (Maps SDK for Android)</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Restrict by package name + SHA-1 in Google Cloud Console. Rebuild the app after saving.
          </p>
          <Label htmlFor="gmaps-android">Google Maps API key (Android)</Label>
          <div className="mt-1">
            <MaskedSecretInput
              id="gmaps-android"
              value={String(values.googleMapsApiKeyAndroid ?? "")}
              onChange={(v) => set("googleMapsApiKeyAndroid", v)}
              hasSaved={has.googleMapsApiKeyAndroid}
            />
          </div>
        </div>
      )}

      {sub === "ios" && (
        <div>
          <h3 className="text-sm font-semibold mb-1">iOS (Maps SDK for iOS)</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Restrict by bundle ID in Google Cloud Console. Rebuild the app after saving.
          </p>
          <Label htmlFor="gmaps-ios">Google Maps API key (iOS)</Label>
          <div className="mt-1">
            <MaskedSecretInput
              id="gmaps-ios"
              value={String(values.googleMapsApiKeyIos ?? "")}
              onChange={(v) => set("googleMapsApiKeyIos", v)}
              hasSaved={has.googleMapsApiKeyIos}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
        <Button onClick={onSave} disabled={save.isPending}>
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
