import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Star, MessageSquare } from "lucide-react";

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
  sortRows,
  useSort,
} from "@/components/admin";

interface Review {
  id: string;
  tripId: string;
  riderName: string;
  driverName: string;
  score: number;
  createdAt: string;
}

const PAGE_SIZE = 25;

function Stars({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= score ? "text-yellow-400 fill-yellow-400" : "text-gray-200 fill-gray-200"}`}
        />
      ))}
      <span className="ml-1 text-xs font-medium">{score}/5</span>
    </div>
  );
}

export default function ReviewsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "reviews"],
    queryFn: () => api<{ reviews: Review[] }>("/admin/reviews"),
  });

  const reviews = data?.reviews ?? [];
  const avgScore = reviews.length
    ? (reviews.reduce((s, r) => s + (r.score ?? 0), 0) / reviews.length).toFixed(1)
    : "—";

  const [search, setSearch] = useState("");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"score" | "createdAt" | "riderName">({
    key: "createdAt",
    direction: "desc",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((r) => {
      if (scoreFilter !== "all" && String(r.score) !== scoreFilter) return false;
      if (q && !`${r.tripId} ${r.riderName} ${r.driverName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reviews, search, scoreFilter]);
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
  const hasFilters = search !== "" || scoreFilter !== "all";
  const resetFilters = () => { setSearch(""); setScoreFilter("all"); setPage(1); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Reviews</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Rider ratings left after completed trips</p>
        </div>
        {reviews.length > 0 && (
          <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
            <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
            <span className="font-bold text-yellow-700">{avgScore}</span>
            <span className="text-xs text-yellow-600">avg across {reviews.length} reviews</span>
          </div>
        )}
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by rider, driver, or trip ID…"
          className="sm:w-72"
        />
        <Select value={scoreFilter} onValueChange={(v) => { setScoreFilter(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[140px] h-9"><SelectValue placeholder="Rating" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ratings</SelectItem>
            {[5, 4, 3, 2, 1].map((s) => (
              <SelectItem key={s} value={String(s)}>{s} star{s > 1 ? "s" : ""}</SelectItem>
            ))}
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
            icon={MessageSquare}
            title={hasFilters ? "No reviews match" : "No reviews yet"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Reviews appear after riders rate completed trips."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Trip</TableHead>
            <SortableHeader sortKey="riderName" sort={sort} onSortChange={setSort} defaultDirection="asc">Rider</SortableHeader>
            <TableHead>Driver</TableHead>
            <SortableHeader sortKey="score" sort={sort} onSortChange={setSort}>Rating</SortableHeader>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>Date</SortableHeader>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="reviews"
          />
        }
      >
        {paged.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono text-xs text-muted-foreground">{r.tripId.slice(0, 8)}…</TableCell>
            <TableCell className="text-xs font-medium">{r.riderName}</TableCell>
            <TableCell className="text-xs">{r.driverName}</TableCell>
            <TableCell><Stars score={r.score} /></TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(r.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}
