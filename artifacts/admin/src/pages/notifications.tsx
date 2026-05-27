import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Trash2, Bell, BatteryFull, Wifi, Signal } from "lucide-react";

interface Template {
  id: string;
  type: "sms" | "email" | "push";
  key: string;
  title: string;
  body: string;
  active: boolean;
  createdAt: string;
}

const EMPTY_FORM = { type: "push" as const, key: "", title: "", body: "", active: true };
const PAGE_SIZE = 20;

const TYPE_VARIANT: Record<string, Parameters<typeof StatusBadge>[0]["variant"]> = {
  sms: "info",
  email: "accent",
  push: "success",
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | Template["type"]>("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"key" | "title" | "createdAt">({
    key: "createdAt",
    direction: "desc",
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "notification-templates"],
    queryFn: () => api<{ templates: Template[] }>("/admin/notification-templates"),
  });

  const save = useMutation({
    mutationFn: (payload: typeof form) =>
      editing
        ? api(`/admin/notification-templates/${editing.id}`, { method: "PATCH", json: payload })
        : api("/admin/notification-templates", { method: "POST", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] });
      toast({ title: editing ? "Template updated" : "Template created" });
      setOpen(false);
    },
    onError: () => toast({ title: "Error saving template", variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/notification-templates/${id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] });
    },
    onError: () => toast({ title: "Error updating template", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/notification-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] });
      toast({ title: "Template deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setOpen(true); };
  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({ type: t.type as typeof EMPTY_FORM.type, key: t.key, title: t.title, body: t.body, active: t.active });
    setOpen(true);
  };

  const all = data?.templates ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (status === "active" && !t.active) return false;
      if (status === "inactive" && t.active) return false;
      if (q && !`${t.key} ${t.title} ${t.body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, type, status]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (row, key) => {
        if (key === "createdAt") return new Date(row.createdAt);
        return row[key];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasFilters = search !== "" || type !== "all" || status !== "all";
  const resetFilters = () => { setSearch(""); setType("all"); setStatus("all"); setPage(1); };
  const deleting = all.find((t) => t.id === confirmDeleteId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Notification Templates</h1>
          <p className="text-muted-foreground text-sm mt-0.5">SMS, email, and push notification templates</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Template
        </Button>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by key, title, or body…"
          className="sm:w-72"
        />
        <Select value={type} onValueChange={(v) => { setType(v as typeof type); setPage(1); }}>
          <SelectTrigger className="sm:w-[140px] h-9"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="push">Push</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="email">Email</SelectItem>
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
        columnCount={6}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={Bell}
            title={hasFilters ? "No templates match your filters" : "No templates yet"}
            description={
              hasFilters
                ? "Try clearing filters or searching for a different keyword."
                : "Create SMS, email, and push notification templates to send to your users."
            }
            action={!hasFilters ? <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" />Add template</Button> : undefined}
          />
        }
        header={
          <TableRow>
            <TableHead>Type</TableHead>
            <SortableHeader sortKey="key" sort={sort} onSortChange={setSort} defaultDirection="asc">Key</SortableHeader>
            <SortableHeader sortKey="title" sort={sort} onSortChange={setSort} defaultDirection="asc">Title</SortableHeader>
            <TableHead>Preview</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[88px]">Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="templates"
          />
        }
      >
        {paged.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <StatusBadge variant={TYPE_VARIANT[t.type] ?? "neutral"} className="uppercase">
                {t.type}
              </StatusBadge>
            </TableCell>
            <TableCell className="font-mono text-xs">{t.key}</TableCell>
            <TableCell className="font-medium text-xs">{t.title}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{t.body}</TableCell>
            <TableCell>
              <Switch
                checked={t.active}
                onCheckedChange={(checked) => toggle.mutate({ id: t.id, active: checked })}
                disabled={toggle.isPending}
              />
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(t)} className="h-7 w-7 p-0" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(t.id)}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
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
        title="Delete this template?"
        description={
          deleting
            ? `"${deleting.title}" will stop being sent to users. This cannot be undone.`
            : "This template will stop being sent. This cannot be undone."
        }
        confirmLabel="Delete template"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "New Notification Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="push">Push</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Key (identifier) *</Label>
              <Input value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} placeholder="e.g. ride_accepted" className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="mt-1" />
              <p className="mt-2 text-xs text-muted-foreground">
                Use these variables:{" "}
                {["{{firstName}}", "{{lastName}}", "{{fullName}}", "{{phone}}"].map((v) => (
                  <code key={v} className="mx-0.5 rounded bg-muted px-1 py-0.5 font-mono">{v}</code>
                ))}
              </p>
            </div>
            <div>
              <Label>Body *</Label>
              <Textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} className="mt-1" rows={3} placeholder="Your ride has been accepted…" />
              <p className="mt-2 text-xs text-muted-foreground">
                Use these variables in the title or body:{" "}
                {["{{firstName}}", "{{lastName}}", "{{fullName}}", "{{phone}}", "{{city}}", "{{rating}}", "{{trips}}", "{{pickup}}", "{{dropoff}}"].map((v) => (
                  <code key={v} className="mx-0.5 rounded bg-muted px-1 py-0.5 font-mono">{v}</code>
                ))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                <code className="font-mono">&#123;&#123;pickup&#125;&#125;</code> and{" "}
                <code className="font-mono">&#123;&#123;dropoff&#125;&#125;</code> are available for ride request templates (e.g. <code className="font-mono">driver_ride_request</code>).
              </p>
            </div>

            {form.type === "push" && (
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Preview</Label>
                <div className="mt-2 rounded-2xl bg-gray-900 p-3 shadow-inner">
                  <div className="flex items-center justify-between mb-3 px-0.5">
                    <span className="text-white text-xs font-medium">9:41</span>
                    <div className="flex items-center gap-1 text-white">
                      <Signal className="w-3 h-3" />
                      <Wifi className="w-3 h-3" />
                      <BatteryFull className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-3 flex gap-2.5">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
                      <Bell className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className="text-white text-xs font-semibold truncate">
                          {form.title || <span className="opacity-40 italic">Notification title</span>}
                        </span>
                        <span className="text-white/50 text-xs flex-shrink-0">now</span>
                      </div>
                      <p className="text-white/80 text-xs leading-snug line-clamp-2">
                        {form.body || <span className="opacity-40 italic">Notification body…</span>}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3"><Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.key || !form.title || !form.body}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
