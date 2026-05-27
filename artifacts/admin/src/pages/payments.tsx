import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DollarSign, TrendingUp, Users, Clock, Receipt } from "lucide-react";

import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
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
  useSort,
  type StatusBadgeVariant,
} from "@/components/admin";

interface DisplayAmount {
  amountUsd: number;
  displayAmount: number;
  displayCurrency: string;
  displaySymbol: string;
}

interface Payment {
  id: string;
  tripId: string;
  riderName: string;
  driverName: string;
  amount: number;
  amountDisplay?: DisplayAmount | null;
  adminCommission: number;
  adminCommissionDisplay?: DisplayAmount | null;
  driverEarning: number;
  driverEarningDisplay?: DisplayAmount | null;
  method: string;
  status: string;
  createdAt: string;
}

interface PaymentsSummary {
  grossRideValue: number;
  grossRideValueDisplay?: DisplayAmount | null;
  adminCommission: number;
  adminCommissionDisplay?: DisplayAmount | null;
  driverEarnings: number;
  driverEarningsDisplay?: DisplayAmount | null;
  pendingCash: number;
  pendingCashDisplay?: DisplayAmount | null;
}

interface PaymentsResponse {
  payments: Payment[];
  summary: PaymentsSummary;
  displayCurrency?: string;
  displaySymbol?: string;
}

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  paid: "success",
  completed: "success",
  pending: "warning",
  failed: "danger",
  cancelled: "danger",
  refunded: "info",
};

export default function PaymentsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "payments"],
    queryFn: () => api<PaymentsResponse>("/admin/payments"),
    refetchInterval: 30000,
  });

  const summary = data?.summary;
  const payments = data?.payments ?? [];

  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"amount" | "createdAt" | "riderName" | "driverName">({
    key: "createdAt",
    direction: "desc",
  });

  const methods = useMemo(
    () => Array.from(new Set(payments.map((p) => p.method))).sort(),
    [payments],
  );
  const statuses = useMemo(
    () => Array.from(new Set(payments.map((p) => p.status))).sort(),
    [payments],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      if (method !== "all" && p.method !== method) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q && !`${p.tripId} ${p.riderName} ${p.driverName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [payments, search, method, status]);
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (p, k) => {
        if (k === "createdAt") return new Date(p.createdAt);
        return p[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || method !== "all" || status !== "all";
  const resetFilters = () => { setSearch(""); setMethod("all"); setStatus("all"); setPage(1); };

  // Pull amounts/currency from server-provided display envelopes so KPI
  // cards always render in the platform display currency (no client-side
  // FX math, no hardcoded "MAD").
  const displayCurrency = data?.displayCurrency ?? "USD";
  const summaryCards = [
    {
      label: "Gross Ride Value",
      env: summary?.grossRideValueDisplay,
      fallback: summary?.grossRideValue ?? 0,
      icon: DollarSign,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Admin Commission (15%)",
      env: summary?.adminCommissionDisplay,
      fallback: summary?.adminCommission ?? 0,
      icon: TrendingUp,
      color: "text-purple-600 bg-purple-50",
    },
    {
      label: "Driver Earnings",
      env: summary?.driverEarningsDisplay,
      fallback: summary?.driverEarnings ?? 0,
      icon: Users,
      color: "text-green-600 bg-green-50",
    },
    {
      label: "Pending Cash",
      env: summary?.pendingCashDisplay,
      fallback: summary?.pendingCash ?? 0,
      icon: Clock,
      color: "text-orange-600 bg-orange-50",
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">Payments</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Cash payment tracking for completed trips</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-lg border bg-card p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${card.color}`}>
              <card.icon className="w-4 h-4" />
            </div>
            <p className="text-xs text-muted-foreground">{card.label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold mt-1">
                {card.env
                  ? `${card.env.displayAmount.toFixed(2)} ${card.env.displayCurrency}`
                  : `${card.fallback.toFixed(2)} ${displayCurrency}`}
              </p>
            )}
          </div>
        ))}
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by trip ID, rider, or driver…"
          className="sm:w-72"
        />
        <Select value={method} onValueChange={(v) => { setMethod(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[140px] h-9"><SelectValue placeholder="Method" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {methods.map((m) => (
              <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
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
            icon={Receipt}
            title={hasFilters ? "No payments match" : "No completed trips yet"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Payments are recorded after trips complete. Once you have completed trips, they show up here."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Trip ID</TableHead>
            <SortableHeader sortKey="riderName" sort={sort} onSortChange={setSort} defaultDirection="asc">Rider</SortableHeader>
            <SortableHeader sortKey="driverName" sort={sort} onSortChange={setSort} defaultDirection="asc">Driver</SortableHeader>
            <SortableHeader sortKey="amount" sort={sort} onSortChange={setSort} className="text-right">Amount</SortableHeader>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Driver Net</TableHead>
            <TableHead>Method</TableHead>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>Date</SortableHeader>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="payments"
          />
        }
      >
        {paged.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-mono text-xs text-muted-foreground">{p.tripId.slice(0, 8)}…</TableCell>
            <TableCell className="text-xs">{p.riderName}</TableCell>
            <TableCell className="text-xs">{p.driverName}</TableCell>
            <TableCell className="text-right font-semibold text-xs">
              {(p.amountDisplay?.displayAmount ?? p.amount).toFixed(2)}
            </TableCell>
            <TableCell className="text-right text-xs text-purple-600">
              {(p.adminCommissionDisplay?.displayAmount ?? p.adminCommission).toFixed(2)}
            </TableCell>
            <TableCell className="text-right text-xs text-green-600">
              {(p.driverEarningDisplay?.displayAmount ?? p.driverEarning).toFixed(2)}
            </TableCell>
            <TableCell className="text-xs">
              <StatusBadge variant={STATUS_VARIANT[p.status] ?? "neutral"} className="capitalize">
                {p.method}
              </StatusBadge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(p.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <p className="text-[11px] text-muted-foreground mt-3">
        Cash-first MVP · All amounts in {displayCurrency}
      </p>
    </div>
  );
}
