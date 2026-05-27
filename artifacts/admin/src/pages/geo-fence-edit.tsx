import { useEffect, useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  GEO_FENCE_TYPES,
  GEO_FENCE_TYPE_LABELS,
  countryFlagEmoji,
  type CountryRow,
  type GeoFenceLocation,
  type GeoFenceType,
} from "@/lib/geo-fence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { PolygonMapEditor } from "@/components/PolygonMapEditor";

interface FormState {
  name: string;
  country: string;
  type: GeoFenceType;
  active: boolean;
  polygonJson: string | null;
}

const EMPTY_FORM: FormState = {
  name: "",
  country: "Morocco",
  type: "service_area",
  active: true,
  polygonJson: null,
};

function getInitialType(): GeoFenceType {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("type");
  if (t && (GEO_FENCE_TYPES as readonly string[]).includes(t)) return t as GeoFenceType;
  return "service_area";
}

export default function GeoFenceEditPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute<{ id: string }>("/geo-fence/locations/:id/edit");
  const editingId = params?.id;
  const isNew = !editingId;
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(() =>
    isNew ? { ...EMPTY_FORM, type: getInitialType() } : { ...EMPTY_FORM },
  );
  const [initial, setInitial] = useState<FormState | null>(isNew ? { ...EMPTY_FORM, type: getInitialType() } : null);

  const { data: countriesData } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => api<{ countries: CountryRow[] }>("/admin/countries"),
  });
  const countries = countriesData?.countries ?? [];

  // Read the Google Maps web key from /config/public — the admin
  // settings endpoint redacts secret values, so the polygon editor
  // would never see the real key from there.
  interface PublicConfigResponse {
    googleMapsApiKeyWeb?: string | null;
  }
  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["config-public"],
    queryFn: () => api<PublicConfigResponse>("/config/public"),
  });
  const settings = settingsData
    ? { gmapsKey: settingsData.googleMapsApiKeyWeb || null }
    : null;

  const { data: existing, isLoading } = useQuery({
    queryKey: ["admin", "service-area", editingId],
    queryFn: () =>
      api<{ serviceArea: GeoFenceLocation }>(`/admin/service-areas/${editingId}`),
    enabled: !!editingId,
  });

  useEffect(() => {
    if (existing?.serviceArea) {
      const s: FormState = {
        name: existing.serviceArea.name,
        country: existing.serviceArea.country,
        type: existing.serviceArea.type,
        active: existing.serviceArea.active,
        polygonJson: existing.serviceArea.polygonJson,
      };
      setForm(s);
      setInitial(s);
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: (payload: FormState) =>
      isNew
        ? api("/admin/service-areas", { method: "POST", json: payload })
        : api(`/admin/service-areas/${editingId}`, { method: "PATCH", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "geo-fence-locations"] });
      qc.invalidateQueries({ queryKey: ["admin", "service-area", editingId] });
      toast({ title: isNew ? "Location created" : "Location updated" });
      setLocation("/geo-fence/locations");
    },
    onError: (err: unknown) => {
      const description =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Could not save the geo-fence location.";
      toast({ title: "Save failed", description, variant: "destructive" });
    },
  });

  const onReset = () => {
    if (initial) setForm(initial);
  };

  const onSubmit = () => {
    if (!form.name.trim()) {
      toast({ title: "Location name is required", variant: "destructive" });
      return;
    }
    save.mutate(form);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/geo-fence/locations">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">{isNew ? "Add Geo Fence Location" : "Edit Geo Fence Location"}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Draw a polygon on the map to define this zone, then save.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Form */}
        <div className="lg:col-span-4 space-y-4">
          <div>
            <Label>Location Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Casablanca Airport"
              className="mt-1"
              disabled={isLoading}
              data-testid="input-name"
            />
          </div>
          <div>
            <Label>Country *</Label>
            <Select
              value={form.country}
              onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}
              disabled={isLoading}
            >
              <SelectTrigger className="mt-1" data-testid="select-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[16rem]">
                {countries.length === 0 && (
                  <SelectItem value={form.country}>{form.country}</SelectItem>
                )}
                {countries.map((c) => (
                  <SelectItem key={c.id} value={c.name}>
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true">{countryFlagEmoji(c.isoCode)}</span>
                      <span>{c.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Location For *</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm((f) => ({ ...f, type: v as GeoFenceType }))}
              disabled={isLoading}
            >
              <SelectTrigger className="mt-1" data-testid="select-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GEO_FENCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {GEO_FENCE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label>Status</Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                disabled={isLoading}
                data-testid="switch-active"
              />
              <span className="text-xs text-muted-foreground">
                {form.active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Polygon: {form.polygonJson ? (
              <span className="text-green-600 font-medium">✓ Drawn</span>
            ) : (
              <span>Not drawn yet — use the map tools to add a polygon.</span>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={onSubmit} disabled={save.isPending || isLoading} data-testid="button-update">
              {save.isPending ? "Saving…" : isNew ? "Create" : "Update"}
            </Button>
            <Button variant="outline" onClick={onReset} disabled={save.isPending || !initial} data-testid="button-reset-form">
              Reset
            </Button>
            <Link href="/geo-fence/locations">
              <Button variant="ghost" data-testid="button-cancel">Cancel</Button>
            </Link>
          </div>
        </div>

        {/* Map */}
        <div className="lg:col-span-8">
          {settings ? (
            <PolygonMapEditor
              value={form.polygonJson}
              onChange={(v) => setForm((f) => ({ ...f, polygonJson: v }))}
              settings={settings}
            />
          ) : (
            <div
              className="w-full min-h-[480px] rounded-lg border bg-muted flex items-center justify-center text-sm text-muted-foreground"
              data-testid="polygon-map-loading"
            >
              {settingsLoading ? "Loading map…" : "Map unavailable"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
