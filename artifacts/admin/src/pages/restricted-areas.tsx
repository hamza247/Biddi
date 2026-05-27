import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useMemo, useState } from "react";
import { Plus, Trash2, ShieldOff, X, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge,
  sortRows,
  useSort,
} from "@/components/admin";
import { toast } from "@/hooks/use-toast";
import type { GeoFenceLocation } from "@/lib/geo-fence";

interface RestrictedArea {
  id: string;
  serviceAreaId: string;
  serviceAreaName: string | null;
  restrictArea: "pickup" | "dropoff";
  restrictType: "disallowed";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const RESTRICT_AREA_LABELS: Record<string, string> = {
  pickup: "Pick Up",
  dropoff: "Drop Off",
};

const RESTRICT_TYPE_LABELS: Record<string, string> = {
  disallowed: "Disallowed",
};

const EMPTY_FORM = {
  serviceAreaId: "",
  restrictArea: "pickup" as "pickup" | "dropoff",
  restrictType: "disallowed" as "disallowed",
  active: true,
};

const PAGE_SIZE = 20;

export default function RestrictedAreasPage() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [restrictArea, setRestrictArea] = useState<"all" | "pickup" | "dropoff">("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"serviceAreaName" | "restrictArea">({
    key: "serviceAreaName",
    direction: "asc",
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "restricted-areas"],
    queryFn: () => api<{ restrictedAreas: RestrictedArea[] }>("/admin/restricted-areas"),
  });

  const { data: serviceAreasData } = useQuery({
    queryKey: ["admin", "geo-fence-locations", "service_area", "all", "all", ""],
    queryFn: () =>
      api<{ serviceAreas: GeoFenceLocation[] }>("/admin/service-areas?type=service_area"),
  });
  const serviceAreas = serviceAreasData?.serviceAreas ?? [];

  const create = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api("/admin/restricted-areas", { method: "POST", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "restricted-areas"] });
      toast({ title: "Restricted area added" });
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
    },
    onError: () => toast({ title: "Failed to add restricted area", variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: typeof EMPTY_FORM }) =>
      api(`/admin/restricted-areas/${id}`, { method: "PATCH", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "restricted-areas"] });
      toast({ title: "Restricted area updated" });
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      setEditingId(null);
    },
    onError: () => toast({ title: "Failed to update restricted area", variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/restricted-areas/${id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "restricted-areas"] }),
    onError: () => toast({ title: "Could not update status", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/restricted-areas/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "restricted-areas"] });
      toast({ title: "Restricted area deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleEdit = (area: RestrictedArea) => {
    setForm({
      serviceAreaId: area.serviceAreaId,
      restrictArea: area.restrictArea,
      restrictType: area.restrictType,
      active: area.active,
    });
    setEditingId(area.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.serviceAreaId) {
      toast({ title: "Please select a Geo Location Area", variant: "destructive" });
      return;
    }
    if (editingId) {
      update.mutate({ id: editingId, payload: form });
    } else {
      create.mutate(form);
    }
  };

  const handleCancel = () => {
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
    setEditingId(null);
  };

  const all = data?.restrictedAreas ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((a) => {
      if (restrictArea !== "all" && a.restrictArea !== restrictArea) return false;
      if (status === "active" && !a.active) return false;
      if (status === "inactive" && a.active) return false;
      if (q && !(a.serviceAreaName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, restrictArea, status]);
  const sorted = useMemo(
    () => sortRows(filtered, sort, (r, k) => r[k] ?? ""),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || restrictArea !== "all" || status !== "all";
  const resetFilters = () => { setSearch(""); setRestrictArea("all"); setStatus("all"); setPage(1); };
  const isSaving = create.isPending || update.isPending;
  const deleting = all.find((a) => a.id === confirmDeleteId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Restricted Areas</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Define zones where pickups or drop-offs are not allowed.
          </p>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)} data-testid="button-add-restricted-area">
            <Plus className="w-4 h-4 mr-1.5" /> Add Restricted Area
          </Button>
        )}
      </div>

      {showForm && (
        <div className="rounded-lg border bg-card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">
              {editingId ? "Edit Restricted Area" : "Add Restricted Area"}
            </h2>
            <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
              <Label className="text-xs">Geo Location Area *</Label>
              <div className="flex gap-2 mt-1">
                <Select
                  value={form.serviceAreaId}
                  onValueChange={(v) => setForm((f) => ({ ...f, serviceAreaId: v }))}
                >
                  <SelectTrigger className="flex-1" data-testid="select-service-area">
                    <SelectValue placeholder="Select a location…" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceAreas.map((sa) => (
                      <SelectItem key={sa.id} value={sa.id}>
                        {sa.name}
                      </SelectItem>
                    ))}
                    {serviceAreas.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        No locations found
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLocation("/geo-fence/locations/new")}
                  data-testid="button-enter-new-location"
                >
                  Enter New Location
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs">Restrict Area *</Label>
              <Select
                value={form.restrictArea}
                onValueChange={(v) => setForm((f) => ({ ...f, restrictArea: v as typeof form.restrictArea }))}
              >
                <SelectTrigger className="mt-1" data-testid="select-restrict-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pickup">Pick Up</SelectItem>
                  <SelectItem value="dropoff">Drop Off</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Restrict Type *</Label>
              <Select
                value={form.restrictType}
                onValueChange={(v) => setForm((f) => ({ ...f, restrictType: v as typeof form.restrictType }))}
              >
                <SelectTrigger className="mt-1" data-testid="select-restrict-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disallowed">Disallowed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Status</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                data-testid="switch-form-active"
              />
              <span className="text-xs text-muted-foreground">{form.active ? "ON" : "OFF"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSubmit}
                disabled={isSaving}
                size="sm"
                data-testid="button-submit-restricted-area"
              >
                {isSaving ? "Saving…" : editingId ? "Save Changes" : "Add Area"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} data-testid="button-cancel-form">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by location name…"
          className="sm:w-72"
        />
        <Select value={restrictArea} onValueChange={(v) => { setRestrictArea(v as typeof restrictArea); setPage(1); }}>
          <SelectTrigger className="sm:w-[160px] h-9"><SelectValue placeholder="Restrict area" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pickup">Pick Up</SelectItem>
            <SelectItem value="dropoff">Drop Off</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
          <SelectTrigger className="sm:w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columnCount={5}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={ShieldOff}
            title={hasFilters ? "No restricted areas match" : "No restricted areas configured"}
            description={
              hasFilters
                ? "Adjust your filters or clear them to see everything."
                : 'Click "Add Restricted Area" to define pickup or drop-off restrictions.'
            }
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="serviceAreaName" sort={sort} onSortChange={setSort} defaultDirection="asc">Geo Location</SortableHeader>
            <SortableHeader sortKey="restrictArea" sort={sort} onSortChange={setSort} defaultDirection="asc">Restrict Area</SortableHeader>
            <TableHead>Restrict Type</TableHead>
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
            itemLabel="restricted areas"
          />
        }
      >
        {paged.map((a) => (
          <TableRow
            key={a.id}
            className={editingId === a.id ? "bg-muted/30" : undefined}
            data-testid={`row-restricted-area-${a.id}`}
          >
            <TableCell className="font-medium">
              {a.serviceAreaName ?? <span className="text-muted-foreground italic">Unknown</span>}
            </TableCell>
            <TableCell>
              <StatusBadge variant="warning">
                {RESTRICT_AREA_LABELS[a.restrictArea] ?? a.restrictArea}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <StatusBadge variant="danger">
                {RESTRICT_TYPE_LABELS[a.restrictType] ?? a.restrictType}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Switch
                  checked={a.active}
                  onCheckedChange={(v) => toggle.mutate({ id: a.id, active: v })}
                  data-testid={`switch-status-${a.id}`}
                />
                <StatusBadge variant={a.active ? "success" : "neutral"}>
                  {a.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleEdit(a)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  data-testid={`button-edit-${a.id}`}
                  aria-label="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(a.id)}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  data-testid={`button-delete-${a.id}`}
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Delete this restricted area?"
        description={
          deleting
            ? `The "${deleting.serviceAreaName ?? "Unknown"}" ${RESTRICT_AREA_LABELS[deleting.restrictArea]?.toLowerCase() ?? deleting.restrictArea} restriction will be removed immediately.`
            : "The restriction will be removed immediately. This cannot be undone."
        }
        confirmLabel="Delete restriction"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />
    </div>
  );
}
