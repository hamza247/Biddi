import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Pencil, X, CloudRain } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface WeatherConditions {
  rainMmGte?: number | null;
  snowMmGte?: number | null;
  tempCLte?: number | null;
  tempCGte?: number | null;
  windMsGte?: number | null;
  weatherMain?: string[] | null;
}

interface WeatherRule {
  id: string;
  name: string;
  scope: "country" | "service_area";
  countryIso: string | null;
  serviceAreaId: string | null;
  conditions: WeatherConditions;
  kind: "multiplier" | "fixed";
  value: number;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[] | null;
  active: boolean;
  createdAt: string;
}

interface WeatherReading {
  id: string;
  scope: string;
  rainMm: number;
  snowMm: number;
  tempC: number;
  windMs: number;
  weatherMain: string | null;
  weatherDescription: string | null;
  observedAt: string;
  fetchedAt: string;
}

interface ServiceArea {
  id: string;
  name: string;
  country: string | null;
}

interface Country {
  id: string;
  name: string;
  isoCode: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEATHER_MAINS = [
  "Thunderstorm",
  "Drizzle",
  "Rain",
  "Snow",
  "Mist",
  "Fog",
  "Tornado",
];

interface FormState {
  name: string;
  scope: "country" | "service_area";
  countryIso: string;
  serviceAreaId: string;
  rainMmGte: string;
  snowMmGte: string;
  tempCLte: string;
  tempCGte: string;
  windMsGte: string;
  weatherMain: string[];
  kind: "multiplier" | "fixed";
  value: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  scope: "country",
  countryIso: "",
  serviceAreaId: "",
  rainMmGte: "",
  snowMmGte: "",
  tempCLte: "",
  tempCGte: "",
  windMsGte: "",
  weatherMain: [],
  kind: "multiplier",
  value: "1.5",
  startTime: "",
  endTime: "",
  daysOfWeek: [],
  active: true,
};

function ruleToForm(r: WeatherRule): FormState {
  return {
    name: r.name,
    scope: r.scope,
    countryIso: r.countryIso ?? "",
    serviceAreaId: r.serviceAreaId ?? "",
    rainMmGte: r.conditions.rainMmGte?.toString() ?? "",
    snowMmGte: r.conditions.snowMmGte?.toString() ?? "",
    tempCLte: r.conditions.tempCLte?.toString() ?? "",
    tempCGte: r.conditions.tempCGte?.toString() ?? "",
    windMsGte: r.conditions.windMsGte?.toString() ?? "",
    weatherMain: r.conditions.weatherMain ?? [],
    kind: r.kind,
    value: r.value.toString(),
    startTime: r.startTime ?? "",
    endTime: r.endTime ?? "",
    daysOfWeek: r.daysOfWeek ?? [],
    active: r.active,
  };
}

function parseOptionalNumber(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formToPayload(f: FormState) {
  const conditions: WeatherConditions = {
    rainMmGte: parseOptionalNumber(f.rainMmGte),
    snowMmGte: parseOptionalNumber(f.snowMmGte),
    tempCLte: parseOptionalNumber(f.tempCLte),
    tempCGte: parseOptionalNumber(f.tempCGte),
    windMsGte: parseOptionalNumber(f.windMsGte),
    weatherMain: f.weatherMain.length > 0 ? f.weatherMain : null,
  };
  return {
    name: f.name.trim(),
    scope: f.scope,
    countryIso: f.scope === "country" ? f.countryIso.toUpperCase() : null,
    serviceAreaId: f.scope === "service_area" ? f.serviceAreaId : null,
    conditions,
    kind: f.kind,
    value: Number(f.value),
    startTime: f.startTime || null,
    endTime: f.endTime || null,
    daysOfWeek: f.daysOfWeek.length > 0 ? f.daysOfWeek : null,
    active: f.active,
  };
}

export default function WeatherSurchargePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "weather-surcharge-rules"],
    queryFn: () => api<{ rules: WeatherRule[] }>("/admin/weather-surcharge-rules"),
  });

  const { data: areasData } = useQuery({
    queryKey: ["admin", "service-areas"],
    queryFn: () => api<{ serviceAreas: ServiceArea[] }>("/admin/service-areas"),
  });

  const { data: countriesData } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => api<{ countries: Country[] }>("/admin/countries"),
  });

  const { data: readingsData } = useQuery({
    queryKey: ["admin", "weather-readings"],
    queryFn: () => api<{ readings: WeatherReading[] }>("/admin/weather-readings"),
    refetchInterval: 60_000,
  });

  const rules = data?.rules ?? [];
  const serviceAreas = areasData?.serviceAreas ?? [];
  const countries = countriesData?.countries ?? [];
  const readings = readingsData?.readings ?? [];

  const reset = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setShowForm(false);
  };

  const save = useMutation({
    mutationFn: (payload: ReturnType<typeof formToPayload>) =>
      editingId
        ? api(`/admin/weather-surcharge-rules/${editingId}`, {
            method: "PATCH",
            json: payload,
          })
        : api("/admin/weather-surcharge-rules", {
            method: "POST",
            json: payload,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "weather-surcharge-rules"] });
      toast({ title: editingId ? "Rule updated" : "Rule created" });
      reset();
    },
    onError: (err: unknown) => {
      const description =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not save rule.";
      toast({ title: "Save failed", description, variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/weather-surcharge-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "weather-surcharge-rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = formToPayload(form);
    if (!payload.name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (payload.scope === "country" && !payload.countryIso) {
      toast({ title: "Country is required", variant: "destructive" });
      return;
    }
    if (payload.scope === "service_area" && !payload.serviceAreaId) {
      toast({ title: "Service area is required", variant: "destructive" });
      return;
    }
    const c = payload.conditions;
    const hasCond =
      c.rainMmGte != null ||
      c.snowMmGte != null ||
      c.tempCLte != null ||
      c.tempCGte != null ||
      c.windMsGte != null ||
      (c.weatherMain && c.weatherMain.length > 0);
    if (!hasCond) {
      toast({
        title: "At least one condition is required",
        variant: "destructive",
      });
      return;
    }
    if (payload.kind === "multiplier" && payload.value < 1) {
      toast({
        title: "Multiplier must be at least 1.0",
        variant: "destructive",
      });
      return;
    }
    save.mutate(payload);
  };

  const beginEdit = (r: WeatherRule) => {
    setForm(ruleToForm(r));
    setEditingId(r.id);
    setShowForm(true);
  };

  const scopeLabel = (r: WeatherRule) =>
    r.scope === "country"
      ? `Country: ${r.countryIso}`
      : `Service area: ${
          serviceAreas.find((a) => a.id === r.serviceAreaId)?.name ?? r.serviceAreaId
        }`;

  const readingForRule = (r: WeatherRule): WeatherReading | undefined => {
    const key =
      r.scope === "country"
        ? `country:${r.countryIso}`
        : `service_area:${r.serviceAreaId}`;
    return readings.find((x) => x.scope === key);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CloudRain className="h-6 w-6" />
            Weather Surcharge
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically increase fares during heavy rain, snow, extreme heat
            or cold, or high winds. Polled every 15 minutes from OpenWeather.
          </p>
        </div>
        <Button
          onClick={() => {
            if (showForm) reset();
            else setShowForm(true);
          }}
        >
          {showForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          {showForm ? "Cancel" : "New rule"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="rounded-lg border bg-card p-6 space-y-5"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Heavy rain — Casablanca"
              />
            </div>
            <div>
              <Label>Scope</Label>
              <Select
                value={form.scope}
                onValueChange={(v) =>
                  setForm({ ...form, scope: v as "country" | "service_area" })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="country">Country</SelectItem>
                  <SelectItem value="service_area">Service area</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scope === "country" ? (
              <div>
                <Label>Country</Label>
                <Select
                  value={form.countryIso}
                  onValueChange={(v) => setForm({ ...form, countryIso: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent>
                    {countries.map((c) => (
                      <SelectItem key={c.id} value={c.isoCode}>
                        {c.name} ({c.isoCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Service area</Label>
                <Select
                  value={form.serviceAreaId}
                  onValueChange={(v) => setForm({ ...form, serviceAreaId: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    {serviceAreas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Conditions (any match triggers)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label>Rain ≥ (mm/h)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.rainMmGte}
                  onChange={(e) => setForm({ ...form, rainMmGte: e.target.value })}
                />
              </div>
              <div>
                <Label>Snow ≥ (mm/h)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.snowMmGte}
                  onChange={(e) => setForm({ ...form, snowMmGte: e.target.value })}
                />
              </div>
              <div>
                <Label>Wind ≥ (m/s)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.windMsGte}
                  onChange={(e) => setForm({ ...form, windMsGte: e.target.value })}
                />
              </div>
              <div>
                <Label>Temp ≤ (°C)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.tempCLte}
                  onChange={(e) => setForm({ ...form, tempCLte: e.target.value })}
                />
              </div>
              <div>
                <Label>Temp ≥ (°C)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.tempCGte}
                  onChange={(e) => setForm({ ...form, tempCGte: e.target.value })}
                />
              </div>
              <div>
                <Label>Weather main</Label>
                <div className="flex flex-wrap gap-1 mt-2">
                  {WEATHER_MAINS.map((m) => {
                    const active = form.weatherMain.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            weatherMain: active
                              ? form.weatherMain.filter((x) => x !== m)
                              : [...form.weatherMain, m],
                          })
                        }
                        className={`text-xs px-2 py-1 rounded border ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Surcharge type</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  setForm({ ...form, kind: v as "multiplier" | "fixed" })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiplier">Multiplier</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{form.kind === "multiplier" ? "Multiplier (×)" : "Amount"}</Label>
              <Input
                type="number"
                step="0.05"
                min={form.kind === "multiplier" ? "1" : "0"}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
              <span className="text-sm">{form.active ? "Active" : "Inactive"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Starts at (HH:MM, optional)</Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </div>
            <div>
              <Label>Ends at (HH:MM, optional)</Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </div>
            <div>
              <Label>Days of week</Label>
              <div className="flex gap-1 mt-2">
                {DAY_LABELS.map((d, i) => {
                  const active = form.daysOfWeek.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          daysOfWeek: active
                            ? form.daysOfWeek.filter((x) => x !== i)
                            : [...form.daysOfWeek, i],
                        })
                      }
                      className={`text-xs w-9 py-1 rounded border ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {editingId ? "Save changes" : "Create rule"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No weather surcharge rules yet. Click <strong>New rule</strong> to add one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Scope</th>
                <th className="text-left p-3">Conditions</th>
                <th className="text-left p-3">Surcharge</th>
                <th className="text-left p-3">Window</th>
                <th className="text-left p-3">Latest reading</th>
                <th className="text-left p-3">Active</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const reading = readingForRule(r);
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3">{scopeLabel(r)}</td>
                    <td className="p-3 text-xs">
                      {[
                        r.conditions.rainMmGte != null && `rain ≥ ${r.conditions.rainMmGte}mm`,
                        r.conditions.snowMmGte != null && `snow ≥ ${r.conditions.snowMmGte}mm`,
                        r.conditions.windMsGte != null && `wind ≥ ${r.conditions.windMsGte}m/s`,
                        r.conditions.tempCLte != null && `temp ≤ ${r.conditions.tempCLte}°C`,
                        r.conditions.tempCGte != null && `temp ≥ ${r.conditions.tempCGte}°C`,
                        r.conditions.weatherMain && r.conditions.weatherMain.length > 0 &&
                          `main: ${r.conditions.weatherMain.join(", ")}`,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </td>
                    <td className="p-3">
                      {r.kind === "multiplier" ? `×${r.value.toFixed(2)}` : `+${r.value.toFixed(2)}`}
                    </td>
                    <td className="p-3 text-xs">
                      {r.startTime && r.endTime
                        ? `${r.startTime}–${r.endTime}`
                        : "Any time"}
                      {r.daysOfWeek && r.daysOfWeek.length > 0 && (
                        <div className="text-muted-foreground">
                          {r.daysOfWeek.map((d) => DAY_LABELS[d]).join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {reading
                        ? `${reading.weatherMain ?? "?"} • ${reading.tempC.toFixed(1)}°C • rain ${reading.rainMm.toFixed(1)}mm • wind ${reading.windMs.toFixed(1)}m/s`
                        : "No reading yet"}
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          r.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => beginEdit(r)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete rule "${r.name}"?`)) {
                            remove.mutate(r.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
