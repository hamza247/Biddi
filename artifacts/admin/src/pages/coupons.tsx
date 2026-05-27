import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
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
import { Plus, Pencil, Trash2, Tag, Power, BarChart3, Download } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { API_BASE, getToken } from "@/lib/api";

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscount: number | null;
  minTripAmount: number | null;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  totalUsed: number;
  validFrom: string | null;
  validUntil: string | null;
  firstRideOnly: boolean;
  countryCodes: string[] | null;
  vehicleTypeIds: string[] | null;
  active: boolean;
  createdAt: string;
}

interface VehicleTypeOption {
  id: string;
  name: string;
  classKey: string | null;
}

interface FormState {
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: string;
  maxDiscount: string;
  minTripAmount: string;
  usageLimitTotal: string;
  usageLimitPerUser: string;
  validFrom: string;
  validUntil: string;
  firstRideOnly: boolean;
  countryCodes: string;
  vehicleTypeIds: string[];
  active: boolean;
}

const EMPTY_FORM: FormState = {
  code: "",
  description: "",
  discountType: "percentage",
  discountValue: "",
  maxDiscount: "",
  minTripAmount: "",
  usageLimitTotal: "",
  usageLimitPerUser: "",
  validFrom: "",
  validUntil: "",
  firstRideOnly: false,
  countryCodes: "",
  vehicleTypeIds: [],
  active: true,
};

function fromCoupon(c: Coupon): FormState {
  const toLocal = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return {
    code: c.code,
    description: c.description ?? "",
    discountType: c.discountType,
    discountValue: String(c.discountValue),
    maxDiscount: c.maxDiscount != null ? String(c.maxDiscount) : "",
    minTripAmount: c.minTripAmount != null ? String(c.minTripAmount) : "",
    usageLimitTotal: c.usageLimitTotal != null ? String(c.usageLimitTotal) : "",
    usageLimitPerUser: c.usageLimitPerUser != null ? String(c.usageLimitPerUser) : "",
    validFrom: toLocal(c.validFrom),
    validUntil: toLocal(c.validUntil),
    firstRideOnly: c.firstRideOnly,
    countryCodes: (c.countryCodes ?? []).join(", "),
    vehicleTypeIds: c.vehicleTypeIds ?? [],
    active: c.active,
  };
}

