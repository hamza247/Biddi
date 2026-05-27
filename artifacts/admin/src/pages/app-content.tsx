import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ImageIcon, MessageSquareWarning } from "lucide-react";

interface Banner {
  id: string;
  title: string;
  imageUrl: string | null;
  placement: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
}

interface CancelReason {
  id: string;
  text: string;
  appliesTo: string;
  active: boolean;
}

const EMPTY_BANNER = { title: "", imageUrl: "", placement: "rider_home" as const, active: true, displayOrder: 0 };
const EMPTY_REASON = { text: "", appliesTo: "both" as const, active: true };
const PAGE_SIZE = 20;

function BannersTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [form, setForm] = useState({ ...EMPTY_BANNER });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [placement, setPlacement] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"title" | "displayOrder" | "createdAt">({
    key: "displayOrder",
    direction: "asc",
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "content", "banners"],
    queryFn: () => api<{ banners: Banner[] }>("/admin/content/banners"),
  });

  const save = useMutation({
    mutationFn: (payload: typeof form) =>
      editing
        ? api(`/admin/content/banners/${editing.id}`, { method: "PATCH", json: payload })
        : api("/admin/content/banners", { method: "POST", json: payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "content", "banners"] }); toast({ title: "Banner saved" }); setOpen(false); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/content/banners/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "content", "banners"] });
      toast({ title: "Banner deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_BANNER }); setOpen(true); };
  const openEdit = (b: Banner) => {
    setEditing(b);
    setForm({ title: b.title, imageUrl: b.imageUrl ?? "", placement: b.placement as any, active: b.active, displayOrder: b.displayOrder });
    setOpen(true);
  };

  const all = data?.banners ?? [];
  const placements = useMemo(
    () => Array.from(new Set(all.map((b) => b.placement))).sort(),
    [all],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((b) => {
      if (placement !== "all" && b.placement !== placement) return false;
      if (status === "active" && !b.active) return false;
      if (status === "inactive" && b.active) return false;
      if (q && !b.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, placement, status, search]);
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (r, k) => {
        if (k === "createdAt") return new Date(r.createdAt);
        return r[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || placement !== "all" || status !== "all";
  const resetFilters = () => { setSearch(""); setPlacement("all"); setStatus("all"); setPage(1); };
  const deleting = all.find((b) => b.id === confirmDeleteId);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">Promotional banners shown in the app</p>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" /> Add Banner</Button>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search banners…"
          className="sm:w-72"
        />
        <Select value={placement} onValueChange={(v) => { setPlacement(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[160px] h-9"><SelectValue placeholder="Placement" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All placements</SelectItem>
            {placements.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">{p.replace(/_/g, " ")}</SelectItem>
            ))}
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
            icon={ImageIcon}
            title={hasFilters ? "No banners match" : "No banners yet"}
            description={
              hasFilters
                ? "Try clearing filters."
                : "Add a banner to show promotions in your rider or driver apps."
            }
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="title" sort={sort} onSortChange={setSort} defaultDirection="asc">Title</SortableHeader>
            <TableHead>Placement</TableHead>
            <SortableHeader sortKey="displayOrder" sort={sort} onSortChange={setSort} defaultDirection="asc">Order</SortableHeader>
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
            itemLabel="banners"
          />
        }
      >
        {paged.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-medium">{b.title}</TableCell>
            <TableCell className="text-xs capitalize">{b.placement.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-xs">{b.displayOrder}</TableCell>
            <TableCell>
              <StatusBadge variant={b.active ? "success" : "neutral"}>
                {b.active ? "Active" : "Inactive"}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(b)} className="h-7 w-7 p-0" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(b.id)} className="h-7 w-7 p-0 text-red-500 hover:text-red-600" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Delete this banner?"
        description={
          deleting
            ? `"${deleting.title}" will be removed and stop appearing in the app immediately.`
            : "The banner will be removed immediately. This cannot be undone."
        }
        confirmLabel="Delete banner"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Banner" : "New Banner"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="mt-1" /></div>
            <div><Label>Image URL</Label><Input value={form.imageUrl ?? ""} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" className="mt-1" /></div>
            <div>
              <Label>Placement</Label>
              <Select value={form.placement} onValueChange={(v) => setForm((f) => ({ ...f, placement: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rider_home">Rider Home</SelectItem>
                  <SelectItem value="driver_home">Driver Home</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3"><Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.title}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CancellationReasonsTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CancelReason | null>(null);
  const [form, setForm] = useState({ ...EMPTY_REASON });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [appliesTo, setAppliesTo] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "content", "cancellation-reasons"],
    queryFn: () => api<{ reasons: CancelReason[] }>("/admin/content/cancellation-reasons"),
  });

  const save = useMutation({
    mutationFn: (payload: typeof form) =>
      editing
        ? api(`/admin/content/cancellation-reasons/${editing.id}`, { method: "PATCH", json: payload })
        : api("/admin/content/cancellation-reasons", { method: "POST", json: payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "content", "cancellation-reasons"] }); toast({ title: "Reason saved" }); setOpen(false); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/content/cancellation-reasons/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "content", "cancellation-reasons"] });
      toast({ title: "Reason deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_REASON }); setOpen(true); };
  const openEdit = (r: CancelReason) => { setEditing(r); setForm({ text: r.text, appliesTo: r.appliesTo as any, active: r.active }); setOpen(true); };

  const all = data?.reasons ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (appliesTo !== "all" && r.appliesTo !== appliesTo) return false;
      if (status === "active" && !r.active) return false;
      if (status === "inactive" && r.active) return false;
      if (q && !r.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, appliesTo, status]);
  const hasFilters = search !== "" || appliesTo !== "all" || status !== "all";
  const resetFilters = () => { setSearch(""); setAppliesTo("all"); setStatus("all"); };
  const deleting = all.find((r) => r.id === confirmDeleteId);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">Reasons shown to riders and drivers when cancelling</p>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" /> Add Reason</Button>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search reasons…" className="sm:w-72" />
        <Select value={appliesTo} onValueChange={setAppliesTo}>
          <SelectTrigger className="sm:w-[140px] h-9"><SelectValue placeholder="Applies to" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="rider">Rider</SelectItem>
            <SelectItem value="driver">Driver</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
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
            icon={MessageSquareWarning}
            title={hasFilters ? "No reasons match" : "No cancellation reasons yet"}
            description={
              hasFilters
                ? "Try clearing your filters."
                : "Add reasons that riders and drivers can pick when cancelling a ride."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Reason</TableHead>
            <TableHead>Applies To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[88px]">Actions</TableHead>
          </TableRow>
        }
      >
        {filtered.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.text}</TableCell>
            <TableCell className="text-xs capitalize">{r.appliesTo}</TableCell>
            <TableCell>
              <StatusBadge variant={r.active ? "success" : "neutral"}>
                {r.active ? "Active" : "Inactive"}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 p-0" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(r.id)} className="h-7 w-7 p-0 text-red-500 hover:text-red-600" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Delete this cancellation reason?"
        description={
          deleting
            ? `"${deleting.text}" will no longer be shown as a cancellation option.`
            : "This reason will no longer appear in the app."
        }
        confirmLabel="Delete reason"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Reason" : "New Reason"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Reason Text *</Label><Input value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} className="mt-1" /></div>
            <div>
              <Label>Applies To</Label>
              <Select value={form.appliesTo} onValueChange={(v) => setForm((f) => ({ ...f, appliesTo: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rider">Rider</SelectItem>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3"><Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.text}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AppContentPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">App Content</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage in-app content and copy</p>
      </div>
      <Tabs defaultValue="banners">
        <TabsList className="mb-6">
          <TabsTrigger value="banners">Banners</TabsTrigger>
          <TabsTrigger value="cancellation">Cancellation Reasons</TabsTrigger>
        </TabsList>
        <TabsContent value="banners"><BannersTab /></TabsContent>
        <TabsContent value="cancellation"><CancellationReasonsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
