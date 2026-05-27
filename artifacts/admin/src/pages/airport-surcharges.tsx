import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Plane } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  ConfirmDialog,
  DataTable,
  DataTablePagination,
  EmptyState,
  StatusBadge,
} from "@/components/admin";
import { toast } from "@/hooks/use-toast";
import { CircleMapEditor, type CircleValue } from "@/components/CircleMapEditor";

interface AirportLocation {
  id: string;
  name: string;
  country: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  active: boolean;
}

interface VehicleTypeRow {
  id: string;
  name: string;
  active: boolean;
}

type SurchargeType = "multiplier" | "fixed";

interface AirportSurcharge {
  id: string;
  airportLocationId: string;
  airportName: string | null;
  vehicleTypeId: string;
  vehicleTypeName: string | null;
  surchargeType: SurchargeType;
  pickupSurchargeValue: number;
  dropoffSurchargeValue: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  airportLocationId: string;
  vehicleTypeId: string;
  surchargeType: SurchargeType;
  pickupSurchargeValue: string;
  dropoffSurchargeValue: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  airportLocationId: "",
  vehicleTypeId: "",
  surchargeType: "multiplier",
  pickupSurchargeValue: "1",
  dropoffSurchargeValue: "1",
  active: true,
};

interface AirportFormState {
  name: string;
  country: string;
  centerLat: string;
  centerLng: string;
  radiusM: string;
  active: boolean;
}

const EMPTY_AIRPORT_FORM: AirportFormState = {
  name: "",
  country: "Morocco",
  centerLat: "",
  centerLng: "",
  radiusM: "2000",
  active: true,
};

const PAGE_SIZE = 20;

