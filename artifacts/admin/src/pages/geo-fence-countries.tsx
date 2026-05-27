import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Globe } from "lucide-react";
import { api, ApiError } from "@/lib/api";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { countryFlagEmoji, type CountryRow } from "@/lib/geo-fence";

interface FormState {
  name: string;
  isoCode: string;
  active: boolean;
}

const EMPTY: FormState = { name: "", isoCode: "", active: true };
const PAGE_SIZE = 20;

export default function GeoFenceCountriesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CountryRow | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"name" | "isoCode">({ key: "name", direction: "asc" });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => api<{ countries: CountryRow[] }>("/admin/countries"),
  });

  const save = useMutation({
    mutationFn: (payload: FormState) =>
      editing
        ? api(`/admin/countries/${editing.id}`, { method: "PATCH", json: payload })
        : api("/admin/countries", { method: "POST", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "countries"] });
      toast({ title: editing ? "Country updated" : "Country added" });
      setOpen(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError || err instanceof Error ? err.message : "";
      const isDup = message === "duplicate_name";
      toast({
        title: isDup ? "A country with that name already exists" : "Save failed",
        variant: "destructive",
      });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/countries/${id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "countries"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/countries/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "countries"] });
      toast({ title: "Country deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setOpen(true); };
  const openEdit = (c: CountryRow) => {
    setEditing(c);
    setForm({ name: c.name, isoCode: c.isoCode, active: c.active });
    setOpen(true);
  };

  const all = data?.countries ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      if (status === "active" && !c.active) return false;
      if (status === "inactive" && c.active) return false;
      if (q && !`${c.name} ${c.isoCode}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, status]);
  const sorted = useMemo(
    () => sortRows(filtered, sort, (r, k) => r[k]),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || status !== "all";
  const resetFilters = () => { setSearch(""); setStatus("all"); setPage(1); };
  const deleting = all.find((c) => c.id === confirmDeleteId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Countries</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage the list of supported countries used across geo-fence locations.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-add-country">
          <Plus className="w-4 h-4 mr-1.5" /> Add Country
        </Button>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by name or ISO code…"
          className="sm:w-72"
        />
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
        columnCount={4}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={Globe}
            title={hasFilters ? "No countries match" : "No countries added yet"}
            description={
              hasFilters
                ? "Try clearing filters or searching differently."
                : "Add a country to make it available across geo-fence locations."
            }
            action={!hasFilters ? <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" />Add country</Button> : undefined}
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="name" sort={sort} onSortChange={setSort} defaultDirection="asc">Name</SortableHeader>
            <SortableHeader sortKey="isoCode" sort={sort} onSortChange={setSort} defaultDirection="asc">ISO Code</SortableHeader>
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
            itemLabel="countries"
          />
        }
      >
        {paged.map((c) => (
          <TableRow key={c.id} data-testid={`row-country-${c.id}`}>
            <TableCell className="font-medium">
              <span className="inline-flex items-center gap-2">
                <span className="text-base leading-none" aria-hidden="true" data-testid={`flag-country-${c.id}`}>
                  {countryFlagEmoji(c.isoCode)}
                </span>
                <span>{c.name}</span>
              </span>
            </TableCell>
            <TableCell className="text-xs uppercase">{c.isoCode}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.active}
                  onCheckedChange={(v) => toggle.mutate({ id: c.id, active: v })}
                  data-testid={`switch-country-${c.id}`}
                />
                <StatusBadge variant={c.active ? "success" : "neutral"}>
                  {c.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(c)} className="h-7 w-7 p-0" data-testid={`button-edit-country-${c.id}`} aria-label="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(c.id)}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  data-testid={`button-delete-country-${c.id}`}
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
        title={deleting ? `Delete "${deleting.name}"?` : "Delete this country?"}
        description="The country will no longer be available when creating geo-fence locations. Existing locations are not affected."
        confirmLabel="Delete country"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Country" : "New Country"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Morocco"
                className="mt-1"
                data-testid="input-country-name"
              />
            </div>
            <div>
              <Label>ISO Code *</Label>
              <Input
                value={form.isoCode}
                onChange={(e) => setForm((f) => ({ ...f, isoCode: e.target.value.toUpperCase() }))}
                placeholder="e.g. MA"
                className="mt-1 uppercase"
                maxLength={3}
                data-testid="input-country-iso"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                data-testid="switch-country-active"
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate(form)}
              disabled={save.isPending || !form.name || !form.isoCode}
              data-testid="button-save-country"
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
