import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "wouter";
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
  statusToVariant,
  sortRows,
  useSort,
} from "@/components/admin";

interface BiddingPost {
  id: string;
  rideStatus: string;
  riderName: string;
  riderPhone: string;
  pickupLabel: string;
  dropoffLabel: string;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  initialFare: number | null;
  biddingExpiresAt: string | null;
  offerCount: number;
  activeOfferCount: number;
  acceptedBidId: string | null;
  acceptedDriverId: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const PAGE_SIZE = 25;

export default function BiddingPostsPage() {
  const [statusFilter, setStatusFilter] = useState("bidding");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<
    "initialFare" | "offerCount" | "createdAt" | "biddingExpiresAt"
  >({ key: "createdAt", direction: "desc" });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "bidding-posts", statusFilter],
    queryFn: () =>
      api<{ posts: BiddingPost[] }>(`/admin/bidding/posts?status=${statusFilter}`),
    refetchInterval: 15000,
  });

  const posts = data?.posts ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((p) =>
      `${p.id} ${p.riderName} ${p.riderPhone} ${p.pickupLabel} ${p.dropoffLabel}`
        .toLowerCase()
        .includes(q),
    );
  }, [posts, search]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (p, k) => {
        if (k === "createdAt") return new Date(p.createdAt);
        if (k === "biddingExpiresAt")
          return p.biddingExpiresAt ? new Date(p.biddingExpiresAt) : new Date(0);
        if (k === "initialFare") return p.initialFare ?? -1;
        return p.offerCount;
      }),
    [filtered, sort],
  );

  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || statusFilter !== "bidding";
  const resetFilters = () => {
    setSearch("");
    setStatusFilter("bidding");
    setPage(1);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Bidding posts</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            inDrive-style ride requests where the rider named a price and drivers respond with offers.
          </p>
        </div>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search rider, route, or post id…"
          className="sm:w-72"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-[180px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bidding">Active bidding</SelectItem>
            <SelectItem value="driver_arriving">Accepted (en route)</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
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
            title={hasFilters ? "No posts match" : "No bidding posts"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "When riders post a 'name your price' request it appears here in real time."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Post</TableHead>
            <TableHead>Rider</TableHead>
            <TableHead>Route</TableHead>
            <SortableHeader
              sortKey="initialFare"
              sort={sort}
              onSortChange={setSort}
              className="text-right"
            >
              Asking
            </SortableHeader>
            <SortableHeader
              sortKey="offerCount"
              sort={sort}
              onSortChange={setSort}
              className="text-right"
            >
              Offers
            </SortableHeader>
            <TableHead>Status</TableHead>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>
              Created
            </SortableHeader>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="posts"
          />
        }
      >
        {paged.map((p) => {
          const exp = p.biddingExpiresAt ? new Date(p.biddingExpiresAt) : null;
          const expiresInMs = exp ? exp.getTime() - Date.now() : null;
          const expired = expiresInMs != null && expiresInMs < 0;
          return (
            <TableRow key={p.id}>
              <TableCell>
                <Link
                  href={`/bidding/posts/${p.id}`}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {p.id.slice(0, 8)}…
                </Link>
                {p.rideStatus === "bidding" && exp && !expired && (
                  <div className="text-xs text-muted-foreground">
                    expires {fmtRel(expiresInMs!)}
                  </div>
                )}
                {p.rideStatus === "bidding" && expired && (
                  <div className="text-xs text-destructive">expired</div>
                )}
              </TableCell>
              <TableCell>
                <div className="font-medium">{p.riderName}</div>
                <div className="text-xs text-muted-foreground">{p.riderPhone}</div>
              </TableCell>
              <TableCell className="max-w-[220px]">
                <div className="text-xs truncate">{p.pickupLabel}</div>
                <div className="text-xs text-muted-foreground truncate">
                  → {p.dropoffLabel}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.estimatedDistanceKm.toFixed(1)} km · {p.estimatedDurationMin} min
                </div>
              </TableCell>
              <TableCell className="text-right font-semibold">
                {p.initialFare != null ? p.initialFare.toFixed(2) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="font-semibold">{p.offerCount}</div>
                {p.activeOfferCount > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {p.activeOfferCount} active
                  </div>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge variant={statusToVariant(p.rideStatus)} className="capitalize">
                  {p.rideStatus.replace("_", " ")}
                </StatusBadge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(p.createdAt).toLocaleString()}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </div>
  );
}

function fmtRel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}
