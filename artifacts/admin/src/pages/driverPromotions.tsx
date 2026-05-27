import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Trophy, BarChart3 } from "lucide-react";

interface DriverPromotion {
  id: string;
  title: string;
  description: string | null;
  bonusAmount: number;
  requiredTrips: number;
  startAt: string;
  endAt: string;
  repeatType: "none" | "daily" | "weekly";
  serviceAreaId: string | null;
  vehicleTypeId: string | null;
  driverScope: "all" | "selected";
  eligibleDriverIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VehicleTypeOption {
  id: string;
  name: string;
}
interface ServiceAreaOption {
  id: string;
  name: string;
}

interface ProgressRow {
  id: string;
  driverId: string;
  driverName: string | null;
  driverPhone: string | null;
  cycleStart: string;
  cycleEnd: string;
  completedTrips: number;
  rewardCredited: boolean;
  creditedAt: string | null;
}

interface PromotionSummary {
  totalProgressDrivers: number;
  totalCompletedDrivers: number;
  totalBonusPaidCount: number;
  totalBonusPaidAmount: number;
  totalTripsLogged: number;
}

interface TripLogRow {
  id: string;
  driverId: string;
  driverName: string | null;
  rideId: string;
  cycleStart: string;
  createdAt: string;
}

interface FormState {
  title: string;
  description: string;
  bonusAmount: string;
  requiredTrips: string;
  startAt: string;
  endAt: string;
  repeatType: "none" | "daily" | "weekly";
  serviceAreaId: string;
  vehicleTypeId: string;
  driverScope: "all" | "selected";
  eligibleDriverIds: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  bonusAmount: "",
  requiredTrips: "1",
  startAt: "",
  endAt: "",
  repeatType: "none",
  serviceAreaId: "",
  vehicleTypeId: "",
  driverScope: "all",
  eligibleDriverIds: "",
  isActive: true,
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromPromotion(p: DriverPromotion): FormState {
  return {
    title: p.title,
    description: p.description ?? "",
    bonusAmount: String(p.bonusAmount),
    requiredTrips: String(p.requiredTrips),
    startAt: toLocalInput(p.startAt),
    endAt: toLocalInput(p.endAt),
    repeatType: p.repeatType,
    serviceAreaId: p.serviceAreaId ?? "",
    vehicleTypeId: p.vehicleTypeId ?? "",
    driverScope: p.driverScope,
    eligibleDriverIds: p.eligibleDriverIds.join(", "),
    isActive: p.isActive,
  };
}

export default function DriverPromotionsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DriverPromotion | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [progressFor, setProgressFor] = useState<DriverPromotion | null>(null);

  const promosQ = useQuery({
    queryKey: ["admin/driver-promotions"],
    queryFn: () =>
      api<{ promotions: DriverPromotion[] }>("/admin/driver-promotions").then(
        (r) => r.promotions,
      ),
  });

  const vehicleTypesQ = useQuery({
    queryKey: ["admin/vehicle-types"],
    queryFn: () =>
      api<{ vehicleTypes: VehicleTypeOption[] }>("/admin/vehicle-types")
        .then((r) => r.vehicleTypes ?? [])
        .catch(() => []),
  });

  const serviceAreasQ = useQuery({
    queryKey: ["admin/service-areas"],
    queryFn: () =>
      api<{ serviceAreas: ServiceAreaOption[] }>("/admin/service-areas")
        .then((r) => r.serviceAreas ?? [])
        .catch(() => []),
  });

  const progressQ = useQuery({
    queryKey: ["admin/driver-promotions/progress", progressFor?.id],
    enabled: !!progressFor,
    queryFn: () =>
      api<{ progress: ProgressRow[] }>(
        `/admin/driver-promotions/${progressFor!.id}/progress`,
      ).then((r) => r.progress),
  });

  const summaryQ = useQuery({
    queryKey: ["admin/driver-promotions/summary", progressFor?.id],
    enabled: !!progressFor,
    queryFn: () =>
      api<{ summary: PromotionSummary }>(
        `/admin/driver-promotions/${progressFor!.id}/summary`,
      ).then((r) => r.summary),
  });