export default function AirportSurchargesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AirportSurcharge | null>(null);
  const [creating, setCreating] = useState(false);
  const [airportModalOpen, setAirportModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [airportForm, setAirportForm] = useState<AirportFormState>(EMPTY_AIRPORT_FORM);
  const [airportZoneValue, setAirportZoneValue] = useState<CircleValue | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "airport-surcharges"],
    queryFn: () => api<{ surcharges: AirportSurcharge[] }>("/admin/airport-surcharges"),
  });

  const { data: airportsData } = useQuery({
    queryKey: ["admin", "airport-locations"],
    queryFn: () => api<{ airports: AirportLocation[] }>("/admin/airport-locations"),
  });
  // Inactive airport zones can't accept new surcharge rules — they'd never
  // match at fare time anyway. Operators can re-activate from the geo-fence
  // location admin if they need to revive one.
  const airports = (airportsData?.airports ?? []).filter((a) => a.active);

  const { data: vehicleTypesData } = useQuery({
    queryKey: ["admin", "vehicle-types"],
    queryFn: () => api<{ vehicleTypes: VehicleTypeRow[] }>("/admin/vehicle-types"),
  });

  // Read the Google Maps web key from /config/public so the map picker
  // shows the standard Google roadmap; the admin settings endpoint
  // redacts secret values, so this is the only path that returns the
  // real key.
  interface PublicConfigResponse {
    googleMapsApiKeyWeb?: string | null;
  }
  const { data: publicConfig, isLoading: publicConfigLoading } = useQuery({
    queryKey: ["config-public"],
    queryFn: () => api<PublicConfigResponse>("/config/public"),
  });
  const mapSettings = { gmapsKey: publicConfig?.googleMapsApiKeyWeb || null };
  // Only offer active vehicle types when picking a surcharge target — disabled
  // categories shouldn't accumulate new pricing rules.
  const vehicleTypes = (vehicleTypesData?.vehicleTypes ?? []).filter((vt) => vt.active);

  const create = useMutation({
    mutationFn: (payload: Omit<AirportSurcharge, "id" | "airportName" | "vehicleTypeName" | "createdAt" | "updatedAt">) =>
      api("/admin/airport-surcharges", { method: "POST", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "airport-surcharges"] });
      toast({ title: "Surcharge created", variant: "success" });
      setCreating(false);
      setForm(EMPTY_FORM);
    },
    onError: (err: unknown) => {
      const e = err as ApiError;
      toast({
        title: e.status === 409 ? "Duplicate surcharge" : "Could not create surcharge",
        description:
          e.status === 409
            ? "A surcharge for this airport and vehicle type already exists."
            : e.message,
        variant: "destructive",
      });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AirportSurcharge> }) =>
      api(`/admin/airport-surcharges/${id}`, { method: "PATCH", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "airport-surcharges"] });
      toast({ title: "Surcharge updated", variant: "success" });
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (err: unknown) =>
      toast({ title: "Update failed", description: (err as Error).message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/airport-surcharges/${id}/status`, { method: "PATCH", json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "airport-surcharges"] }),
    onError: () => toast({ title: "Could not update status", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/airport-surcharges/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "airport-surcharges"] });
      toast({ title: "Surcharge deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const createAirport = useMutation({
    mutationFn: (payload: { name: string; country: string; centerLat: number; centerLng: number; radiusM: number; active: boolean }) =>
      api<{ airport: AirportLocation }>("/admin/airport-locations", { method: "POST", json: payload }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["admin", "airport-locations"] });
      toast({ title: "Airport added", variant: "success" });
      // Pre-select the just-created airport in the parent form so the
      // operator's flow is uninterrupted.
      setForm((f) => ({ ...f, airportLocationId: resp.airport.id }));
      setAirportModalOpen(false);
      setAirportForm(EMPTY_AIRPORT_FORM);
      setAirportZoneValue(null);
    },
    onError: (err: unknown) =>
      toast({ title: "Could not add airport", description: (err as Error).message, variant: "destructive" }),
  });

  const all = data?.surcharges ?? [];
  const total = all.length;
  const paged = useMemo(
    () => all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [all, page],
  );

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (row: AirportSurcharge) => {
    setForm({
      airportLocationId: row.airportLocationId,
      vehicleTypeId: row.vehicleTypeId,
      surchargeType: row.surchargeType,
      pickupSurchargeValue: String(row.pickupSurchargeValue),
      dropoffSurchargeValue: String(row.dropoffSurchargeValue),
      active: row.active,
    });
    setEditing(row);
    setCreating(false);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const submit = () => {
    const pickup = parseFloat(form.pickupSurchargeValue);
    const dropoff = parseFloat(form.dropoffSurchargeValue);
    if (!form.airportLocationId) {
      toast({ title: "Pick an airport location", variant: "destructive" });
      return;
    }
    if (!form.vehicleTypeId) {
      toast({ title: "Pick a vehicle type", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(pickup) || pickup <= 0 || !Number.isFinite(dropoff) || dropoff <= 0) {
      toast({ title: "Surcharge values must be greater than zero", variant: "destructive" });
      return;
    }
    const payload = {
      airportLocationId: form.airportLocationId,
      vehicleTypeId: form.vehicleTypeId,
      surchargeType: form.surchargeType,
      pickupSurchargeValue: pickup,
      dropoffSurchargeValue: dropoff,
      active: form.active,
    };
    if (editing) update.mutate({ id: editing.id, payload });
    else create.mutate(payload);
  };

  const submitAirport = () => {
    const lat = parseFloat(airportForm.centerLat);
    const lng = parseFloat(airportForm.centerLng);
    const radius = parseInt(airportForm.radiusM, 10);
    if (!airportForm.name.trim()) {
      toast({ title: "Airport name is required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      toast({ title: "Latitude must be between -90 and 90", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      toast({ title: "Longitude must be between -180 and 180", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      toast({ title: "Radius must be a positive number of meters", variant: "destructive" });
      return;
    }
    createAirport.mutate({
      name: airportForm.name.trim(),
      country: airportForm.country.trim() || "Morocco",
      centerLat: lat,
      centerLng: lng,
      radiusM: radius,
      active: airportForm.active,
    });
  };

  const dialogOpen = creating || editing != null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Airport Surcharge</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Configure pickup and dropoff surcharges for each airport zone and vehicle type.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-add-surcharge">
          <Plus className="w-4 h-4 mr-1.5" /> Add Surcharge
        </Button>
      </div>

      <DataTable
        columnCount={7}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={Plane}
            title="No airport surcharges yet"
            description="Add a surcharge for an airport zone and vehicle type to get started."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1.5" />Add Surcharge
              </Button>
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Airport</TableHead>
            <TableHead>Vehicle Type</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Pickup</TableHead>
            <TableHead className="text-right">Dropoff</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[88px]">Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="surcharges"
          />
        }
      >
        {paged.map((row) => (
          <TableRow key={row.id} data-testid={`row-surcharge-${row.id}`}>
            <TableCell className="font-medium">{row.airportName ?? "—"}</TableCell>
            <TableCell>{row.vehicleTypeName ?? "—"}</TableCell>
            <TableCell className="capitalize">{row.surchargeType}</TableCell>
            <TableCell className="text-right text-sm tabular-nums">
              {row.pickupSurchargeValue}
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">
              {row.dropoffSurchargeValue}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Switch
                  checked={row.active}
                  onCheckedChange={(v) => toggle.mutate({ id: row.id, active: v })}
                  data-testid={`switch-status-${row.id}`}
                />
                <StatusBadge variant={row.active ? "success" : "neutral"}>
                  {row.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => openEdit(row)}
                  data-testid={`button-edit-${row.id}`}
                  aria-label="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(row.id)}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  data-testid={`button-delete-${row.id}`}
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Airport Surcharge" : "Add Airport Surcharge"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Airport Location</Label>
              <div className="flex gap-2">
                <Select
                  value={form.airportLocationId}
                  onValueChange={(v) => setForm((f) => ({ ...f, airportLocationId: v }))}
                >
                  <SelectTrigger className="flex-1" data-testid="select-airport">
                    <SelectValue placeholder="Select an airport" />
                  </SelectTrigger>
                  <SelectContent>
                    {airports.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No airports configured yet.
                      </div>
                    )}
                    {airports.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAirportModalOpen(true)}
                  data-testid="button-add-airport"
                >
                  <Plus className="w-4 h-4 mr-1" /> New
                </Button>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Vehicle Type</Label>
              <Select
                value={form.vehicleTypeId}
                onValueChange={(v) => setForm((f) => ({ ...f, vehicleTypeId: v }))}
              >
                <SelectTrigger data-testid="select-vehicle-type">
                  <SelectValue placeholder="Select a vehicle type" />
                </SelectTrigger>
                <SelectContent>
                  {vehicleTypes.map((vt) => (
                    <SelectItem key={vt.id} value={vt.id}>
                      {vt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1.5 block">Surcharge Type</Label>
              <Select
                value={form.surchargeType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, surchargeType: v as SurchargeType }))
                }
              >
                <SelectTrigger data-testid="select-surcharge-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiplier">Multiplier (× subtotal)</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">Pickup Surcharge</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.pickupSurchargeValue}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pickupSurchargeValue: e.target.value }))
                  }
                  data-testid="input-pickup-value"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Dropoff Surcharge</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dropoffSurchargeValue}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dropoffSurchargeValue: e.target.value }))
                  }
                  data-testid="input-dropoff-value"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter <strong>1</strong> if you do not want to add a surcharge for that side.
              Must be greater than 0. For multiplier rules, use 1 for no change; for fixed rules, enter the extra amount to add.
            </p>

            <div className="flex items-center justify-between border-t pt-3">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Inactive rules are skipped at fare time.</p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                data-testid="switch-active"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={create.isPending || update.isPending}
              data-testid="button-save"
            >
              {create.isPending || update.isPending ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={airportModalOpen} onOpenChange={setAirportModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add Airport Location</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-3">
              <div>
                <Label className="mb-1.5 block">Name</Label>
                <Input
                  value={airportForm.name}
                  onChange={(e) => setAirportForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Casablanca Mohammed V Airport"
                  data-testid="input-airport-name"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Country</Label>
                <Input
                  value={airportForm.country}
                  onChange={(e) => setAirportForm((f) => ({ ...f, country: e.target.value }))}
                  data-testid="input-airport-country"
                />
              </div>
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">Airport zone</div>
                {airportZoneValue ? (
                  <>
                    <div>
                      Center: <span className="tabular-nums">{airportZoneValue.centerLat.toFixed(6)}, {airportZoneValue.centerLng.toFixed(6)}</span>
                    </div>
                    <div>
                      Radius: <span className="tabular-nums">{airportZoneValue.radiusM.toLocaleString()} m</span>
                    </div>
                  </>
                ) : (
                  <div>
                    Use the circle tool on the map to drop the airport center and drag the edge to set the radius.
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t pt-3">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Inactive zones are hidden from new surcharges and skipped at fare time.</p>
              </div>
              <Switch
                checked={airportForm.active}
                onCheckedChange={(v) => setAirportForm((f) => ({ ...f, active: v }))}
                data-testid="switch-airport-active"
              />
            </div>
            </div>
            <div className="min-h-[360px]">
              {publicConfig ? (
                <CircleMapEditor
                  value={airportZoneValue}
                  onChange={(v) => {
                    setAirportZoneValue(v);
                    setAirportForm((f) => ({
                      ...f,
                      centerLat: v ? String(v.centerLat) : "",
                      centerLng: v ? String(v.centerLng) : "",
                      radiusM: v ? String(v.radiusM) : "",
                    }));
                  }}
                  settings={mapSettings}
                />
              ) : (
                <div
                  className="w-full h-full min-h-[360px] rounded-lg border bg-muted flex items-center justify-center text-sm text-muted-foreground"
                  data-testid="circle-map-loading"
                >
                  {publicConfigLoading ? "Loading map…" : "Map unavailable"}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAirportModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitAirport}
              disabled={createAirport.isPending}
              data-testid="button-save-airport"
            >
              {createAirport.isPending ? "Saving…" : "Add airport"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Delete this surcharge?"
        description="The surcharge will stop being applied immediately. This cannot be undone."
        confirmLabel="Delete surcharge"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />
    </div>
  );
}
