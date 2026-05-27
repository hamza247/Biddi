import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Globe } from "lucide-react";
import { api } from "@/lib/api";
import {
  GEO_FENCE_TYPE_LABELS,
  GEO_FENCE_TYPES,
  countryFlagEmoji,
  type CountryRow,
  type GeoFenceLocation,
  type GeoFenceType,
} from "@/lib/geo-fence";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  ConfirmDialog,
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
import { toast } from "@/hooks/use-toast";

interface Props {
  /** When set, the list is locked to this Location For value. */
  fixedType?: GeoFenceType;
  /** Page heading override. */
  heading?: string;
  subheading?: string;
}

const GEO_FENCE_TYPE_VARIANT: Record<GeoFenceType, StatusBadgeVariant> = {
  service_area: "info",
  restricted_area: "danger",
  pricing_zone: "info",
  location_wise_fare: "accent",
  airport_surcharge: "warning",
  vehicle_service_type: "accent",
};

const PAGE_SIZE = 20;

export function GeoFenceLocationsPage({ fixedType, heading, subheading }: Props) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState("");
  const [type, setType] = useState<GeoFenceType | "all">(fixedType ?? "all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [country, setCountry] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"name" | "country">({
    key: "name",
    direction: "asc",
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: countriesData } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => api<{ countries: CountryRow[] }>("/admin/countries"),
  });
  const countries = countriesData?.countries ?? [];

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    const effectiveType = fixedType ?? (type !== "all" ? type : undefined);
    if (effectiveType) params.set("type", effectiveType);
    if (status !== "all") params.set("status", status);
    if (country !== "all") params.set("country", country);
    if (search) params.set("q", search);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [fixedType, type, status, country, search]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "geo-fence-locations", fixedType ?? type, status, country, search],
    queryFn: () =>
      api<{ serviceAreas: GeoFenceLocation[] }>(`/admin/service-areas${queryString}`),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/service-areas/${id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "geo-fence-locations"] }),
    onError: () => toast({ title: "Could not update status", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/service-areas/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "geo-fence-locations"] });
      toast({ title: "Location deleted" });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleReset = () => {
    setSearch("");
    if (!fixedType) setType("all");
    setStatus("all");
    setCountry("all");
    setPage(1);
  };

  const goToNew = () => {
    const params = new URLSearchParams();
    if (fixedType) params.set("type", fixedType);
    setLocation(`/geo-fence/locations/new${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const all = data?.serviceAreas ?? [];
  const sorted = useMemo(
    () => sortRows(all, sort, (r, k) => r[k]),
    [all, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters =
    search !== "" ||
    (!fixedType && type !== "all") ||
    status !== "all" ||
    country !== "all";
  const deleting = all.find((a) => a.id === confirmDeleteId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{heading ?? "Geo Fence Locations"}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {subheading ?? "Manage operating areas, restricted zones and special-fare polygons."}
          </p>
        </div>
        <Button size="sm" onClick={goToNew} data-testid="button-add-location">
          <Plus className="w-4 h-4 mr-1.5" /> Add Location
        </Button>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={handleReset}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by location name…"
          className="sm:w-72"
          data-testid="input-search"
        />
        {!fixedType && (
          <Select value={type} onValueChange={(v) => { setType(v as typeof type); setPage(1); }}>
            <SelectTrigger className="sm:w-[180px] h-9" data-testid="select-type-filter"><SelectValue placeholder="Location for" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {GEO_FENCE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{GEO_FENCE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[180px] h-9" data-testid="select-country-filter"><SelectValue placeholder="Country" /></SelectTrigger>
          <SelectContent className="max-h-[16rem]">
            <SelectItem value="all">All countries</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true">{countryFlagEmoji(c.isoCode)}</span>
                  <span>{c.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
          <SelectTrigger className="sm:w-[140px] h-9" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
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
            icon={Globe}
            title={hasFilters ? "No locations match your filters" : "No geo-fence locations yet"}
            description={
              hasFilters
                ? "Adjust your filters or add a new location."
                : "Define operating areas, restricted zones or special-fare polygons."
            }
            action={!hasFilters ? <Button size="sm" onClick={goToNew}><Plus className="w-4 h-4 mr-1.5" />Add location</Button> : undefined}
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="name" sort={sort} onSortChange={setSort} defaultDirection="asc">Location Name</SortableHeader>
            <SortableHeader sortKey="country" sort={sort} onSortChange={setSort} defaultDirection="asc">Country</SortableHeader>
            <TableHead>Location For</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[88px]">Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="locations"
          />
        }
      >
        {paged.map((a) => (
          <TableRow key={a.id} data-testid={`row-location-${a.id}`}>
            <TableCell className="font-medium">{a.name}</TableCell>
            <TableCell className="text-xs">{a.country}</TableCell>
            <TableCell>
              <StatusBadge variant={GEO_FENCE_TYPE_VARIANT[a.type] ?? "neutral"}>
                {GEO_FENCE_TYPE_LABELS[a.type]}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Switch
                  checked={a.active}
                  onCheckedChange={(v) => toggle.mutate({ id: a.id, active: v })}
                  data-testid={`switch-status-${a.id}`}
                />
                <StatusBadge variant={a.active ? "success" : "neutral"}>
                  {a.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Link href={`/geo-fence/locations/${a.id}/edit`}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" data-testid={`button-edit-${a.id}`} aria-label="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(a.id)}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  data-testid={`button-delete-${a.id}`}
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title={deleting ? `Delete "${deleting.name}"?` : "Delete this location?"}
        description="The geo-fence will stop being applied immediately. This cannot be undone."
        confirmLabel="Delete location"
        loading={remove.isPending}
        onConfirm={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
      />
    </div>
  );
}

export default function GeoFenceAllLocationsPage() {
  return <GeoFenceLocationsPage />;
}