function toPayload(f: FormState) {
  const num = (v: string): number | null => {
    if (!v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const intNum = (v: string): number | null => {
    const n = num(v);
    return n != null ? Math.floor(n) : null;
  };
  const codes = f.countryCodes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const localToIso = (v: string): string | null => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  };
  return {
    code: f.code.trim(),
    description: f.description.trim() || null,
    discountType: f.discountType,
    discountValue: num(f.discountValue) ?? 0,
    maxDiscount: num(f.maxDiscount),
    minTripAmount: num(f.minTripAmount),
    usageLimitTotal: intNum(f.usageLimitTotal),
    usageLimitPerUser: intNum(f.usageLimitPerUser),
    validFrom: localToIso(f.validFrom),
    validUntil: localToIso(f.validUntil),
    firstRideOnly: f.firstRideOnly,
    countryCodes: codes.length > 0 ? codes : null,
    vehicleTypeIds: f.vehicleTypeIds.length > 0 ? f.vehicleTypeIds : null,
    active: f.active,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDiscount(c: Coupon): string {
  if (c.discountType === "percentage") {
    const cap = c.maxDiscount != null ? ` (max ${c.maxDiscount})` : "";
    return `${c.discountValue}%${cap}`;
  }
  return `-${c.discountValue}`;
}

export default function CouponsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);
  const [statsTarget, setStatsTarget] = useState<Coupon | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "coupons"],
    queryFn: () => api<{ coupons: Coupon[] }>("/admin/coupons"),
  });

  const { data: vehicleTypesData } = useQuery({
    queryKey: ["admin", "vehicle-types-options"],
    queryFn: () => api<{ vehicleTypes: VehicleTypeOption[] }>("/admin/vehicle-types"),
  });
  const vehicleTypes = vehicleTypesData?.vehicleTypes ?? [];

  const saveMutation = useMutation({
    mutationFn: async (payload: ReturnType<typeof toPayload>) => {
      if (editing) {
        return api(`/admin/coupons/${editing.id}`, { method: "PATCH", json: payload });
      }
      return api("/admin/coupons", { method: "POST", json: payload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
      toast({ title: editing ? "Coupon updated" : "Coupon created" });
      setOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Please check the form and try again.";
      toast({ title: "Error saving coupon", description: msg, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api<{ ok: true; deactivated: boolean }>(`/admin/coupons/${id}`, { method: "DELETE" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
      toast({
        title: res.deactivated ? "Coupon deactivated" : "Coupon deleted",
        description: res.deactivated
          ? "Existing redemptions kept the coupon, so it was deactivated instead of deleted."
          : undefined,
      });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Something went wrong.";
      toast({ title: "Could not delete coupon", description: msg, variant: "destructive" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/coupons/${id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Could not update coupon.";
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm(fromCoupon(c));
    setOpen(true);
  };

  const valid = useMemo(() => {
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(form.code)) return false;
    const dv = Number(form.discountValue);
    if (!Number.isFinite(dv) || dv <= 0) return false;
    if (form.discountType === "percentage" && dv > 100) return false;
    return true;
  }, [form]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Coupons</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Promo codes riders can apply to a single trip. Redemption happens at trip completion — cancellations don't consume the allowance.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Coupon
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Discount</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Limits</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Validity</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Used</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : !data?.coupons?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  No coupons yet — create one to give riders a promo code.
                </td>
              </tr>
            ) : (
              data.coupons.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-mono font-semibold">{c.code}</span>
                    </div>
                    {c.description && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 ml-5 line-clamp-1">{c.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{formatDiscount(c)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{c.usageLimitTotal != null ? `${c.usageLimitTotal} total` : "Unlimited"}</div>
                    <div>{c.usageLimitPerUser != null ? `${c.usageLimitPerUser}/user` : "—/user"}</div>
                    {c.minTripAmount != null && <div>min trip {c.minTripAmount}</div>}
                    {c.firstRideOnly && <div>first ride only</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>From {formatDate(c.validFrom)}</div>
                    <div>Until {formatDate(c.validUntil)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                      {c.totalUsed}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.active ? (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-gray-200 text-gray-700">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatsTarget(c)}
                        className="h-7 w-7 p-0"
                        title="View performance"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive.mutate({ id: c.id, active: !c.active })}
                        className="h-7 w-7 p-0"
                        title={c.active ? "Deactivate" : "Activate"}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)} className="h-7 w-7 p-0" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(c)}
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Coupon — ${editing.code}` : "Add Coupon"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code *</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") }))}
                  placeholder="WELCOME10"
                  className="mt-1 font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Letters, numbers, - and _ only. Riders type this code.</p>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
                  <Label className="cursor-pointer">Active</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.firstRideOnly} onCheckedChange={(v) => setForm((f) => ({ ...f, firstRideOnly: v }))} />
                  <Label className="cursor-pointer">First ride only</Label>
                </div>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Welcome offer for new riders"
                className="mt-1"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Discount type *</Label>
                <Select value={form.discountType} onValueChange={(v) => setForm((f) => ({ ...f, discountType: v as "percentage" | "fixed" }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Value *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.discountValue}
                  onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                  placeholder={form.discountType === "percentage" ? "10" : "5"}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Max discount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.maxDiscount}
                  onChange={(e) => setForm((f) => ({ ...f, maxDiscount: e.target.value }))}
                  placeholder="(optional cap)"
                  className="mt-1"
                  disabled={form.discountType !== "percentage"}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Minimum trip</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.minTripAmount}
                  onChange={(e) => setForm((f) => ({ ...f, minTripAmount: e.target.value }))}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Total uses</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.usageLimitTotal}
                  onChange={(e) => setForm((f) => ({ ...f, usageLimitTotal: e.target.value }))}
                  placeholder="(unlimited)"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Per user</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.usageLimitPerUser}
                  onChange={(e) => setForm((f) => ({ ...f, usageLimitPerUser: e.target.value }))}
                  placeholder="(unlimited)"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valid from</Label>
                <Input
                  type="datetime-local"
                  value={form.validFrom}
                  onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Valid until</Label>
                <Input
                  type="datetime-local"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Eligible country codes</Label>
              <Input
                value={form.countryCodes}
                onChange={(e) => setForm((f) => ({ ...f, countryCodes: e.target.value }))}
                placeholder="+212, +1 (leave blank for all)"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Matches the rider's saved phone country code. Leave blank to allow all countries.</p>
            </div>

            <div>
              <Label>Eligible service categories</Label>
              <div className="mt-1 max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                {vehicleTypes.length === 0 && (
                  <p className="text-[11px] text-muted-foreground p-2">No service categories found.</p>
                )}
                {vehicleTypes.map((vt) => {
                  const checked = form.vehicleTypeIds.includes(vt.id);
                  return (
                    <label key={vt.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/30 px-1.5 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((f) => ({
                            ...f,
                            vehicleTypeIds: checked
                              ? f.vehicleTypeIds.filter((id) => id !== vt.id)
                              : [...f.vehicleTypeIds, vt.id],
                          }))
                        }
                      />
                      <span>{vt.name}</span>
                      {vt.classKey && <span className="text-[11px] text-muted-foreground font-mono">({vt.classKey})</span>}
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Leave all unchecked to allow every category.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(toPayload(form))} disabled={!valid || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Create coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CouponStatsDialog
        coupon={statsTarget}
        onClose={() => setStatsTarget(null)}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete coupon</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            {deleteTarget && deleteTarget.totalUsed > 0 ? (
              <p>
                Coupon <span className="font-mono font-semibold">{deleteTarget.code}</span> has been redeemed{" "}
                <strong>{deleteTarget.totalUsed} time(s)</strong>. It will be deactivated to keep historical invoices intact.
              </p>
            ) : (
              <p>
                Are you sure you want to delete coupon{" "}
                <span className="font-mono font-semibold">{deleteTarget?.code}</span>? This cannot be undone.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Working…" : deleteTarget && deleteTarget.totalUsed > 0 ? "Deactivate" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CouponStats {
  coupon: Coupon;
  summary: {
    totalRedemptions: number;
    totalDiscount: number;
    totalRevenue: number;
    uniqueRiders: number;
    firstRedeemedAt: string | null;
    lastRedeemedAt: string | null;
  };
  dailySeries: { day: string; redemptions: number; discount: number }[];
  recent: {
    id: string;
    rideId: string;
    userId: string;
    discountAmount: number;
    redeemedAt: string;
    riderFirstName: string | null;
    riderLastName: string | null;
    riderPhone: string | null;
    pickupLabel: string | null;
    dropoffLabel: string | null;
    finalAmount: number | null;
    rideStatus: string | null;
  }[];
}

function CouponStatsDialog({
  coupon,
  onClose,
}: {
  coupon: Coupon | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "coupons", coupon?.id, "stats"],
    queryFn: () => api<CouponStats>(`/admin/coupons/${coupon!.id}/stats`),
    enabled: !!coupon,
  });

  const downloadCsv = async () => {
    if (!coupon) return;
    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}/admin/coupons/${coupon.id}/redemptions.csv`,
        { headers: token ? { authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coupon-${coupon.code.replace(/[^A-Za-z0-9_-]/g, "_")}-redemptions.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Could not download CSV.",
        variant: "destructive",
      });
    }
  };

  const summary = data?.summary;
  const series = data?.dailySeries ?? [];
  const recent = data?.recent ?? [];

  return (
    <Dialog open={!!coupon} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-4 h-4" />
            <span className="font-mono">{coupon?.code}</span>
            <span className="text-muted-foreground font-normal text-sm">— performance</span>
          </DialogTitle>
        </DialogHeader>

        {isError ? (
          <div className="py-8 text-center text-sm">
            <div className="text-red-600 mb-2">
              Could not load coupon stats.
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              {error instanceof Error ? error.message : "Please try again."}
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : isLoading || !data ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Redemptions" value={String(summary?.totalRedemptions ?? 0)} />
              <StatCard
                label="Total discount given"
                value={(summary?.totalDiscount ?? 0).toFixed(2)}
              />
              <StatCard
                label="Trip revenue"
                value={(summary?.totalRevenue ?? 0).toFixed(2)}
                hint="Sum of final fares on trips that used this coupon"
              />
              <StatCard label="Unique riders" value={String(summary?.uniqueRiders ?? 0)} />
            </div>

            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">Redemptions over time (last 90 days)</div>
                <div className="text-[11px] text-muted-foreground">
                  {summary?.firstRedeemedAt ? `First ${formatDate(summary.firstRedeemedAt)}` : ""}
                  {summary?.lastRedeemedAt ? ` · Last ${formatDate(summary.lastRedeemedAt)}` : ""}
                </div>
              </div>
              {series.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  No redemptions yet.
                </div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <RTooltip />
                      <Line
                        type="monotone"
                        dataKey="redemptions"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="discount"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="text-sm font-medium">
                  Recent redemptions{recent.length === 100 ? " (latest 100)" : ""}
                </div>
                <Button size="sm" variant="outline" onClick={downloadCsv}>
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
                </Button>
              </div>
              {recent.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  No redemptions to show.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/20">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">When</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rider</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Trip</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Fare</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => {
                      const name = `${r.riderFirstName ?? ""} ${r.riderLastName ?? ""}`.trim();
                      return (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.redeemedAt)}</td>
                          <td className="px-3 py-2">
                            <div>{name || <span className="text-muted-foreground">—</span>}</div>
                            {r.riderPhone && (
                              <div className="text-[10px] text-muted-foreground font-mono">{r.riderPhone}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="line-clamp-1">{r.pickupLabel ?? "—"}</div>
                            <div className="line-clamp-1 text-muted-foreground">→ {r.dropoffLabel ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.finalAmount != null ? r.finalAmount.toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-700 font-medium">
                            -{r.discountAmount.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
