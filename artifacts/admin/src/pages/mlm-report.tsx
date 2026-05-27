import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Network,
  RefreshCw,
  Search as SearchIcon,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  getAdminGetMlmReportQueryKey,
  getAdminGetMlmReportUserEarningsQueryKey,
  getAdminSearchMlmReportUsersQueryKey,
  useAdminGetMlmReport,
  useAdminGetMlmReportUserEarnings,
  useAdminSearchMlmReportUsers,
  type MlmReportNode,
  type MlmReportResponse,
  type MlmReportRoot,
  type MlmReportSearchUser,
  type MlmReportSummary,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
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
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Filter bar shape
// ---------------------------------------------------------------------------

// Hard-capped server-side at 6 (see MAX_MLM_REPORT_DEPTH on the API). Power
// users can request up to that depth; default mirrors the historical 3-level
// commission window so the page renders the familiar shape out of the box.
const MAX_DEPTH = 6;
const DEFAULT_DEPTH = 3;
const DEPTH_OPTIONS = [3, 4, 5, 6] as const;

type LevelFilter = "all" | "1" | "2" | "3" | "4" | "5" | "6";

interface ReportFilters {
  q: string;
  userType: "all" | "riders" | "drivers";
  status: "all" | "active" | "inactive";
  level: LevelFilter;
  fromDate: string;
  toDate: string;
  minEarnings: string;
}

const DEFAULT_FILTERS: ReportFilters = {
  q: "",
  userType: "all",
  status: "all",
  level: "all",
  fromDate: "",
  toDate: "",
  minEarnings: "",
};

