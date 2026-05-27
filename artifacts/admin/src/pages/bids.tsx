import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Gavel } from "lucide-react";

import { api } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  DataTable,
  DataTablePagination,
  EmptyState,
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge,
  sortRows,
  statusToVariant,
  useSort,
} from "@/components/admin";

interface Bid {
  id: string;
  rideId: string;
  ridePickup: string;
  rideDropoff: string;
  rideStatus: string;
  riderInitialFare: number | null;
  driverName: string;
  driverPhone: string;
  amount: number;
  etaMin: number;
  note: string | null;
  status: "active" | "accepted" | "rejected" | "cancelled" | "expired";
  expiresAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function BidsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"amount" | "etaMin" | "createdAt" | "driverName">({
    key: "createdAt",
    direction: "desc",
  });

  const path = statusFilter !== "all" ? `/admin/bids?status=${statusFilter}` : "/admin/bids";
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "bids", statusFilter],
    queryFn: () => api<{ bids: Bid[] }>(path),
    refetchInterval: 15000,
  });

  const bids = data?.bids ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bids;
    return bids.filter((b) =>
      `${b.id} ${b.driverName} ${b.driverPhone} ${b.ridePickup} ${b.rideDropoff}`
        .toLowerCase()
        .includes(q),
    );
  }, [bids, search]);
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (b, k) => {
        if (k === "createdAt") return new Date(b.createdAt);
        return b[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || statusFilter !== "all";
  const resetFilters = () => { setSearch(""); setStatusFilter("all"); setPage(1); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Bids</h1>
          <p className="text-muted-foreground text-sm mt-0.5">All driver bids on ride requests</p>
        </div>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search bid, driver or route…"
          className="sm:w-72"
        />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[160px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columnCount={7}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={Gavel}
            title={hasFilters ? "No bids match" : "No bids yet"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Bids appear here as drivers respond to ride requests."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Bid ID</TableHead>
            <SortableHeader sortKey="driverName" sort={sort} onSortChange={setSort} defaultDirection="asc">Driver</SortableHeader>
            <TableHead>Route</TableHead>
            <SortableHeader sortKey="amount" sort={sort} onSortChange={setSort} className="text-right">Amount</SortableHeader>
            <SortableHeader sortKey="etaMin" sort={sort} onSortChange={setSort} className="text-right">ETA</SortableHeader>
            <TableHead>Status</TableHead>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>Date</SortableHeader>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="bids"
          />
        }
      >
        {paged.map((bid) => (
          <TableRow key={bid.id}>
            <TableCell className="font-mono text-xs text-muted-foreground">{bid.id.slice(0, 8)}…</TableCell>
            <TableCell>
              <div className="font-medium">{bid.driverName}</div>
              <div className="text-xs text-muted-foreground">{bid.driverPhone}</div>
            </TableCell>
            <TableCell className="max-w-[220px]">
              <div className="text-xs truncate">{bid.ridePickup}</div>
              <div className="text-xs text-muted-foreground truncate">→ {bid.rideDropoff}</div>
            </TableCell>
            <TableCell className="text-right font-semibold">{bid.amount.toFixed(2)} MAD</TableCell>
            <TableCell className="text-right">{bid.etaMin} min</TableCell>
            <TableCell>
              <StatusBadge variant={statusToVariant(bid.status)} className="capitalize">
                {bid.status}
              </StatusBadge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(bid.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}
