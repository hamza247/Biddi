import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
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
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useRef, useState } from "react";
import { Plus, Pencil, Trash2, Lock, Layers } from "lucide-react";
import {
  DataTable,
  EmptyState,
  StatusBadge,
} from "@/components/admin";

interface AppClass {
  id: string;
  slug: string;
  label: string;
  colorHex: string | null;
  isBuiltIn: boolean;
  vehicleTypeCount: number;
  vehicleTypeNames: string[];
  createdAt: string;
}

interface CreateFormState {
  slug: string;
  label: string;
  colorHex: string;
}

interface EditFormState {
  label: string;
  colorHex: string;
}

const EMPTY_CREATE: CreateFormState = { slug: "", label: "", colorHex: "#6366F1" };

function InlineColorPicker({
  id,
  colorHex,
  onSave,
  saving,
}: {
  id: string;
  colorHex: string | null;
  onSave: (id: string, color: string | null) => void;
  saving: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const current = colorHex ?? "#6366F1";

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        title={colorHex ? `Color: ${colorHex} — click to change` : "No color — click to set"}
        disabled={saving}
        onClick={() => inputRef.current?.click()}
        className="relative w-6 h-6 rounded-full border border-black/15 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-primary/50 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: colorHex ?? "#e5e7eb" }}
      >
        {!colorHex && (
          <span className="absolute inset-0 flex items-center justify-center text-[8px] text-gray-400 font-bold leading-none">?</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="color"
        value={current}
        className="sr-only"
        onChange={(e) => onSave(id, e.target.value)}
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}

export default function AppClassesPage() {
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>({ ...EMPTY_CREATE });

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AppClass | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({ label: "", colorHex: "" });

  const [deleteTarget, setDeleteTarget] = useState<AppClass | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "app-classes"],
    queryFn: () => api<{ appClasses: AppClass[] }>("/admin/app-classes"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateFormState) =>
      api("/admin/app-classes", {
        method: "POST",
        json: {
          slug: payload.slug,
          label: payload.label,
          colorHex: payload.colorHex || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "app-classes"] });
      toast({ title: "Class key created" });
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiError ? err.message : "Please check the form and try again.";
      toast({ title: "Error creating class key", description: msg, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EditFormState }) =>
      api(`/admin/app-classes/${id}`, {
        method: "PATCH",
        json: {
          label: payload.label,
          colorHex: payload.colorHex || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "app-classes"] });
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
      toast({ title: "Class key updated" });
      setEditOpen(false);
      setEditTarget(null);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiError ? err.message : "Please check the form and try again.";
      toast({ title: "Error updating class key", description: msg, variant: "destructive" });
    },
  });

  const [savingColorIds, setSavingColorIds] = useState<Set<string>>(new Set());

  const colorMutation = useMutation({
    mutationFn: ({ id, colorHex }: { id: string; colorHex: string | null }) =>
      api(`/admin/app-classes/${id}`, {
        method: "PATCH",
        json: { colorHex },
      }),
    onMutate: ({ id }) =>
      setSavingColorIds((prev) => new Set(prev).add(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "app-classes"] });
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Failed to save color.";
      toast({ title: "Color not saved", description: msg, variant: "destructive" });
    },
    onSettled: (_data, _err, variables) =>
      setSavingColorIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      }),
  });

  const handleInlineColorSave = (id: string, color: string | null) => {
    colorMutation.mutate({ id, colorHex: color });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/app-classes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "app-classes"] });
      toast({ title: "Class key deleted" });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409 && deleteTarget) {
        const serverTypes = (err.extra?.affectedVehicleTypes as { id: string; name: string }[] | undefined) ?? [];
        const names = serverTypes.map((t) => t.name);
        setDeleteTarget({
          ...deleteTarget,
          vehicleTypeCount: serverTypes.length || deleteTarget.vehicleTypeCount,
          vehicleTypeNames: names.length > 0 ? names : deleteTarget.vehicleTypeNames,
        });
      } else {
        const msg = err instanceof ApiError ? err.message : "Something went wrong.";
        toast({ title: "Cannot delete class key", description: msg, variant: "destructive" });
        setDeleteTarget(null);
      }
    },
  });

  const openEdit = (cls: AppClass) => {
    setEditTarget(cls);
    setEditForm({ label: cls.label, colorHex: cls.colorHex ?? "" });
    setEditOpen(true);
  };

  const slugIsValid = /^[a-z0-9_]+$/.test(createForm.slug);
  const createIsValid =
    createForm.slug.trim().length > 0 &&
    slugIsValid &&
    createForm.label.trim().length > 0;
  const editIsValid = editForm.label.trim().length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Class Keys</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage the class keys used to categorise vehicle types in the app
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Class Key
        </Button>
      </div>

      <DataTable
        columnCount={6}
        isLoading={isLoading}
        empty={
          <EmptyState
            icon={Layers}
            title="No class keys defined yet"
            description="Create a class key to categorise vehicle types."
          />
        }
        header={
          <TableRow>
            <TableHead>Color</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Vehicle Types</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        }
      >
        {(data?.appClasses ?? []).map((cls) => (
          <TableRow key={cls.id}>
            <TableCell>
              <InlineColorPicker
                id={cls.id}
                colorHex={cls.colorHex}
                onSave={handleInlineColorSave}
                saving={savingColorIds.has(cls.id)}
              />
            </TableCell>
            <TableCell className="font-mono font-medium">{cls.slug}</TableCell>
            <TableCell>{cls.label}</TableCell>
            <TableCell>
              {cls.isBuiltIn ? (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  Built-in
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">Custom</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <StatusBadge variant={cls.vehicleTypeCount > 0 ? "info" : "neutral"}>
                {cls.vehicleTypeCount}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEdit(cls)}
                  className="h-7 w-7 p-0"
                  title="Edit label/color"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteTarget(cls)}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  title={cls.isBuiltIn ? "Built-in keys can be deleted when not in use" : "Delete"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Class Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Slug *</Label>
              <Input
                value={createForm.slug}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                  }))
                }
                placeholder="e.g. suv, luxury, electric"
                className="mt-1 font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Lowercase letters, numbers, and underscores only. Cannot be changed after creation.
              </p>
              {createForm.slug.length > 0 && !slugIsValid && (
                <p className="text-[11px] text-destructive mt-1">
                  Only lowercase letters, numbers, and underscores are allowed.
                </p>
              )}
            </div>
            <div>
              <Label>Display Label *</Label>
              <Input
                value={createForm.label}
                onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. SUV, Luxury, Electric"
                className="mt-1"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Color</Label>
                {createForm.colorHex && (
                  <button
                    type="button"
                    onClick={() => setCreateForm((f) => ({ ...f, colorHex: "" }))}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear (no color)
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {createForm.colorHex ? (
                  <input
                    type="color"
                    value={createForm.colorHex}
                    onChange={(e) => setCreateForm((f) => ({ ...f, colorHex: e.target.value }))}
                    className="h-9 w-12 rounded border cursor-pointer p-0.5"
                  />
                ) : (
                  <div className="h-9 w-12 rounded border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                    None
                  </div>
                )}
                <Input
                  value={createForm.colorHex}
                  onChange={(e) => setCreateForm((f) => ({ ...f, colorHex: e.target.value }))}
                  placeholder="Leave blank for no color"
                  className="flex-1 font-mono text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Used for the badge color in the admin panel. Leave blank to show no color.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createIsValid || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Class Key — {editTarget?.slug}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Slug</Label>
              <Input
                value={editTarget?.slug ?? ""}
                disabled
                className="mt-1 font-mono bg-muted"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                The slug cannot be changed after creation.
              </p>
            </div>
            <div>
              <Label>Display Label *</Label>
              <Input
                value={editForm.label}
                onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Ride, Comfort, Moto"
                className="mt-1"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Color</Label>
                {editForm.colorHex && (
                  <button
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, colorHex: "" }))}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear (no color)
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {editForm.colorHex ? (
                  <input
                    type="color"
                    value={editForm.colorHex}
                    onChange={(e) => setEditForm((f) => ({ ...f, colorHex: e.target.value }))}
                    className="h-9 w-12 rounded border cursor-pointer p-0.5"
                  />
                ) : (
                  <div className="h-9 w-12 rounded border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                    None
                  </div>
                )}
                <Input
                  value={editForm.colorHex}
                  onChange={(e) => setEditForm((f) => ({ ...f, colorHex: e.target.value }))}
                  placeholder="Leave blank for no color"
                  className="flex-1 font-mono text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editTarget &&
                editMutation.mutate({ id: editTarget.id, payload: editForm })
              }
              disabled={!editIsValid || editMutation.isPending}
            >
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Class Key</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {deleteTarget && deleteTarget.vehicleTypeCount > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold mb-1">Cannot delete — class key is in use</p>
                <p className="mb-2">
                  The <span className="font-mono font-bold">{deleteTarget.slug}</span> key is
                  currently assigned to{" "}
                  <strong>{deleteTarget.vehicleTypeCount} vehicle type(s)</strong>. Remove it
                  from those types first, then delete this key.
                </p>
                {deleteTarget.vehicleTypeNames.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-amber-700">
                    {deleteTarget.vehicleTypeNames.map((name) => (
                      <li key={name} className="text-xs font-medium">{name}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete the{" "}
                <span className="font-mono font-semibold">{deleteTarget?.slug}</span> class
                key? This action cannot be undone.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            {(!deleteTarget || deleteTarget.vehicleTypeCount === 0) && (
              <Button
                variant="destructive"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