function nodeMatchesFilters(node: MlmReportNode, f: ReportFilters): boolean {
  if (f.userType === "riders" && node.appMode !== "rider") return false;
  if (f.userType === "drivers" && node.appMode !== "driver") return false;
  if (f.status === "active" && !node.isActive) return false;
  if (f.status === "inactive" && node.isActive) return false;
  if (f.level !== "all" && String(node.level) !== f.level) return false;
  if (f.fromDate && new Date(node.joinedAt) < new Date(f.fromDate)) return false;
  if (f.toDate) {
    const end = new Date(f.toDate);
    end.setHours(23, 59, 59, 999);
    if (new Date(node.joinedAt) > end) return false;
  }
  const min = parseFloat(f.minEarnings);
  if (Number.isFinite(min) && node.totalEarnings < min) return false;
  if (f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    const hay = [node.name, node.phone, node.email, node.referralCode]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MlmReportPage() {
  const qc = useQueryClient();
  const [rootUserId, setRootUserId] = useState<string>("");
  const [depth, setDepth] = useState<number>(DEFAULT_DEPTH);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [drillNode, setDrillNode] = useState<MlmReportNode | null>(null);

  const reportQuery = useAdminGetMlmReport(
    rootUserId,
    { depth },
    {
      query: {
        enabled: !!rootUserId,
        queryKey: getAdminGetMlmReportQueryKey(rootUserId, { depth }),
      },
    },
  );

  const refresh = () => {
    if (!rootUserId) return;
    qc.invalidateQueries({
      queryKey: getAdminGetMlmReportQueryKey(rootUserId, { depth }),
    });
  };

  const flatNodes = useMemo<MlmReportNode[]>(() => {
    const acc: MlmReportNode[] = [];
    const walk = (nodes: MlmReportNode[]) => {
      for (const n of nodes) {
        acc.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    if (reportQuery.data?.tree) walk(reportQuery.data.tree);
    return acc;
  }, [reportQuery.data]);

  // Build the parent-name lookup from the FULL downline + the root, not from
  // the filtered rows — otherwise filtering can hide a parent and break the
  // "Referred By" column for matching children.
  const parentNameById = useMemo(() => {
    const m = new Map<string, string>();
    if (reportQuery.data?.root) {
      m.set(reportQuery.data.root.id, reportQuery.data.root.name);
    }
    for (const n of flatNodes) m.set(n.id, n.name);
    return m;
  }, [flatNodes, reportQuery.data?.root]);

  const filteredNodes = useMemo(
    () => flatNodes.filter((n) => nodeMatchesFilters(n, filters)),
    [flatNodes, filters],
  );

  const matchedIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes],
  );

  const hasActive =
    filters.userType !== "all" ||
    filters.status !== "all" ||
    filters.level !== "all" ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.minEarnings ||
    !!filters.q;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Network className="w-5 h-5" /> MLM Referral Report
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Inspect any user or driver's referral network with summary counts,
            an interactive tree, and a searchable detail table. Power users can
            audit up to {MAX_DEPTH} levels deep.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={!rootUserId || reportQuery.isFetching}
          className="gap-1"
        >
          <RefreshCw className={cn("w-4 h-4", reportQuery.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-4 mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Root user
          </Label>
          <RootPicker
            selectedId={rootUserId || null}
            selectedName={reportQuery.data?.root?.name ?? null}
            onSelect={(u) => setRootUserId(u.id)}
          />
        </div>
        <div className="md:w-40">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Tree depth
          </Label>
          <Select
            value={String(depth)}
            onValueChange={(v) => setDepth(Number(v))}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPTH_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} levels{d === DEFAULT_DEPTH ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!rootUserId ? (
        <EmptyState
          icon={Network}
          title="Pick a user to begin"
          description="Search by name, phone, email, or referral code above to load their referral network. Pick a depth (3–6 levels) to control how deep the report drills."
        />
      ) : reportQuery.isLoading ? (
        <ReportSkeleton />
      ) : reportQuery.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive mb-1">
            Couldn't load this report
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            {reportQuery.error instanceof Error
              ? reportQuery.error.message
              : "Something went wrong. Please try again."}
          </p>
          <Button size="sm" variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : reportQuery.data ? (
        <ReportBody
          data={reportQuery.data}
          filters={filters}
          setFilters={setFilters}
          hasActive={hasActive}
          matchedIds={matchedIds}
          filteredNodes={filteredNodes}
          flatNodesCount={flatNodes.length}
          parentNameById={parentNameById}
          onDrillNode={setDrillNode}
        />
      ) : null}

      <EarningsDrillSheet
        node={drillNode}
        onClose={() => setDrillNode(null)}
      />
    </div>
  );
}

function ReportBody({
  data,
  filters,
  setFilters,
  hasActive,
  matchedIds,
  filteredNodes,
  flatNodesCount,
  parentNameById,
  onDrillNode,
}: {
  data: MlmReportResponse;
  filters: ReportFilters;
  setFilters: (f: ReportFilters) => void;
  hasActive: boolean;
  matchedIds: Set<string>;
  filteredNodes: MlmReportNode[];
  flatNodesCount: number;
  parentNameById: Map<string, string>;
  onDrillNode: (node: MlmReportNode) => void;
}) {
  return (
    <>
      <SummaryCards summary={data.summary} />
      <ReportFilterBar
        filters={filters}
        setFilters={setFilters}
        hasActive={hasActive}
        onClear={() => setFilters(DEFAULT_FILTERS)}
      />
      <SectionTitle
        title="Downline tree"
        subtitle={`Up to ${data.depth} ${data.depth === 1 ? "level" : "levels"} deep · expand each card to drill in`}
      />
      <ReferralTree
        root={data.root}
        tree={data.tree}
        matchedIds={matchedIds}
        hasFilters={hasActive}
        onDrillNode={onDrillNode}
      />
      <SectionTitle
        title="Member details"
        subtitle={`${filteredNodes.length} of ${flatNodesCount} downline members${hasActive ? " (filtered)" : ""}`}
        className="mt-8"
      />
      <ReferralReportTable
        rows={filteredNodes}
        parentNameById={parentNameById}
        onDrillNode={onDrillNode}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Root user picker
// ---------------------------------------------------------------------------

function RootPicker({
  selectedId,
  selectedName,
  onSelect,
}: {
  selectedId: string | null;
  selectedName: string | null;
  onSelect: (u: MlmReportSearchUser) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  const search = useAdminSearchMlmReportUsers(
    { q: debounced },
    {
      query: {
        enabled: debounced.length > 0,
        queryKey: getAdminSearchMlmReportUsersQueryKey({ q: debounced }),
      },
    },
  );

  const results = search.data?.results ?? [];

  return (
    <div className="relative mt-1">
      <SearchInput
        value={q}
        onChange={(v) => {
          setQ(v);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Search by name, phone, email, or referral code…"
      />
      {selectedId && !q && (
        <p className="text-xs text-muted-foreground mt-2">
          Currently viewing:{" "}
          <span className="font-medium text-foreground">
            {selectedName ?? selectedId}
          </span>
        </p>
      )}
      {open && debounced.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border bg-popover shadow-md max-h-80 overflow-auto">
          {search.isLoading ? (
            <div className="p-3 text-xs text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No matches.</div>
          ) : (
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(u);
                  setQ("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between gap-3 border-b last:border-0"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {u.phone ?? "—"} · {u.email ?? "no email"}
                    {u.referralCode ? ` · ${u.referralCode}` : ""}
                  </div>
                </div>
                <StatusBadge variant={u.appMode === "driver" ? "info" : "neutral"}>
                  {u.appMode}
                </StatusBadge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

// Per-level color tokens used by both the summary tiles and the tree node
// chips so the eye can match a level across the page. Levels 4–6 share a
// distinct "deep" tone (slate/amber/rose) to make extended audits visually
// stand apart from the standard 3-level commission window.
const LEVEL_TILE_TONES: Record<number, string> = {
  1: "text-blue-600 bg-blue-50 border-blue-200",
  2: "text-emerald-600 bg-emerald-50 border-emerald-200",
  3: "text-orange-600 bg-orange-50 border-orange-200",
  4: "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200",
  5: "text-rose-600 bg-rose-50 border-rose-200",
  6: "text-slate-600 bg-slate-50 border-slate-200",
};

function SummaryCards({ summary }: { summary: MlmReportSummary }) {
  // Drive the level tiles off `levelCounts` so the summary scales with the
  // requested depth instead of being hard-capped at 3.
  const levelTiles = (summary.levelCounts ?? []).map((count, idx) => ({
    label: `Level ${idx + 1}`,
    value: count,
    icon: Users,
    tone: LEVEL_TILE_TONES[idx + 1] ?? LEVEL_TILE_TONES[6],
    money: false as boolean,
  }));
  const moneyTiles = [
    { label: "Total earnings", value: summary.totalEarnings, icon: TrendingUp, tone: "text-violet-600 bg-violet-50 border-violet-200", money: true },
    { label: "Paid rewards", value: summary.paidRewards, icon: Wallet, tone: "text-emerald-600 bg-emerald-50 border-emerald-200", money: true },
    { label: "Pending rewards", value: summary.pendingRewards, icon: Clock, tone: "text-amber-600 bg-amber-50 border-amber-200", money: true },
  ];
  const tiles = [...levelTiles, ...moneyTiles];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="rounded-xl border bg-card p-4">
            <div className={cn("inline-flex items-center justify-center w-8 h-8 rounded-lg border", t.tone)}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="text-xs text-muted-foreground mt-2">{t.label}</div>
            <div className="text-xl font-bold">
              {t.money
                ? t.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : t.value.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function ReportFilterBar({
  filters,
  setFilters,
  hasActive,
  onClear,
}: {
  filters: ReportFilters;
  setFilters: (f: ReportFilters) => void;
  hasActive: boolean;
  onClear: () => void;
}) {
  return (
    <FilterBar hasActiveFilters={hasActive} onClear={onClear}>
      <SearchInput
        value={filters.q}
        onChange={(v) => setFilters({ ...filters, q: v })}
        placeholder="Search downline by name, phone, email…"
        className="sm:w-72"
      />
      <Select
        value={filters.userType}
        onValueChange={(v: "all" | "riders" | "drivers") =>
          setFilters({ ...filters, userType: v })
        }
      >
        <SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All users</SelectItem>
          <SelectItem value="riders">Riders</SelectItem>
          <SelectItem value="drivers">Drivers</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.status}
        onValueChange={(v: "all" | "active" | "inactive") =>
          setFilters({ ...filters, status: v })
        }
      >
        <SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.level}
        onValueChange={(v: LevelFilter) =>
          setFilters({ ...filters, level: v })
        }
      >
        <SelectTrigger className="sm:w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All levels</SelectItem>
          {Array.from({ length: MAX_DEPTH }, (_, i) => i + 1).map((lvl) => (
            <SelectItem key={lvl} value={String(lvl) as LevelFilter}>
              Level {lvl}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        value={filters.fromDate}
        onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
        className="sm:w-40"
      />
      <Input
        type="date"
        value={filters.toDate}
        onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
        className="sm:w-40"
      />
      <Input
        type="number"
        min={0}
        step="1"
        value={filters.minEarnings}
        onChange={(e) => setFilters({ ...filters, minEarnings: e.target.value })}
        className="sm:w-36"
        placeholder="Min earnings"
      />
    </FilterBar>
  );
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

// L1–L3 keep their original commission-window palette; L4–L6 use distinct
// tones (fuchsia/rose/slate) so deep-audit rows are visually obvious in the
// tree and table.
const LEVEL_TONES: Record<number, string> = {
  1: "bg-blue-50 text-blue-700 border-blue-300",
  2: "bg-emerald-50 text-emerald-700 border-emerald-300",
  3: "bg-orange-50 text-orange-700 border-orange-300",
  4: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300",
  5: "bg-rose-50 text-rose-700 border-rose-300",
  6: "bg-slate-100 text-slate-700 border-slate-300",
};

function levelTone(level: number): string {
  return LEVEL_TONES[level] ?? LEVEL_TONES[6] ?? LEVEL_TONES[1];
}

function ReferralTree({
  root,
  tree,
  matchedIds,
  hasFilters,
  onDrillNode,
}: {
  root: MlmReportRoot;
  tree: MlmReportNode[];
  matchedIds: Set<string>;
  hasFilters: boolean;
  onDrillNode: (node: MlmReportNode) => void;
}) {
  if (tree.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState
          icon={SearchIcon}
          title="No referrals found"
          description="This user hasn't referred anyone yet, or their downline is empty."
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 overflow-x-auto">
      <div className="flex flex-col items-stretch md:items-center gap-6 min-w-fit">
        <RootCard root={root} childCount={tree.length} />
        <div className="flex flex-col md:flex-row md:items-start md:justify-center gap-4 md:gap-6">
          {tree.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              matchedIds={matchedIds}
              hasFilters={hasFilters}
              onDrillNode={onDrillNode}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RootCard({
  root,
  childCount,
}: {
  root: MlmReportRoot;
  childCount: number;
}) {
  return (
    <div className="self-center max-w-md w-full">
      <div className="rounded-xl border-2 border-violet-300 bg-violet-50 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">
            Root
          </span>
          <StatusBadge variant={root.appMode === "driver" ? "info" : "neutral"}>
            {root.appMode}
          </StatusBadge>
        </div>
        <div className="text-base font-bold leading-tight">{root.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {root.phone ?? "—"}
          {root.referralCode ? ` · code ${root.referralCode}` : ""}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <Stat label="Direct referrals" value={childCount.toString()} />
          <Stat label="Joined" value={new Date(root.joinedAt).toLocaleDateString()} />
        </div>
      </div>
      {childCount > 0 && (
        <div className="flex justify-center">
          <div className="w-px h-6 bg-border" />
        </div>
      )}
    </div>
  );
}

function NodeCard({
  node,
  matchedIds,
  hasFilters,
  onDrillNode,
}: {
  node: MlmReportNode;
  matchedIds: Set<string>;
  hasFilters: boolean;
  onDrillNode: (node: MlmReportNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const dim = hasFilters && !matchedIds.has(node.id);

  return (
    <div className="flex flex-col items-stretch md:items-center min-w-[240px]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onDrillNode(node)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onDrillNode(node);
          }
        }}
        title="View per-ride earnings breakdown"
        className={cn(
          "rounded-xl border bg-background p-3 shadow-sm transition-opacity text-left w-full cursor-pointer hover:border-violet-400 hover:bg-violet-50/40 focus:outline-none focus:ring-2 focus:ring-violet-300",
          dim && "opacity-40",
        )}
      >
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide",
              levelTone(node.level),
            )}
          >
            L{node.level}
          </span>
          <StatusBadge variant={node.appMode === "driver" ? "info" : "neutral"}>
            {node.appMode}
          </StatusBadge>
        </div>
        <div className="text-sm font-semibold leading-tight truncate">
          {node.name}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {node.phone ?? "—"}
          {node.referralCode ? ` · ${node.referralCode}` : ""}
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
          <Stat label="Direct" value={node.directReferrals.toString()} />
          <Stat label="Earnings" value={node.totalEarnings.toFixed(2)} />
          <Stat label="Joined" value={new Date(node.joinedAt).toLocaleDateString()} />
          <Stat
            label="Status"
            value={node.isActive ? "Active" : "Inactive"}
            tone={node.isActive ? "text-emerald-700" : "text-muted-foreground"}
          />
        </div>
        {node.children.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {open ? "Hide" : "Show"} {node.children.length} child
            {node.children.length === 1 ? "" : "ren"}
          </button>
        )}
      </div>
      {node.children.length > 0 && open && (
        <>
          <div className="flex justify-center">
            <div className="w-px h-5 bg-border" />
          </div>
          <div className="flex flex-col md:flex-row md:items-start md:justify-center gap-3 md:gap-5">
            {node.children.map((c) => (
              <NodeCard
                key={c.id}
                node={c}
                matchedIds={matchedIds}
                hasFilters={hasFilters}
                onDrillNode={onDrillNode}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border bg-muted/30 px-1.5 py-1">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
        {label}
      </div>
      <div className={cn("text-xs font-semibold truncate", tone)}>{value}</div>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3", className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail table
// ---------------------------------------------------------------------------

type SortKey = "name" | "level" | "earnings" | "joined";

function ReferralReportTable({
  rows,
  parentNameById,
  onDrillNode,
}: {
  rows: MlmReportNode[];
  parentNameById: Map<string, string>;
  onDrillNode: (node: MlmReportNode) => void;
}) {
  const [sort, setSort] = useSort<SortKey>({ key: "earnings", direction: "desc" });
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const sorted = useMemo(
    () =>
      sortRows(rows, sort, (r, k) => {
        switch (k) {
          case "name":
            return r.name.toLowerCase();
          case "level":
            return r.level;
          case "earnings":
            return r.totalEarnings;
          case "joined":
            return new Date(r.joinedAt);
        }
      }),
    [rows, sort],
  );

  // Reset to first page whenever the underlying row set or sort changes so
  // the user never lands on an empty page after filtering down.
  useEffect(() => {
    setPage(1);
  }, [rows, sort]);

  const start = (page - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  const exportCsv = () => {
    const header = [
      "User",
      "Phone",
      "Email",
      "User Type",
      "Referred By",
      "Level",
      "Referral Code",
      "Total Earnings",
      "Paid Rewards",
      "Pending Rewards",
      "Joined Date",
      "Status",
    ];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    for (const r of sorted) {
      lines.push(
        [
          escape(r.name),
          escape(r.phone ?? ""),
          escape(r.email ?? ""),
          r.appMode,
          escape(
            r.referredByUserId
              ? parentNameById.get(r.referredByUserId) ?? r.referredByUserId
              : "",
          ),
          r.level,
          escape(r.referralCode ?? ""),
          r.totalEarnings.toFixed(2),
          r.paidRewards.toFixed(2),
          r.pendingRewards.toFixed(2),
          new Date(r.joinedAt).toISOString().slice(0, 10),
          r.isActive ? "Active" : "Inactive",
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mlm-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-center justify-end mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={sorted.length === 0}
          className="gap-1"
        >
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>
      <DataTable
        columnCount={7}
        empty={<EmptyState icon={SearchIcon} title="No referrals found" />}
        header={
          <TableRow>
            <SortableHeader sortKey="name" sort={sort} onSortChange={setSort} defaultDirection="asc">
              User
            </SortableHeader>
            <TableHead>Referred By</TableHead>
            <SortableHeader sortKey="level" sort={sort} onSortChange={setSort}>Level</SortableHeader>
            <TableHead>Referral Code</TableHead>
            <SortableHeader sortKey="earnings" sort={sort} onSortChange={setSort}>Earnings</SortableHeader>
            <SortableHeader sortKey="joined" sort={sort} onSortChange={setSort}>Joined</SortableHeader>
            <TableHead>Status</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={sorted.length}
            pageSize={pageSize}
            itemLabel="members"
          />
        }
      >
        {visible.map((r) => (
          <TableRow
            key={r.id}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => onDrillNode(r)}
            title="View per-ride earnings breakdown"
          >
            <TableCell>
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                {r.phone ?? "—"}
                {r.email ? ` · ${r.email}` : ""}
              </div>
            </TableCell>
            <TableCell className="text-sm">
              {r.referredByUserId
                ? parentNameById.get(r.referredByUserId) ?? "—"
                : "—"}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide",
                  levelTone(r.level),
                )}
              >
                L{r.level}
              </span>
            </TableCell>
            <TableCell className="text-xs font-mono">{r.referralCode ?? "—"}</TableCell>
            <TableCell className="font-medium">
              {r.totalEarnings.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </TableCell>
            <TableCell className="text-xs">
              {new Date(r.joinedAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <StatusBadge variant={r.isActive ? "success" : "neutral"}>
                {r.isActive ? "Active" : "Inactive"}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-user earnings drill-down sheet
// ---------------------------------------------------------------------------

function EarningsDrillSheet({
  node,
  onClose,
}: {
  node: MlmReportNode | null;
  onClose: () => void;
}) {
  const [lastNode, setLastNode] = useState<MlmReportNode | null>(node);
  useEffect(() => {
    if (node) setLastNode(node);
  }, [node]);

  const userId = node?.id ?? "";
  const earningsQuery = useAdminGetMlmReportUserEarnings(userId, {
    query: {
      enabled: !!node,
      queryKey: getAdminGetMlmReportUserEarningsQueryKey(userId),
    },
  });

  const display = node ?? lastNode;
  const rows = earningsQuery.data?.earnings ?? [];

  return (
    <Sheet open={!!node} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[480px] sm:w-[640px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Earnings breakdown
          </SheetTitle>
          <SheetDescription>
            Every referral earning credited to{" "}
            <span className="font-medium text-foreground">
              {display?.name ?? "this user"}
            </span>
            {display?.phone ? ` (${display.phone})` : ""}.
          </SheetDescription>
        </SheetHeader>

        {display && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Stat
              label="Total earned"
              value={(earningsQuery.data?.totalAmount ?? display.totalEarnings).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            />
            <Stat label="Rides" value={rows.length.toString()} />
            <Stat label="Level" value={`L${display.level}`} />
          </div>
        )}

        {earningsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        ) : earningsQuery.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
            Couldn't load earnings for this user.
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No earnings yet"
            description="This user hasn't generated any referral earnings."
          />
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Ride</th>
                  <th className="text-left px-3 py-2">From</th>
                  <th className="text-center px-2 py-2">Lvl</th>
                  <th className="text-right px-2 py-2">%</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      {r.rideId ? (
                        <Link
                          href={`/rides?open=${r.rideId}`}
                          className="inline-flex items-center gap-1 font-mono text-xs text-violet-700 hover:underline"
                          onClick={onClose}
                          title="Open ride detail"
                        >
                          {r.rideId.slice(0, 8)}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium truncate max-w-[140px]">
                        {r.fromUserName ?? "—"}
                      </div>
                      {r.fromUserPhone && (
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {r.fromUserPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide",
                          levelTone(r.level),
                        )}
                      >
                        L{r.level}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-xs">
                      {r.percentage.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {r.amount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        variant={r.status === "credited" ? "success" : "neutral"}
                      >
                        {r.status}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
