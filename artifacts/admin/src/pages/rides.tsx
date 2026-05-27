import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplayCurrency, useFormatCurrency } from "@/lib/use-display-currency";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Car } from "lucide-react";
import {
  DataTable,
  DataTablePagination,
  EmptyState,
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge as SharedStatusBadge,
  sortRows,
  useSort,
  type StatusBadgeVariant,
} from "@/components/admin";

interface RideRow {
  id: string;
  status: "bidding" | "driver_arriving" | "in_progress" | "completed" | "cancelled";
  pickup: string;
  dropoff: string;
  distanceKm: number;
  finalAmount: number | null;
  finalAmountDisplay?: { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string } | null;
  ratingScore: number | null;
  createdAt: string;
  bidCount: number;
  rider: { id: string; name: string; phone: string } | null;
  driver: { id: string; name: string; phone: string } | null;
}

interface DispatchLogEntry {
  id: string;
  driverId: string;
  method: "socket" | "push";
  status: "queued" | "delivered" | "failed";
  failureReason: string | null;
  createdAt: string;
  driverName: string | null;
  driverPhone: string | null;
}

const STATUS_VARIANTS: Record<RideRow["status"], StatusBadgeVariant> = {
  bidding: "accent",
  driver_arriving: "info",
  in_progress: "info",
  completed: "success",
  cancelled: "neutral",
};

const METHOD_VARIANTS: Record<DispatchLogEntry["method"], StatusBadgeVariant> = {
  socket: "info",
  push: "info",
};

const DISPATCH_STATUS_VARIANTS: Record<DispatchLogEntry["status"], StatusBadgeVariant> = {
  queued: "warning",
  delivered: "success",
  failed: "danger",
};

const DISPATCH_STATUS_LABEL: Record<DispatchLogEntry["status"], string> = {
  queued: "queued",
  delivered: "delivered",
  failed: "failed",
};

const PAGE_SIZE = 25;

const RIDE_STATUSES: Array<RideRow["status"]> = [
  "bidding",
  "driver_arriving",
  "in_progress",
  "completed",
  "cancelled",
];

function DispatchPanel({ rideId, onClose }: { rideId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/admin/rides", rideId, "dispatch-log"],
    queryFn: () =>
      api<{ dispatchLog: DispatchLogEntry[] }>(`/admin/rides/${rideId}/dispatch-log`),
    refetchInterval: 5000,
  });

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Dispatch Log</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Drivers notified for this ride request — showing delivery method and status.
          </p>
        </SheetHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.dispatchLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No dispatch records yet. They appear once the ride request is broadcast to drivers.
          </p>
        ) : (
          <div className="space-y-3">
            {data.dispatchLog.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border bg-card p-3 text-sm space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entry.driverName?.trim() || "Driver"}</span>
                  <div className="flex gap-1.5">
                    <SharedStatusBadge variant={METHOD_VARIANTS[entry.method]}>
                      {entry.method === "socket" ? "Socket" : "Push"}
                    </SharedStatusBadge>
                    <SharedStatusBadge variant={DISPATCH_STATUS_VARIANTS[entry.status]}>
                      {DISPATCH_STATUS_LABEL[entry.status]}
                    </SharedStatusBadge>
                  </div>
                </div>
                {entry.driverPhone && (
                  <div className="text-xs text-muted-foreground font-mono">{entry.driverPhone}</div>
                )}
                {entry.failureReason && (
                  <div
                    className="text-xs text-destructive mt-1 truncate"
                    title={entry.failureReason}
                  >
                    {entry.failureReason}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function RidesPage() {
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const initialOpen =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("open")
      : null;
  const [selectedRideId, setSelectedRideId] = useState<string | null>(initialOpen);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/admin/rides"],
    queryFn: () => api<{ rides: RideRow[] }>("/admin/rides"),
    refetchInterval: 5000,
  });

  const rides = data?.rides ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RideRow["status"]>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"createdAt" | "finalAmount" | "distanceKm">({
    key: "createdAt",
    direction: "desc",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rides.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (
        q &&
        !`${r.rider?.name ?? ""} ${r.driver?.name ?? ""} ${r.pickup} ${r.dropoff}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rides, search, statusFilter]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (r, k) => {
        if (k === "createdAt") return new Date(r.createdAt);
        if (k === "finalAmount") return r.finalAmount ?? 0;
        return r[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || statusFilter !== "all";
  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Rides</h1>
        <p className="text-muted-foreground mt-1">
          Live and historical rides across the platform. Click a row to see its dispatch log.
        </p>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search rider, driver, pickup, or dropoff…"
          className="sm:w-72"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as typeof statusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-[160px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {RIDE_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columnCount={8}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={Car}
            title={hasFilters ? "No rides match" : "No rides yet"}
            description={
              hasFilters
                ? "Try adjusting your search or filters."
                : "Rides will appear here as riders request them."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Rider</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Trip</TableHead>
            <SortableHeader sortKey="distanceKm" sort={sort} onSortChange={setSort} className="text-right">
              Distance
            </SortableHeader>
            <TableHead className="text-right">Bids</TableHead>
            <SortableHeader sortKey="finalAmount" sort={sort} onSortChange={setSort} className="text-right">
              Fare
            </SortableHeader>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>
              When
            </SortableHeader>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="rides"
          />
        }
      >
        {paged.map((r) => (
          <TableRow
            key={r.id}
            data-testid={`row-ride-${r.id}`}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => setSelectedRideId(r.id)}
          >
            <TableCell>
              <SharedStatusBadge variant={STATUS_VARIANTS[r.status]} className="capitalize">
                {r.status.replace("_", " ")}
              </SharedStatusBadge>
            </TableCell>
            <TableCell>
              <div className="text-sm font-medium">{r.rider?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground font-mono">{r.rider?.phone}</div>
            </TableCell>
            <TableCell>
              {r.driver ? (
                <>
                  <div className="text-sm font-medium">{r.driver.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {r.driver.phone}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground text-sm">unassigned</span>
              )}
            </TableCell>
            <TableCell className="text-sm max-w-xs">
              <div className="truncate">{r.pickup}</div>
              <div className="text-muted-foreground truncate">→ {r.dropoff}</div>
            </TableCell>
            <TableCell className="text-right text-sm">{r.distanceKm.toFixed(1)} km</TableCell>
            <TableCell className="text-right text-sm">{r.bidCount}</TableCell>
            <TableCell className="text-right text-sm font-medium">
              {r.finalAmountDisplay
                ? formatAmount(
                    r.finalAmountDisplay.displayAmount,
                    r.finalAmountDisplay.displayCurrency,
                  )
                : r.finalAmount != null
                  ? formatAmount(r.finalAmount, displayCurrency.code)
                  : "—"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(r.createdAt).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      {selectedRideId && (
        <DispatchPanel rideId={selectedRideId} onClose={() => setSelectedRideId(null)} />
      )}
    </div>
  );
}
