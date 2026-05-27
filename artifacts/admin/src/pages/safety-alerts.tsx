import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ShieldAlert, ShieldCheck } from "lucide-react";

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
  SortableHeader,
  StatusBadge,
} from "@/components/admin";

interface SafetyAlertRow {
  id: string;
  rideId: string;
  status: "active" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  triggeredByName: string | null;
  triggeredByLastName: string | null;
  triggeredByCountryCode: string | null;
  triggeredByPhone: string | null;
  resolvedByName: string | null;
}

const PAGE_SIZE = 50;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SafetyAlertsPage() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: "createdAt"; direction: "asc" | "desc" }>({
    key: "createdAt",
    direction: "desc",
  });
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  params.set("sort", sort.direction);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["safety-alerts", statusFilter, sort.direction, page],
    queryFn: () =>
      api<{ alerts: SafetyAlertRow[]; page: number; limit: number; total: number }>(
        `/safety-alerts?${params.toString()}`,
      ),
  });

  const alerts = data?.alerts ?? [];
  const total = data?.total ?? 0;
  const hasFilters = statusFilter !== "all";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Safety Alerts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Full history of safety alerts triggered during trips.
        </p>
      </div>

      <FilterBar
        hasActiveFilters={hasFilters}
        onClear={() => { setStatusFilter("all"); setPage(1); }}
      >
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[160px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
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
            icon={ShieldCheck}
            title={hasFilters ? "No alerts match" : "No safety alerts"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Alerts triggered by riders or drivers during trips will appear here."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Trip ID</TableHead>
            <TableHead>Triggered by</TableHead>
            <SortableHeader
              sortKey="createdAt"
              sort={sort}
              onSortChange={(s) => { setSort(s as typeof sort); setPage(1); }}
            >
              Triggered at
            </SortableHeader>
            <TableHead>Resolved by</TableHead>
            <TableHead>Resolved at</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="alerts"
          />
        }
      >
        {alerts.map((alert) => {
          const userName =
            [alert.triggeredByName, alert.triggeredByLastName].filter(Boolean).join(" ") ||
            "Unknown user";
          const phone = alert.triggeredByPhone
            ? `${alert.triggeredByCountryCode ?? ""}${alert.triggeredByPhone}`
            : null;

          return (
            <TableRow
              key={alert.id}
              className="hover:bg-muted/30 cursor-pointer"
              onClick={() => navigate(`/trips?id=${alert.rideId}`)}
            >
              <TableCell>
                <StatusBadge variant={alert.status === "active" ? "danger" : "neutral"} className="gap-1">
                  {alert.status === "active" ? (
                    <ShieldAlert className="w-3 h-3" />
                  ) : (
                    <ShieldCheck className="w-3 h-3" />
                  )}
                  {alert.status === "active" ? "Active" : "Resolved"}
                </StatusBadge>
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Link
                  href={`/trips?id=${alert.rideId}`}
                  className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline underline-offset-2"
                >
                  {alert.rideId.slice(0, 8)}…
                </Link>
              </TableCell>
              <TableCell>
                <div className="font-medium">{userName}</div>
                {phone && <div className="text-xs text-muted-foreground">{phone}</div>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDate(alert.createdAt)}
              </TableCell>
              <TableCell className="text-xs">
                {alert.resolvedByName ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {alert.resolvedAt ? formatDate(alert.resolvedAt) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </div>
  );
}
