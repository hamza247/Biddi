import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trophy } from "lucide-react";
import {
  DataTable,
  EmptyState,
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge,
  sortRows,
  useSort,
} from "@/components/admin";

interface RewardLevel {
  id: string;
  name: string;
  minimumTrips: number;
  minimumRating: number;
  maxCancellationRate: number;
  minAcceptanceRate: number;
  rewardAmount: number;
  active: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  name: "", minimumTrips: 0, minimumRating: 4.0,
  maxCancellationRate: 20, minAcceptanceRate: 80, rewardAmount: 0, active: true,
};

const LEVEL_COLORS = ["from-gray-400 to-gray-500", "from-yellow-400 to-amber-500", "from-slate-400 to-slate-600", "from-cyan-400 to-blue-500"];

export default function RewardSettingsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RewardLevel | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reward-levels"],
    queryFn: () => api<{ rewardLevels: RewardLevel[] }>("/admin/reward-levels"),
  });

  const save = useMutation({
    mutationFn: (payload: typeof form) =>
      editing
        ? api(`/admin/reward-levels/${editing.id}`, { method: "PATCH", json: payload })
        : api("/admin/reward-levels", { method: "POST", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reward-levels"] });
      toast({ title: editing ? "Level updated" : "Level created" });
      setOpen(false);
    },
    onError: () => toast({ title: "Error saving level", variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setOpen(true); };
  const openEdit = (l: RewardLevel) => {
    setEditing(l);
    setForm({
      name: l.name, minimumTrips: l.minimumTrips, minimumRating: l.minimumRating,
      maxCancellationRate: l.maxCancellationRate, minAcceptanceRate: l.minAcceptanceRate,
      rewardAmount: l.rewardAmount, active: l.active,
    });
    setOpen(true);
  };

  const F = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));

  const levels = data?.rewardLevels ?? [];

  const [search, setSearch] = useState("");
  const [sort, setSort] = useSort<"name" | "minimumTrips" | "rewardAmount">({
    key: "minimumTrips",
    direction: "asc",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return levels;
    return levels.filter((l) => l.name.toLowerCase().includes(q));
  }, [levels, search]);
  const sorted = useMemo(() => sortRows(filtered, sort, (l, k) => l[k]), [filtered, sort]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Driver Rewards</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Set performance reward tiers for drivers</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Level
        </Button>
      </div>

      {/* Level cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : levels.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {levels.map((l, i) => (
            <div key={l.id} className={`rounded-xl bg-gradient-to-br ${LEVEL_COLORS[i % LEVEL_COLORS.length]} p-4 text-white relative`}>
              <Trophy className="w-6 h-6 mb-2 opacity-80" />
              <div className="font-bold text-lg">{l.name}</div>
              <div className="text-xs opacity-80 mt-0.5">Min {l.minimumTrips} trips</div>
              <div className="mt-3 space-y-1 text-xs opacity-90">
                <div>★ {l.minimumRating} min rating</div>
                <div>✓ {l.minAcceptanceRate}% acceptance</div>
                <div>✗ {l.maxCancellationRate}% max cancel</div>
              </div>
              <div className="mt-3 font-bold">{l.rewardAmount} MAD</div>
              <button
                onClick={() => openEdit(l)}
                className="absolute top-3 right-3 bg-white/20 hover:bg-white/30 rounded-md p-1.5 transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
              {!l.active && (
                <div className="absolute bottom-2 right-2 text-xs bg-black/30 rounded px-1.5 py-0.5">Inactive</div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <FilterBar hasActiveFilters={search !== ""} onClear={() => setSearch("")}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search levels…"
          className="sm:w-72"
        />
      </FilterBar>

      <DataTable
        columnCount={8}
        isLoading={isLoading}
        empty={
          <EmptyState
            icon={Trophy}
            title={search ? "No levels match" : "No reward levels yet"}
            description={search ? "Try a different search." : "Create your first tier above."}
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="name" sort={sort} onSortChange={setSort} defaultDirection="asc">Level</SortableHeader>
            <SortableHeader sortKey="minimumTrips" sort={sort} onSortChange={setSort} className="text-right">Min Trips</SortableHeader>
            <TableHead className="text-right">Min Rating</TableHead>
            <TableHead className="text-right">Max Cancel %</TableHead>
            <TableHead className="text-right">Min Accept %</TableHead>
            <SortableHeader sortKey="rewardAmount" sort={sort} onSortChange={setSort} className="text-right">Reward (MAD)</SortableHeader>
            <TableHead>Status</TableHead>
            <TableHead>Edit</TableHead>
          </TableRow>
        }
      >
        {sorted.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="font-medium">{l.name}</TableCell>
            <TableCell className="text-right">{l.minimumTrips}</TableCell>
            <TableCell className="text-right">{l.minimumRating}</TableCell>
            <TableCell className="text-right">{l.maxCancellationRate}%</TableCell>
            <TableCell className="text-right">{l.minAcceptanceRate}%</TableCell>
            <TableCell className="text-right font-semibold">{l.rewardAmount}</TableCell>
            <TableCell>
              <StatusBadge variant={l.active ? "success" : "neutral"}>
                {l.active ? "Active" : "Inactive"}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost" onClick={() => openEdit(l)} className="h-7 w-7 p-0">
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Reward Level" : "New Reward Level"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>Level Name *</Label>
              <Input value={form.name} onChange={F("name")} placeholder="e.g. Silver" className="mt-1" />
            </div>
            {[
              { key: "minimumTrips" as const, label: "Minimum Trips" },
              { key: "minimumRating" as const, label: "Minimum Rating (0–5)" },
              { key: "maxCancellationRate" as const, label: "Max Cancellation %" },
              { key: "minAcceptanceRate" as const, label: "Min Acceptance %" },
              { key: "rewardAmount" as const, label: "Reward Amount (MAD)" },
            ].map(({ key, label }) => (
              <div key={key}>
                <Label>{label}</Label>
                <Input type="number" value={form[key]} onChange={F(key)} className="mt-1" step="0.1" min="0" />
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
