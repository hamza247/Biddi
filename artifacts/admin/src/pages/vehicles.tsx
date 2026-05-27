import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Truck } from "lucide-react";

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

interface DriverWithVehicle {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  driverStatus: string;
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: string;
    color: string;
    plate: string;
  } | null;
}

const PAGE_SIZE = 25;

export default function VehiclesPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "vehicles"],
    queryFn: () => api<{ drivers: DriverWithVehicle[] }>("/admin/drivers"),
  });

  const withVehicles = useMemo(
    () => (data?.drivers ?? []).filter((d): d is DriverWithVehicle & { vehicle: NonNullable<DriverWithVehicle["vehicle"]> } => !!d.vehicle),
    [data],
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"plate" | "make" | "year" | "lastName">({
    key: "lastName",
    direction: "asc",
  });

  const statuses = useMemo(
    () => Array.from(new Set(withVehicles.map((d) => d.driverStatus))).sort(),
    [withVehicles],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withVehicles.filter((d) => {
      if (status !== "all" && d.driverStatus !== status) return false;
      if (!q) return true;
      const v = d.vehicle;
      return `${d.firstName} ${d.lastName} ${d.phone} ${v.make} ${v.model} ${v.plate} ${v.color}`
        .toLowerCase()
        .includes(q);
    });
  }, [withVehicles, search, status]);
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (d, k) => {
        if (k === "plate" || k === "make" || k === "year") return d.vehicle[k];
        return d[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || status !== "all";
  const resetFilters = () => { setSearch(""); setStatus("all"); setPage(1); };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">Vehicles</h1>
        <p className="text-muted-foreground text-sm mt-0.5">All registered driver vehicles</p>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by driver, plate, make…"
          className="sm:w-72"
        />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[160px] h-9"><SelectValue placeholder="Driver status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
            ))}
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
            icon={Truck}
            title={hasFilters ? "No vehicles match" : "No vehicles registered yet"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Vehicles appear here once drivers complete onboarding."
            }
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="make" sort={sort} onSortChange={setSort} defaultDirection="asc">Vehicle</SortableHeader>
            <SortableHeader sortKey="lastName" sort={sort} onSortChange={setSort} defaultDirection="asc">Driver</SortableHeader>
            <SortableHeader sortKey="plate" sort={sort} onSortChange={setSort} defaultDirection="asc">Plate</SortableHeader>
            <SortableHeader sortKey="year" sort={sort} onSortChange={setSort}>Year</SortableHeader>
            <TableHead>Color</TableHead>
            <TableHead>Driver Status</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="vehicles"
          />
        }
      >
        {paged.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              <div className="font-medium">{d.vehicle.make} {d.vehicle.model}</div>
            </TableCell>
            <TableCell>
              <div className="font-medium text-xs">{d.firstName} {d.lastName}</div>
              <div className="text-xs text-muted-foreground">{d.phone}</div>
            </TableCell>
            <TableCell className="font-mono text-xs font-bold">{d.vehicle.plate}</TableCell>
            <TableCell className="text-xs">{d.vehicle.year}</TableCell>
            <TableCell className="text-xs">{d.vehicle.color}</TableCell>
            <TableCell>
              <StatusBadge variant={statusToVariant(d.driverStatus)} className="capitalize">
                {d.driverStatus.replace(/_/g, " ")}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}