  const tripLogsQ = useQuery({
    queryKey: ["admin/driver-promotions/trip-logs", progressFor?.id],
    enabled: !!progressFor,
    queryFn: () =>
      api<{ logs: TripLogRow[] }>(
        `/admin/driver-promotions/${progressFor!.id}/trip-logs`,
      ).then((r) => r.logs),
  });

  const upsert = useMutation({
    mutationFn: async () => {
      const payload = buildPayload(form);
      if (editing) {
        return api(`/admin/driver-promotions/${editing.id}`, {
          method: "PUT",
          json: payload,
        });
      }
      return api("/admin/driver-promotions", { method: "POST", json: payload });
    },
    onSuccess: () => {
      toast({ title: editing ? "Promotion updated" : "Promotion created" });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["admin/driver-promotions"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/driver-promotions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Promotion deleted" });
      qc.invalidateQueries({ queryKey: ["admin/driver-promotions"] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: (p: DriverPromotion) =>
      api(`/admin/driver-promotions/${p.id}`, {
        method: "PUT",
        json: { isActive: !p.isActive },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin/driver-promotions"] });
    },
  });

  const promotions = promosQ.data ?? [];

  const sorted = useMemo(
    () =>
      [...promotions].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [promotions],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Trophy className="w-5 h-5" /> Driver Promotions
          </h1>
          <p className="text-sm text-muted-foreground">
            Time-windowed quest bonuses for drivers (e.g. "$2 for 1 trip Sat 6PM-Sun 2AM").
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setForm(EMPTY_FORM);
            setDialogOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1" /> New Promotion
        </Button>
      </div>

      {promosQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : sorted.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          No promotions yet. Click "New Promotion" to create your first quest bonus.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-3">Title</th>
                <th className="p-3">Bonus</th>
                <th className="p-3">Trips</th>
                <th className="p-3">Window</th>
                <th className="p-3">Repeat</th>
                <th className="p-3">Scope</th>
                <th className="p-3">Active</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/20">
                  <td className="p-3 font-medium">{p.title}</td>
                  <td className="p-3">${p.bonusAmount.toFixed(2)}</td>
                  <td className="p-3">{p.requiredTrips}</td>
                  <td className="p-3 text-xs">
                    {new Date(p.startAt).toLocaleString()} →{" "}
                    {new Date(p.endAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{p.repeatType}</Badge>
                  </td>
                  <td className="p-3 text-xs">
                    {p.driverScope === "all"
                      ? "All drivers"
                      : `${p.eligibleDriverIds.length} selected`}
                  </td>
                  <td className="p-3">
                    <Switch
                      checked={p.isActive}
                      onCheckedChange={() => toggleActive.mutate(p)}
                    />
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setProgressFor(p)}
                      title="View progress"
                    >
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(p);
                        setForm(fromPromotion(p));
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Delete "${p.title}"?`)) del.mutate(p.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit "${editing.title}"` : "New driver promotion"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="$2 for 1 trip — Saturday Night Boost"
              />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="Complete trips between 6 PM Saturday and 2 AM Sunday."
              />
            </div>
            <div>
              <Label>Bonus amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.bonusAmount}
                onChange={(e) => setForm({ ...form, bonusAmount: e.target.value })}
              />
            </div>
            <div>
              <Label>Required trips</Label>
              <Input
                type="number"
                min="1"
                value={form.requiredTrips}
                onChange={(e) =>
                  setForm({ ...form, requiredTrips: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Starts at</Label>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
            </div>
            <div>
              <Label>Ends at</Label>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </div>
            <div>
              <Label>Repeat</Label>
              <Select
                value={form.repeatType}
                onValueChange={(v: "none" | "daily" | "weekly") =>
                  setForm({ ...form, repeatType: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vehicle type (optional)</Label>
              <Select
                value={form.vehicleTypeId || "any"}
                onValueChange={(v) =>
                  setForm({ ...form, vehicleTypeId: v === "any" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {(vehicleTypesQ.data ?? []).map((vt) => (
                    <SelectItem key={vt.id} value={vt.id}>
                      {vt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Service area (optional)</Label>
              <Select
                value={form.serviceAreaId || "any"}
                onValueChange={(v) =>
                  setForm({ ...form, serviceAreaId: v === "any" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {(serviceAreasQ.data ?? []).map((sa) => (
                    <SelectItem key={sa.id} value={sa.id}>
                      {sa.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Driver scope</Label>
              <Select
                value={form.driverScope}
                onValueChange={(v: "all" | "selected") =>
                  setForm({ ...form, driverScope: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All approved drivers</SelectItem>
                  <SelectItem value="selected">Selected drivers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.driverScope === "selected" && (
              <div className="col-span-2">
                <Label>Eligible driver IDs (comma-separated)</Label>
                <Textarea
                  rows={2}
                  value={form.eligibleDriverIds}
                  onChange={(e) =>
                    setForm({ ...form, eligibleDriverIds: e.target.value })
                  }
                  placeholder="uuid1, uuid2, uuid3"
                />
              </div>
            )}
            <div className="col-span-2 flex items-center gap-2">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={upsert.isPending}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!progressFor}
        onOpenChange={(v) => !v && setProgressFor(null)}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto space-y-4">
          <DialogHeader>
            <DialogTitle>
              Promotion report: {progressFor?.title}
            </DialogTitle>
          </DialogHeader>
          {summaryQ.data ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryStat label="Drivers active" value={summaryQ.data.totalProgressDrivers} />
              <SummaryStat label="Drivers earned" value={summaryQ.data.totalCompletedDrivers} />
              <SummaryStat label="Bonuses paid" value={summaryQ.data.totalBonusPaidCount} />
              <SummaryStat
                label="Total paid"
                value={`$${summaryQ.data.totalBonusPaidAmount.toFixed(2)}`}
              />
              <SummaryStat label="Trips logged" value={summaryQ.data.totalTripsLogged} />
            </div>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Driver progress</h3>
            {progressQ.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (progressQ.data ?? []).length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">
                No driver activity yet for this promotion.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-2">Driver</th>
                    <th className="p-2">Cycle start</th>
                    <th className="p-2">Trips</th>
                    <th className="p-2">Reward</th>
                  </tr>
                </thead>
                <tbody>
                  {(progressQ.data ?? []).map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">
                        <div>{p.driverName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.driverPhone ?? p.driverId}
                        </div>
                      </td>
                      <td className="p-2 text-xs">
                        {new Date(p.cycleStart).toLocaleString()}
                      </td>
                      <td className="p-2">{p.completedTrips}</td>
                      <td className="p-2">
                        {p.rewardCredited ? (
                          <Badge variant="default">Credited</Badge>
                        ) : (
                          <Badge variant="outline">In progress</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Recent trip logs</h3>
            {tripLogsQ.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (tripLogsQ.data ?? []).length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">
                No trips have been counted toward this promotion yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-2">Driver</th>
                    <th className="p-2">Ride</th>
                    <th className="p-2">Counted at</th>
                    <th className="p-2">Cycle</th>
                  </tr>
                </thead>
                <tbody>
                  {(tripLogsQ.data ?? []).map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="p-2">{l.driverName ?? l.driverId.slice(0, 8)}</td>
                      <td className="p-2 text-xs font-mono">{l.rideId.slice(0, 8)}</td>
                      <td className="p-2 text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                      <td className="p-2 text-xs">{new Date(l.cycleStart).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function buildPayload(form: FormState) {
  const ids = form.eligibleDriverIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const startAt = form.startAt ? new Date(form.startAt).toISOString() : "";
  const endAt = form.endAt ? new Date(form.endAt).toISOString() : "";
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    bonusAmount: Number(form.bonusAmount),
    requiredTrips: Number(form.requiredTrips),
    startAt,
    endAt,
    repeatType: form.repeatType,
    serviceAreaId: form.serviceAreaId || null,
    vehicleTypeId: form.vehicleTypeId || null,
    driverScope: form.driverScope,
    eligibleDriverIds: form.driverScope === "selected" ? ids : [],
    isActive: form.isActive,
  };
}
