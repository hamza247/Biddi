import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useDisplayCurrency, useFormatCurrency } from "@/lib/use-display-currency";
import { toast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataTable,
  DataTablePagination,
  EmptyState,
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge as SharedStatusBadge,
  sortRows,
  statusToVariant,
  useSort,
} from "@/components/admin";
import { Users as UsersIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  CheckCircle,
  XCircle,
  Pencil,
  Trash2,
  Plus,
  FileText,
  Ban,
  Eye,
  Upload,
  X,
  Clock,
  Wallet,
  Banknote,
  TrendingDown,
  TrendingUp,
  ArrowUpRight,
  ShieldCheck,
  ShieldOff,
  Star,
  StarHalf,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Navigation,
} from "lucide-react";

type Status = "all" | "pending" | "approved" | "rejected" | "suspended";
type DriverStatus = "pending" | "approved" | "rejected" | "suspended" | "not_applied";

interface Vehicle {
  make: string;
  model: string;
  year: string;
  color: string;
  plate: string;
  vehicleTypeId?: string | null;
  zoneId?: string | null;
  vehicleTypeName?: string | null;
  zoneName?: string | null;
}

interface VehicleTypeSummary {
  id: string;
  name: string;
}

interface ServiceAreaSummary {
  id: string;
  name: string;
}

interface DriverRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl?: string | null;
  driverStatus: DriverStatus;
  driverOnline: boolean;
  driverRejectionReason?: string | null;
  driverSuspensionReason?: string | null;
  rating: number;
  trips: number;
  walletBalance?: string;
  walletBalanceDisplay?: { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string } | null;
  createdAt: string;
  vehicle: Vehicle | null;
  acceptanceRate: number | null;
  cancellationRate: number | null;
  acceptanceSampleSize: number;
  cancellationSampleSize: number;
}

interface WalletTransaction {
  id: string;
  type:
    | "top_up"
    | "commission_deduction"
    | "manual_adjustment"
    | "withdrawal_request"
    | "withdrawal_paid"
    | "withdrawal_refund";
  amount: number;
  rideId: string | null;
  note: string | null;
  createdAt: string;
}

const TX_LABEL: Record<WalletTransaction["type"], string> = {
  top_up: "Top-up",
  commission_deduction: "Commission",
  manual_adjustment: "Adjustment",
  withdrawal_request: "Withdrawal request",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_refund: "Withdrawal refund",
};

type WithdrawalStatus =
  | "pending"
  | "approved"
  | "paid"
  | "rejected"
  | "cancelled";

interface PayoutMethodSnapshot {
  method: "bank" | "mobile_money";
  accountName: string;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  mobileProvider: string | null;
  mobileNumber: string | null;
}

interface WithdrawalRow {
  id: string;
  driverId: string;
  amount: number;
  status: WithdrawalStatus;
  payoutMethod: PayoutMethodSnapshot;
  paymentReference: string | null;
  rejectionReason: string | null;
  decidedByAdminId: string | null;
  decidedByAdminName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
}

interface CommissionExemption {
  id: string;
  startsAt: string;
  expiresAt: string;
  grantedByAdminName: string | null;
}

interface SubmittedDoc {
  type: string;
  url: string;
  contentType?: string;
  status?: "pending" | "approved" | "rejected";
  rejectionReason?: string;
}

interface DestinationModeDisabled {
  disabledUntil: string;
  disabledReason: string | null;
}

interface DestinationModeStats {
  last7d: { total: number; matched: number; matchRatePct: number | null };
  last30d: { total: number; matched: number; matchRatePct: number | null };
  destinationModeDisabled: DestinationModeDisabled | null;
}

interface DriverDetail extends DriverRow {
  appMode: "rider" | "driver";
  submittedDocs: string[];
  submittedDocuments: SubmittedDoc[];
  walletBalance: string;
  walletBalanceDisplay?: { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string } | null;
  activeCommissionExemption: CommissionExemption | null;
  destinationModeDisabled: DestinationModeDisabled | null;
  acceptanceRate: number | null;
  cancellationRate: number | null;
  acceptanceSampleSize: number;
  acceptanceBidCount: number;
  cancellationSampleSize: number;
  cancellationDriverCount: number;
}

interface StatusHistoryEntry {
  id: string;
  status: DriverStatus;
  action: string | null;
  reason: string | null;
  adminName: string | null;
  createdAt: string;
}

const TABS: { value: Status; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
  { value: "all", label: "All" },
];

const DOC_LABELS: Record<string, string> = {
  license: "Driver license",
  insurance: "Insurance",
  registration: "Vehicle registration",
  selfie: "Selfie verification",
};

const ALL_DOC_TYPES = Object.keys(DOC_LABELS);

function RatingStars({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(5, value));
  // Round to the nearest half-star so the visual matches the numeric value
  // closely without producing odd partial fills.
  const halves = Math.round(clamped * 2);
  const full = Math.floor(halves / 2);
  const hasHalf = halves % 2 === 1;
  const empty = 5 - full - (hasHalf ? 1 : 0);
  return (
    <span
      className="inline-flex items-center text-amber-500"
      aria-label={`Rating ${clamped.toFixed(2)} out of 5`}
    >
      {Array.from({ length: full }).map((_, i) => (
        <Star key={`f-${i}`} className="w-4 h-4 fill-current" />
      ))}
      {hasHalf && <StarHalf key="h" className="w-4 h-4 fill-current" />}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`e-${i}`} className="w-4 h-4 text-muted-foreground/40" />
      ))}
    </span>
  );
}

function StatusBadge({ s }: { s: DriverStatus }) {
  return (
    <SharedStatusBadge variant={statusToVariant(s)} className="capitalize">
      {s.replace("_", " ")}
    </SharedStatusBadge>
  );
}

function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(url);
}

async function uploadFile(
  file: File,
): Promise<{ url: string; contentType: string }> {
  const { uploadURL, objectPath } = await api<{
    uploadURL: string;
    objectPath: string;
  }>("/storage/uploads/request-url", {
    method: "POST",
    json: {
      name: file.name,
      size: file.size,
      contentType: file.type,
    },
  });

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!putRes.ok) throw new Error("Upload to storage failed");

  await api("/storage/uploads/finalize", {
    method: "POST",
    json: { objectPath },
  });

  return { url: `/api/storage${objectPath}`, contentType: file.type };
}

const EMPTY_VEHICLE: Vehicle = { make: "", model: "", year: "", color: "", plate: "", vehicleTypeId: null, zoneId: null };

function RateCell({
  value,
  sample,
  kind,
  lowThreshold,
  highThreshold,
}: {
  value: number | null;
  sample: number;
  kind: "acceptance" | "cancellation";
  lowThreshold: number;
  highThreshold: number;
}) {
  if (value === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground text-sm">—</span>
        </TooltipTrigger>
        <TooltipContent>
          Not enough data yet ({sample} of 5 needed).
        </TooltipContent>
      </Tooltip>
    );
  }
  const isBad =
    kind === "acceptance" ? value < lowThreshold : value > highThreshold;
  const tone = isBad ? "text-destructive font-semibold" : "text-foreground";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`text-sm tabular-nums ${tone}`}>
          {value.toFixed(1)}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Based on {sample} {kind === "acceptance" ? "dispatched" : "accepted"} ride
        {sample === 1 ? "" : "s"}.
      </TooltipContent>
    </Tooltip>
  );
}

export default function DriversPage() {
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const initialParams = new URLSearchParams(window.location.search);
  const initial = (initialParams.get("status") as Status) || "all";
  // Allow other pages (e.g. Live Map marker popups) to deep-link to a
  // driver's detail panel via `?open=<driverId>`. The detail dialog fetches
  // the driver directly by id, so it works regardless of the active tab.
  const initialOpen = initialParams.get("open");
  const [status, setStatus] = useState<Status>(initial);
  const [problemOnly, setProblemOnly] = useState(false);
  // Sort state for the new Accept / Cancel columns. `null` means "no sort"
  // (default order from the API, which is `createdAt desc`).
  const [sortBy, setSortBy] = useState<"acceptance" | "cancellation" | null>(
    null,
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: "acceptance" | "cancellation") => {
    if (sortBy !== key) {
      setSortBy(key);
      // Acceptance defaults to ascending so worst offenders rise to the
      // top; cancellation defaults to descending for the same reason.
      setSortDir(key === "acceptance" ? "asc" : "desc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortBy(null);
    }
  };
  const [openDriverId, setOpenDriverId] = useState<string | null>(initialOpen);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rejectDriverId, setRejectDriverId] = useState<string | null>(null);
  const [rejectDriverReason, setRejectDriverReason] = useState("");
  const [suspendDriverId, setSuspendDriverId] = useState<string | null>(null);
  const [suspendDriverReason, setSuspendDriverReason] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/admin/drivers", status],
    queryFn: () =>
      api<{
        drivers: DriverRow[];
        ratingsDegraded?: boolean;
        ratesDegraded?: boolean;
      }>(`/admin/drivers?status=${status}`),
    refetchInterval: 8000,
  });
  const ratingsDegraded = data?.ratingsDegraded === true;
  const ratesDegraded = data?.ratesDegraded === true;
  // Thresholds for highlighting "problem" drivers in the list. These match
  // common ride-hailing operations defaults: an acceptance rate below 70%
  // or a driver-cancellation rate above 20% is worth flagging. Drivers
  // without enough sample data (rate is null) are never flagged.
  const LOW_ACCEPTANCE = 70;
  const HIGH_CANCELLATION = 20;
  const isProblemDriver = (d: DriverRow) =>
    (d.acceptanceRate !== null && d.acceptanceRate < LOW_ACCEPTANCE) ||
    (d.cancellationRate !== null && d.cancellationRate > HIGH_CANCELLATION);

  const DRIVER_PAGE_SIZE = 25;
  const [drvSearch, setDrvSearch] = useState("");
  const [drvPage, setDrvPage] = useState(1);
  const [drvSort, setDrvSort] = useSort<"firstName" | "createdAt" | "walletBalance">({
    key: "createdAt",
    direction: "desc",
  });
  const allDrivers = data?.drivers ?? [];
  const drvFiltered = useMemo(() => {
    const base = problemOnly ? allDrivers.filter(isProblemDriver) : allDrivers;
    const q = drvSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) =>
      `${d.firstName ?? ""} ${d.lastName ?? ""} ${d.phone ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [allDrivers, drvSearch, problemOnly]);
  const drvSorted = useMemo(() => {
    if (sortBy) {
      const key = sortBy === "acceptance" ? "acceptanceRate" : "cancellationRate";
      const dir = sortDir === "asc" ? 1 : -1;
      return drvFiltered.slice().sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dir;
      });
    }
    return sortRows(drvFiltered, drvSort, (d, k): string | number | Date | null | undefined => {
      if (k === "createdAt") return new Date(d.createdAt);
      if (k === "walletBalance") return parseFloat(d.walletBalance ?? "0");
      return d.firstName ?? "";
    });
  }, [drvFiltered, drvSort, sortBy, sortDir]);
  const drvTotal = drvSorted.length;
  const drvPaged = drvSorted.slice(
    (drvPage - 1) * DRIVER_PAGE_SIZE,
    drvPage * DRIVER_PAGE_SIZE,
  );
  const drvHasFilters = drvSearch !== "" || problemOnly || status !== "all";
  const resetDrvFilters = () => {
    setDrvSearch("");
    setProblemOnly(false);
    setStatus("all");
    setDrvPage(1);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/admin/drivers"] });
    qc.invalidateQueries({ queryKey: ["/admin/stats"] });
    if (openDriverId) qc.invalidateQueries({ queryKey: ["/admin/drivers", openDriverId] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => api(`/admin/drivers/${id}/approve`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api(`/admin/drivers/${id}/reject`, { method: "POST", json: reason ? { reason } : {} }),
    onSuccess: invalidate,
  });
  const suspend = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api(`/admin/drivers/${id}/suspend`, { method: "POST", json: reason ? { reason } : {} }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setOpenDriverId(null);
      setConfirmDeleteId(null);
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Drivers</h1>
          <p className="text-muted-foreground mt-1">
            Approve, edit, suspend, delete, or add drivers manually.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-add-driver">
          <Plus className="w-4 h-4 mr-1" />
          Add driver
        </Button>
      </div>

      {ratingsDegraded && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="banner-ratings-degraded"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium">Ratings may be stale.</span>{" "}
            We couldn't recompute live driver ratings, so each row is showing
            the last stored value as a fallback.
          </div>
        </div>
      )}

      {ratesDegraded && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="banner-rates-degraded"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium">
              Acceptance / cancellation rates unavailable.
            </span>{" "}
            We couldn't compute driver rates this round; columns will show
            "—" until the next refresh.
          </div>
        </div>
      )}

      <FilterBar hasActiveFilters={drvHasFilters} onClear={resetDrvFilters}>
        <SearchInput
          value={drvSearch}
          onChange={(v) => {
            setDrvSearch(v);
            setDrvPage(1);
          }}
          placeholder="Search by name or phone…"
          className="sm:w-72"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as Status);
            setDrvPage(1);
          }}
        >
          <SelectTrigger className="sm:w-[160px] h-9" data-testid="filter-driver-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {TABS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={problemOnly ? "default" : "outline"}
          size="sm"
          className="h-9"
          onClick={() => {
            setProblemOnly((v) => !v);
            setDrvPage(1);
          }}
          data-testid="toggle-problem-only"
          title={`Show only drivers with acceptance < ${LOW_ACCEPTANCE}% or cancellation > ${HIGH_CANCELLATION}%`}
        >
          <AlertTriangle className="w-4 h-4 mr-1" />
          Problem drivers only
        </Button>
      </FilterBar>

      <DataTable
        columnCount={9}
        isLoading={isLoading}
        empty={
          <EmptyState
            icon={UsersIcon}
            title={drvHasFilters ? "No drivers match" : "No drivers in this category yet"}
            description={
              drvHasFilters
                ? problemOnly && (data?.drivers.length ?? 0) > 0
                  ? "No problem drivers in this category."
                  : "Try adjusting your search or filters."
                : "Drivers will appear here once they fall into this status."
            }
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="firstName" sort={drvSort} onSortChange={setDrvSort} defaultDirection="asc">
              Driver
            </SortableHeader>
            <TableHead>Phone</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Online</TableHead>
            <TableHead>
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={() => toggleSort("acceptance")}
                title="Acceptance rate (% of dispatched rides this driver bid on). '—' until 5+ dispatches."
                data-testid="sort-acceptance"
              >
                Accept
                {sortBy === "acceptance" ? (
                  sortDir === "asc" ? (
                    <ArrowUp className="w-3 h-3" />
                  ) : (
                    <ArrowDown className="w-3 h-3" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />
                )}
              </button>
            </TableHead>
            <TableHead>
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={() => toggleSort("cancellation")}
                title="Cancellation rate (% of accepted rides this driver later cancelled). '—' until 5+ accepted."
                data-testid="sort-cancellation"
              >
                Cancel
                {sortBy === "cancellation" ? (
                  sortDir === "asc" ? (
                    <ArrowUp className="w-3 h-3" />
                  ) : (
                    <ArrowDown className="w-3 h-3" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />
                )}
              </button>
            </TableHead>
            <SortableHeader sortKey="walletBalance" sort={drvSort} onSortChange={setDrvSort}>
              Wallet
            </SortableHeader>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={drvPage}
            setPage={setDrvPage}
            total={drvTotal}
            pageSize={DRIVER_PAGE_SIZE}
            itemLabel="drivers"
          />
        }
      >
        {drvPaged.map((d) => (
                <TableRow key={d.id} data-testid={`row-driver-${d.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {d.photoUrl ? (
                        <img
                          src={d.photoUrl}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0 border"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
                          {(d.firstName?.[0] ?? "?").toUpperCase()}
                        </div>
                      )}
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setOpenDriverId(d.id)}
                        data-testid={`button-open-${d.id}`}
                      >
                        <div className="font-medium">
                          {d.firstName} {d.lastName || ""}
                        </div>
                        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <span>
                            ★ {d.rating.toFixed(2)} · {d.trips} trips
                          </span>
                          {ratingsDegraded && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="inline-flex items-center text-amber-600"
                                  data-testid={`icon-rating-stale-${d.id}`}
                                  aria-label="Rating may be stale"
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Stored fallback rating — live ratings couldn't
                                be computed and this value may be stale.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{d.phone}</TableCell>
                  <TableCell>
                    {d.vehicle ? (
                      <div className="text-sm">
                        <div>
                          {d.vehicle.color} {d.vehicle.year} {d.vehicle.make} {d.vehicle.model}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {d.vehicle.plate}
                        </div>
                        {(d.vehicle.vehicleTypeName || d.vehicle.zoneName) && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {[d.vehicle.vehicleTypeName, d.vehicle.zoneName]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge s={d.driverStatus} />
                  </TableCell>
                  <TableCell>
                    {d.driverOnline ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Online
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">Offline</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`cell-acceptance-${d.id}`}>
                    <RateCell
                      value={d.acceptanceRate}
                      sample={d.acceptanceSampleSize}
                      kind="acceptance"
                      lowThreshold={LOW_ACCEPTANCE}
                      highThreshold={HIGH_CANCELLATION}
                    />
                  </TableCell>
                  <TableCell data-testid={`cell-cancellation-${d.id}`}>
                    <RateCell
                      value={d.cancellationRate}
                      sample={d.cancellationSampleSize}
                      kind="cancellation"
                      lowThreshold={LOW_ACCEPTANCE}
                      highThreshold={HIGH_CANCELLATION}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono">
                      {d.walletBalanceDisplay
                        ? `${d.walletBalanceDisplay.displaySymbol}${d.walletBalanceDisplay.displayAmount.toFixed(2)}`
                        : formatAmount(parseFloat(d.walletBalance ?? "0"), displayCurrency.code)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end flex-wrap">
                      {d.driverStatus === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRejectDriverId(d.id); setRejectDriverReason(""); }}
                            disabled={reject.isPending}
                            data-testid={`button-reject-${d.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => approve.mutate(d.id)}
                            disabled={approve.isPending}
                            data-testid={`button-approve-${d.id}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                        </>
                      )}
                      {d.driverStatus === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSuspendDriverId(d.id); setSuspendDriverReason(""); }}
                          disabled={suspend.isPending}
                          data-testid={`button-suspend-${d.id}`}
                        >
                          <Ban className="w-4 h-4 mr-1" />
                          Suspend
                        </Button>
                      )}
                      {(d.driverStatus === "rejected" || d.driverStatus === "suspended") && (
                        <Button
                          size="sm"
                          onClick={() => approve.mutate(d.id)}
                          disabled={approve.isPending}
                          data-testid={`button-reapprove-${d.id}`}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpenDriverId(d.id)}
                        data-testid={`button-edit-${d.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDeleteId(d.id)}
                        data-testid={`button-delete-${d.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
      </DataTable>

      {openDriverId && (
        <DriverDetailDialog
          key={openDriverId}
          driverId={openDriverId}
          onClose={() => setOpenDriverId(null)}
          onChanged={invalidate}
          onDelete={(id) => setConfirmDeleteId(id)}
        />
      )}

      {showCreate && (
        <CreateDriverDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            invalidate();
          }}
        />
      )}

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this driver?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the user account, their vehicle, and any history. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId && remove.mutate(confirmDeleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!rejectDriverId}
        onOpenChange={(o) => {
          if (!o) {
            setRejectDriverId(null);
            setRejectDriverReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject driver</AlertDialogTitle>
            <AlertDialogDescription>
              Optionally provide a reason for rejection. This will be included in the notification sent to the driver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              placeholder="Reason (optional)"
              value={rejectDriverReason}
              onChange={(e) => setRejectDriverReason(e.target.value)}
              data-testid="input-reject-driver-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!rejectDriverId) return;
                reject.mutate({ id: rejectDriverId, reason: rejectDriverReason.trim() || undefined });
                setRejectDriverId(null);
                setRejectDriverReason("");
              }}
              data-testid="button-confirm-reject-driver"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!suspendDriverId}
        onOpenChange={(o) => {
          if (!o) {
            setSuspendDriverId(null);
            setSuspendDriverReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend driver</AlertDialogTitle>
            <AlertDialogDescription>
              Optionally provide a reason for suspension. This will be included in the notification sent to the driver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              placeholder="Reason (optional)"
              value={suspendDriverReason}
              onChange={(e) => setSuspendDriverReason(e.target.value)}
              data-testid="input-suspend-driver-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!suspendDriverId) return;
                suspend.mutate({ id: suspendDriverId, reason: suspendDriverReason.trim() || undefined });
                setSuspendDriverId(null);
                setSuspendDriverReason("");
              }}
              data-testid="button-confirm-suspend-driver"
            >
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DriverDetailDialog({
  driverId,
  onClose,
  onChanged,
  onDelete,
}: {
  driverId: string;
  onClose: () => void;
  onChanged: () => void;
  onDelete: (id: string) => void;
}) {
  const qc = useQueryClient();
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const { data, isLoading } = useQuery({
    queryKey: ["/admin/drivers", driverId],
    queryFn: () => api<{ driver: DriverDetail }>(`/admin/drivers/${driverId}`),
  });
  const d = data?.driver;

  const { data: vtData } = useQuery({
    queryKey: ["/admin/vehicle-types"],
    queryFn: () => api<{ vehicleTypes: VehicleTypeSummary[] }>(`/admin/vehicle-types`),
  });
  const vehicleTypes = vtData?.vehicleTypes ?? [];

  const { data: saData } = useQuery({
    queryKey: ["/admin/service-areas"],
    queryFn: () => api<{ serviceAreas: ServiceAreaSummary[] }>(`/admin/service-areas`),
  });
  const serviceAreas = saData?.serviceAreas ?? [];

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle>(EMPTY_VEHICLE);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [detailTab, setDetailTab] = useState<
    "details" | "history" | "wallet" | "withdrawals"
  >("details");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");
  const [topupError, setTopupError] = useState<string | null>(null);
  const [exemptionDuration, setExemptionDuration] = useState<"1m" | "3m" | "6m">("1m");
  const [walletPage, setWalletPage] = useState(1);
  const [withdrawalsPage, setWithdrawalsPage] = useState(1);
  useEffect(() => {
    setWithdrawalsPage(1);
    setWalletPage(1);
  }, [driverId]);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [newDocType, setNewDocType] = useState<string>("");
  const [rejectDialogDocType, setRejectDialogDocType] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmForceOffline, setConfirmForceOffline] = useState(false);
  const [confirmSwitchToRider, setConfirmSwitchToRider] = useState(false);
  const [dmDisableDuration, setDmDisableDuration] = useState<"1" | "7" | "30">(
    "7",
  );
  const [dmDisableReason, setDmDisableReason] = useState("");

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["/admin/drivers", driverId, "status-history"],
    queryFn: () =>
      api<{ history: StatusHistoryEntry[] }>(
        `/admin/drivers/${driverId}/status-history`,
      ),
    enabled: detailTab === "history",
  });

  const { data: withdrawalsData, isLoading: withdrawalsLoading } = useQuery({
    queryKey: ["/admin/drivers", driverId, "withdrawals", withdrawalsPage],
    queryFn: () =>
      api<{
        withdrawals: WithdrawalRow[];
        page: number;
        limit: number;
        total: number;
      }>(
        `/admin/drivers/${driverId}/withdrawals?page=${withdrawalsPage}`,
      ),
    enabled: detailTab === "withdrawals",
  });

  const { data: walletTxData, isLoading: walletTxLoading } = useQuery({
    queryKey: ["/admin/drivers", driverId, "wallet", walletPage],
    queryFn: () =>
      api<{ transactions: WalletTransaction[]; page: number; limit: number }>(
        `/admin/drivers/${driverId}/wallet/transactions?page=${walletPage}`,
      ),
    enabled: detailTab === "wallet",
  });

  const topup = useMutation({
    mutationFn: ({ amount, note }: { amount: number; note?: string }) =>
      api<{ walletBalance: string }>(`/admin/drivers/${driverId}/wallet/topup`, {
        method: "POST",
        json: { amount, note },
      }),
    onSuccess: () => {
      setTopupAmount("");
      setTopupNote("");
      setTopupError(null);
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId, "wallet"] });
      toast({ title: "Wallet credited", description: "The driver's wallet has been topped up." });
    },
    onError: () => setTopupError("Failed to top up wallet. Please try again."),
  });

  const grantExemption = useMutation({
    mutationFn: (duration: "1m" | "3m" | "6m") =>
      api(`/admin/drivers/${driverId}/commission-exemption`, {
        method: "POST",
        json: { duration },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      toast({ title: "Commission-free period granted" });
    },
    onError: () => toast({ title: "Failed to grant exemption", variant: "destructive" }),
  });

  const revokeExemption = useMutation({
    mutationFn: () =>
      api(`/admin/drivers/${driverId}/commission-exemption`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      toast({ title: "Commission-free period revoked" });
    },
    onError: () => toast({ title: "Failed to revoke exemption", variant: "destructive" }),
  });

  const forceOffline = useMutation({
    mutationFn: () =>
      api(`/admin/drivers/${driverId}/force-offline`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      qc.invalidateQueries({ queryKey: ["/admin/drivers"] });
      toast({ title: "Driver forced offline", description: "The driver has been set to offline." });
    },
    onError: () => toast({ title: "Action failed", description: "Could not force the driver offline.", variant: "destructive" }),
  });

  const { data: dmStats } = useQuery<DestinationModeStats>({
    queryKey: ["/admin/drivers", driverId, "destination-mode-stats"],
    queryFn: () =>
      api<DestinationModeStats>(
        `/admin/drivers/${driverId}/destination-mode-stats`,
      ),
  });

  const disableDestinationMode = useMutation({
    mutationFn: ({
      durationDays,
      reason,
    }: {
      durationDays: number;
      reason?: string;
    }) =>
      api(`/admin/drivers/${driverId}/destination-mode/disable`, {
        method: "POST",
        json: { durationDays, ...(reason ? { reason } : {}) },
      }),
    onSuccess: () => {
      setDmDisableReason("");
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      qc.invalidateQueries({
        queryKey: ["/admin/drivers", driverId, "destination-mode-stats"],
      });
      toast({ title: "Destination mode disabled for this driver" });
    },
    onError: () =>
      toast({
        title: "Failed to disable destination mode",
        variant: "destructive",
      }),
  });

  const reenableDestinationMode = useMutation({
    mutationFn: () =>
      api(`/admin/drivers/${driverId}/destination-mode/disable`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      qc.invalidateQueries({
        queryKey: ["/admin/drivers", driverId, "destination-mode-stats"],
      });
      toast({ title: "Destination mode re-enabled" });
    },
    onError: () =>
      toast({
        title: "Failed to re-enable destination mode",
        variant: "destructive",
      }),
  });

  const switchToRider = useMutation({
    mutationFn: () =>
      api(`/admin/drivers/${driverId}/switch-to-rider`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      qc.invalidateQueries({ queryKey: ["/admin/drivers"] });
      toast({ title: "Switched to rider mode", description: "The driver's app mode has been set to rider." });
    },
    onError: () => toast({ title: "Action failed", description: "Could not switch the driver to rider mode.", variant: "destructive" }),
  });

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!d) return;
    setFirstName(d.firstName);
    setLastName(d.lastName);
    setVehicle(d.vehicle ?? EMPTY_VEHICLE);
  }, [d]);

  const vehicleCoreFieldsFilled =
    !!(vehicle.make && vehicle.model && vehicle.year && vehicle.color && vehicle.plate);

  const save = useMutation({
    mutationFn: () =>
      api(`/admin/drivers/${driverId}`, {
        method: "PATCH",
        json: {
          firstName,
          lastName,
          vehicleTypeId: vehicle.vehicleTypeId ?? null,
          zoneId: vehicle.zoneId ?? null,
          vehicle:
            vehicle.make && vehicle.model && vehicle.year && vehicle.color && vehicle.plate
              ? {
                  make: vehicle.make,
                  model: vehicle.model,
                  year: vehicle.year,
                  color: vehicle.color,
                  plate: vehicle.plate,
                }
              : undefined,
        },
      }),
    onSuccess: () => {
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      onChanged();
      toast({ title: "Driver updated", description: "Changes have been saved." });
      onClose();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 422) {
        setSaveError(
          e.message ||
            "Vehicle details (make, model, year, colour, plate) must be saved before assigning a category or zone.",
        );
      } else {
        setSaveError(e instanceof Error ? (e.message || "Could not save changes") : "Could not save changes");
      }
    },
  });

  const saveDocsMutation = useMutation({
    mutationFn: (docs: SubmittedDoc[]) =>
      api(`/admin/drivers/${driverId}`, {
        method: "PATCH",
        json: { submittedDocs: docs },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      onChanged();
    },
  });

  const docStatusMutation = useMutation({
    mutationFn: ({ docType, status, rejectionReason }: { docType: string; status: "approved" | "rejected"; rejectionReason?: string }) =>
      api(`/admin/drivers/${driverId}/documents/${encodeURIComponent(docType)}`, {
        method: "PATCH",
        json: { status, ...(rejectionReason ? { rejectionReason } : {}) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/drivers", driverId] });
      onChanged();
    },
  });

  const currentDocs: SubmittedDoc[] = d?.submittedDocuments ?? [];

  async function handleReplaceDoc(docType: string, file: File) {
    setUploadingDocType(docType);
    setUploadError(null);
    try {
      const { url, contentType } = await uploadFile(file);
      const updated = currentDocs.map((doc) =>
        doc.type === docType ? { type: docType, url, contentType } : doc,
      );
      await saveDocsMutation.mutateAsync(updated);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingDocType(null);
    }
  }

  async function handleAddDoc(docType: string, file: File) {
    setUploadingDocType(docType);
    setUploadError(null);
    try {
      const { url, contentType } = await uploadFile(file);
      const existing = currentDocs.find((d) => d.type === docType);
      let updated: SubmittedDoc[];
      if (existing) {
        updated = currentDocs.map((doc) =>
          doc.type === docType ? { type: docType, url, contentType } : doc,
        );
      } else {
        updated = [...currentDocs, { type: docType, url, contentType }];
      }
      await saveDocsMutation.mutateAsync(updated);
      setShowAddDoc(false);
      setNewDocType("");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingDocType(null);
    }
  }

  function handleViewDoc(doc: SubmittedDoc) {
    if (!doc.url) return;
    const isImage = doc.contentType
      ? doc.contentType.startsWith("image/")
      : isImageUrl(doc.url);
    if (isImage) {
      setLightboxUrl(doc.url);
    } else {
      window.open(doc.url, "_blank", "noopener,noreferrer");
    }
  }

  const existingDocTypes = new Set(currentDocs.map((d) => d.type));
  const availableNewDocTypes = ALL_DOC_TYPES.filter((t) => !existingDocTypes.has(t));

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Driver details</DialogTitle>
            <DialogDescription>
              View documents, edit driver info, and manage their account.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 border-b pb-2">
            <Button
              size="sm"
              variant={detailTab === "details" ? "default" : "ghost"}
              onClick={() => setDetailTab("details")}
              className="h-8"
            >
              Details
            </Button>
            <Button
              size="sm"
              variant={detailTab === "history" ? "default" : "ghost"}
              onClick={() => setDetailTab("history")}
              className="h-8"
            >
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              History
            </Button>
            <Button
              size="sm"
              variant={detailTab === "wallet" ? "default" : "ghost"}
              onClick={() => setDetailTab("wallet")}
              className="h-8"
            >
              <Wallet className="w-3.5 h-3.5 mr-1.5" />
              Wallet
            </Button>
            <Button
              size="sm"
              variant={detailTab === "withdrawals" ? "default" : "ghost"}
              onClick={() => setDetailTab("withdrawals")}
              className="h-8"
              data-testid="tab-withdrawals"
            >
              <Banknote className="w-3.5 h-3.5 mr-1.5" />
              Withdrawals
            </Button>
          </div>

          {isLoading || !d ? (
            <div className="text-muted-foreground py-6 text-center">Loading…</div>
          ) : detailTab === "withdrawals" ? (
            <div className="space-y-3 min-h-[200px]" data-testid="withdrawals-section">
              {withdrawalsLoading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
              ) : !withdrawalsData || withdrawalsData.withdrawals.length === 0 ? (
                <EmptyState
                  icon={Banknote}
                  title="No withdrawals yet"
                  description="This driver has not requested any withdrawals."
                />
              ) : (
                <>
                  <ol className="space-y-3">
                    {withdrawalsData.withdrawals.map((w) => {
                      const pm = w.payoutMethod;
                      const methodSummary =
                        pm.method === "bank"
                          ? `Bank · ${pm.bankName ?? "—"} · ${
                              pm.iban ?? pm.accountNumber ?? "—"
                            }`
                          : `Mobile money · ${pm.mobileProvider ?? "—"} · ${
                              pm.mobileNumber ?? "—"
                            }`;
                      const variant: "success" | "info" | "warning" | "danger" | "neutral" =
                        w.status === "paid"
                          ? "success"
                          : w.status === "approved"
                            ? "info"
                            : w.status === "pending"
                              ? "warning"
                              : w.status === "rejected"
                                ? "danger"
                                : "neutral";
                      return (
                        <li
                          key={w.id}
                          className="rounded-md border p-3 space-y-2"
                          data-testid={`row-withdrawal-${w.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-mono text-base font-semibold">
                                ${w.amount.toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Account: {pm.accountName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {methodSummary}
                              </div>
                            </div>
                            <SharedStatusBadge variant={variant} className="capitalize">
                              {w.status}
                            </SharedStatusBadge>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground/80">Requested:</span>{" "}
                              {new Date(w.requestedAt).toLocaleString()}
                            </div>
                            <div>
                              <span className="font-medium text-foreground/80">Decided:</span>{" "}
                              {w.decidedAt
                                ? new Date(w.decidedAt).toLocaleString()
                                : "—"}
                              {w.decidedByAdminName && (
                                <span> · by {w.decidedByAdminName}</span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium text-foreground/80">Paid:</span>{" "}
                              {w.paidAt
                                ? new Date(w.paidAt).toLocaleString()
                                : "—"}
                            </div>
                          </div>
                          {w.paymentReference && (
                            <div className="text-xs">
                              <span className="font-medium text-foreground/80">Reference:</span>{" "}
                              <span className="font-mono">{w.paymentReference}</span>
                            </div>
                          )}
                          {w.rejectionReason && (
                            <div className="text-xs text-destructive">
                              <span className="font-medium">Rejection reason:</span>{" "}
                              {w.rejectionReason}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex justify-between items-center text-xs text-muted-foreground pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={withdrawalsPage === 1}
                      onClick={() => setWithdrawalsPage((p) => p - 1)}
                    >
                      ← Previous
                    </Button>
                    <span>
                      Page {withdrawalsPage} ·{" "}
                      {withdrawalsData.total} total
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        withdrawalsPage * withdrawalsData.limit >=
                        withdrawalsData.total
                      }
                      onClick={() => setWithdrawalsPage((p) => p + 1)}
                    >
                      Next →
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : detailTab === "wallet" ? (
            <div className="space-y-6 min-h-[200px]">
              <div className="rounded-lg border p-4 bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Wallet Balance</p>
                  <p className="text-3xl font-bold font-mono">{d.walletBalanceDisplay
                    ? `${d.walletBalanceDisplay.displaySymbol}${d.walletBalanceDisplay.displayAmount.toFixed(2)}`
                    : formatAmount(parseFloat(d.walletBalance ?? "0"), displayCurrency.code)}</p>
                </div>
                <Wallet className="w-8 h-8 text-muted-foreground/40" />
              </div>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">COMMISSION-FREE PERIOD</h4>
                {d.activeCommissionExemption ? (
                  <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Active — no commission deductions</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(d.activeCommissionExemption.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                      {d.activeCommissionExemption.grantedByAdminName && ` · Granted by ${d.activeCommissionExemption.grantedByAdminName}`}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/5"
                      onClick={() => revokeExemption.mutate()}
                      disabled={revokeExemption.isPending}
                    >
                      <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
                      Revoke exemption
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <Label>Duration</Label>
                      <Select value={exemptionDuration} onValueChange={(v) => setExemptionDuration(v as "1m" | "3m" | "6m")}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1m">1 month</SelectItem>
                          <SelectItem value="3m">3 months</SelectItem>
                          <SelectItem value="6m">6 months</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => grantExemption.mutate(exemptionDuration)}
                      disabled={grantExemption.isPending}
                    >
                      <ShieldCheck className="w-4 h-4 mr-1.5" />
                      Grant commission-free period
                    </Button>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">TOP-UP WALLET</h4>
                <div className="flex gap-2 flex-wrap items-end">
                  <div>
                    <Label htmlFor="topup-amount">Amount ($)</Label>
                    <Input
                      id="topup-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-32"
                    />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <Label htmlFor="topup-note">Note (optional)</Label>
                    <Input
                      id="topup-note"
                      value={topupNote}
                      onChange={(e) => setTopupNote(e.target.value)}
                      placeholder="e.g. Manual credit"
                    />
                  </div>
                  <Button
                    onClick={() => {
                      const amount = parseFloat(topupAmount);
                      if (!Number.isFinite(amount) || amount <= 0) {
                        setTopupError("Enter a valid positive amount");
                        return;
                      }
                      topup.mutate({ amount, note: topupNote.trim() || undefined });
                    }}
                    disabled={topup.isPending}
                  >
                    <ArrowUpRight className="w-4 h-4 mr-1" />
                    {topup.isPending ? "Crediting…" : "Credit wallet"}
                  </Button>
                </div>
                {topupError && <p className="text-sm text-destructive">{topupError}</p>}
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">TRANSACTION HISTORY</h4>
                {walletTxLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
                ) : !walletTxData || walletTxData.transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No transactions yet.</p>
                ) : (
                  <>
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Ride</TableHead>
                            <TableHead>Note</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {walletTxData.transactions.map((tx) => (
                            <TableRow key={tx.id}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(tx.createdAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5 text-xs">
                                  {tx.amount < 0 ? (
                                    <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                                  ) : tx.amount > 0 ? (
                                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                  <span>{TX_LABEL[tx.type] ?? tx.type}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground">
                                {tx.rideId ? tx.rideId.slice(0, 8) + "…" : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                                {tx.note ?? "—"}
                              </TableCell>
                              <TableCell className={`text-right font-mono text-sm font-semibold ${tx.amount < 0 ? "text-destructive" : "text-emerald-600"}`}>
                                {tx.amount >= 0 ? "+" : ""}${Math.abs(tx.amount).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <Button size="sm" variant="ghost" disabled={walletPage === 1} onClick={() => setWalletPage((p) => p - 1)}>← Previous</Button>
                      <span>Page {walletPage}</span>
                      <Button size="sm" variant="ghost" disabled={walletTxData.transactions.length < walletTxData.limit} onClick={() => setWalletPage((p) => p + 1)}>Next →</Button>
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : detailTab === "history" ? (
            <div className="space-y-3 min-h-[200px]">
              {historyLoading ? (
                <div className="text-muted-foreground py-6 text-center text-sm">Loading history…</div>
              ) : !historyData || historyData.history.length === 0 ? (
                <div className="text-muted-foreground py-6 text-center text-sm">No status changes recorded yet.</div>
              ) : (
                <ol className="relative border-l border-border ml-3 space-y-4">
                  {historyData.history.map((entry) => (
                    <li key={entry.id} className="ml-5">
                      <span className="absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background ring-4 ring-background">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                      </span>
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        {entry.action === "force_offline" ? (
                          <SharedStatusBadge variant="warning">Forced Offline</SharedStatusBadge>
                        ) : entry.action === "switch_to_rider" ? (
                          <SharedStatusBadge variant="info">Switched to Rider Mode</SharedStatusBadge>
                        ) : (
                          <StatusBadge s={entry.status} />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                        {entry.adminName && (
                          <span className="text-xs text-muted-foreground">
                            · by {entry.adminName}
                          </span>
                        )}
                      </div>
                      {entry.reason && (
                        <p className="text-sm text-foreground/80 mt-0.5">{entry.reason}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">
                    {d.firstName} {d.lastName}
                  </div>
                  <div className="text-sm font-mono text-muted-foreground">{d.phone}</div>
                  <div
                    className="mt-1.5 flex items-center gap-2"
                    data-testid="driver-rating"
                  >
                    <RatingStars value={d.rating} />
                    <span className="text-sm font-semibold tabular-nums">
                      {d.rating.toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {d.trips} trips
                    </span>
                  </div>
                </div>
                <StatusBadge s={d.driverStatus} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="rounded-md border bg-muted/30 px-3 py-2.5"
                      data-testid="driver-acceptance-rate"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Acceptance rate
                      </div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums">
                        {d.acceptanceRate == null
                          ? "—"
                          : `${d.acceptanceRate.toFixed(1)}%`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.acceptanceBidCount} / {d.acceptanceSampleSize} dispatched
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Distinct rides this driver bid on, divided by ride requests
                    delivered to them. Hidden until at least 5 requests have
                    been dispatched.
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="rounded-md border bg-muted/30 px-3 py-2.5"
                      data-testid="driver-cancellation-rate"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Cancellation rate
                      </div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums">
                        {d.cancellationRate == null
                          ? "—"
                          : `${d.cancellationRate.toFixed(1)}%`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.cancellationDriverCount} / {d.cancellationSampleSize} accepted
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Rides this driver cancelled after accepting, divided by
                    rides they accepted. Hidden until they have accepted at
                    least 5 rides.
                  </TooltipContent>
                </Tooltip>
              </div>

              {d.driverStatus === "rejected" && d.driverRejectionReason && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-destructive mb-1">
                    Rejection reason
                  </p>
                  <p className="text-sm text-destructive/90">{d.driverRejectionReason}</p>
                </div>
              )}

              {d.driverStatus === "suspended" && d.driverSuspensionReason && (
                <div className="rounded-md border border-border bg-muted/50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Suspension reason
                  </p>
                  <p className="text-sm text-foreground/80">{d.driverSuspensionReason}</p>
                </div>
              )}

              <section>
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground mb-2">
                  SUBMITTED DOCUMENTS
                </h4>

                {uploadError && (
                  <p className="text-sm text-destructive mb-2">{uploadError}</p>
                )}

                {currentDocs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents submitted yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {currentDocs.map((doc) => {
                      const isUploading = uploadingDocType === doc.type;
                      const isStatusPending = docStatusMutation.isPending;
                      return (
                        <li
                          key={doc.type}
                          className="flex items-center gap-2 text-sm bg-muted/50 rounded-md px-3 py-2"
                          data-testid={`doc-${doc.type}`}
                        >
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="flex-1 truncate">
                            {DOC_LABELS[doc.type] ?? doc.type}
                          </span>
                          {doc.status === "approved" ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/10 text-emerald-700 border-emerald-300 shrink-0"
                            >
                              Approved
                            </Badge>
                          ) : doc.status === "rejected" ? (
                            <Badge
                              variant="outline"
                              className="bg-destructive/10 text-destructive border-destructive/30 shrink-0"
                              title={doc.rejectionReason ?? undefined}
                            >
                              Rejected
                            </Badge>
                          ) : doc.url ? (
                            <Badge
                              variant="outline"
                              className="bg-muted text-muted-foreground shrink-0"
                            >
                              Pending review
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-muted text-muted-foreground shrink-0"
                            >
                              No file
                            </Badge>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            disabled={!doc.url || isUploading}
                            title="Preview document"
                            onClick={() => handleViewDoc(doc)}
                            data-testid={`button-view-doc-${doc.type}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            disabled={!doc.url || isUploading || isStatusPending || doc.status === "approved"}
                            title="Approve document"
                            onClick={() => docStatusMutation.mutate({ docType: doc.type, status: "approved" })}
                            data-testid={`button-approve-doc-${doc.type}`}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={!doc.url || isUploading || isStatusPending || doc.status === "rejected"}
                            title="Reject document"
                            onClick={() => {
                              setRejectDialogDocType(doc.type);
                              setRejectReason("");
                            }}
                            data-testid={`button-reject-doc-${doc.type}`}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            disabled={isUploading}
                            title="Replace document"
                            onClick={() => {
                              if (replaceInputRef.current) {
                                replaceInputRef.current.dataset.doctype = doc.type;
                                replaceInputRef.current.value = "";
                                replaceInputRef.current.click();
                              }
                            }}
                            data-testid={`button-replace-doc-${doc.type}`}
                          >
                            {isUploading ? (
                              <span className="text-[10px] text-muted-foreground">…</span>
                            ) : (
                              <Pencil className="w-4 h-4" />
                            )}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    const docType = (e.target as HTMLInputElement).dataset.doctype ?? "";
                    if (file && docType) handleReplaceDoc(docType, file);
                  }}
                />

                <div className="mt-3">
                  {showAddDoc ? (
                    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Upload document</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => {
                            setShowAddDoc(false);
                            setNewDocType("");
                            setUploadError(null);
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Document type</Label>
                          <Select value={newDocType} onValueChange={setNewDocType}>
                            <SelectTrigger className="mt-1" data-testid="select-new-doc-type">
                              <SelectValue placeholder="Select type…" />
                            </SelectTrigger>
                            <SelectContent>
                              {(availableNewDocTypes.length > 0
                                ? availableNewDocTypes
                                : ALL_DOC_TYPES
                              ).map((t) => (
                                <SelectItem key={t} value={t}>
                                  {DOC_LABELS[t] ?? t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            disabled={!newDocType || !!uploadingDocType}
                            onClick={() => {
                              if (addInputRef.current) {
                                addInputRef.current.value = "";
                                addInputRef.current.click();
                              }
                            }}
                            data-testid="button-pick-doc-file"
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {uploadingDocType === newDocType ? "Uploading…" : "Choose file"}
                          </Button>
                        </div>
                      </div>
                      <input
                        ref={addInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file && newDocType) handleAddDoc(newDocType, file);
                        }}
                      />
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
                      onClick={() => {
                        setShowAddDoc(true);
                        setUploadError(null);
                        const defaultType =
                          availableNewDocTypes.length > 0
                            ? availableNewDocTypes[0]
                            : ALL_DOC_TYPES[0];
                        setNewDocType(defaultType);
                      }}
                      data-testid="button-add-document"
                    >
                      <Upload className="w-4 h-4 mr-1" />
                      Upload document
                    </Button>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
                  DESTINATION MODE
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Last 7 days</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {dmStats?.last7d.total ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      activations ·{" "}
                      {dmStats && dmStats.last7d.total > 0
                        ? `${dmStats.last7d.matched} matched (${(dmStats.last7d.matchRatePct ?? 0).toFixed(0)}%)`
                        : "no matches yet"}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Last 30 days</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {dmStats?.last30d.total ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      activations ·{" "}
                      {dmStats && dmStats.last30d.total > 0
                        ? `${dmStats.last30d.matched} matched (${(dmStats.last30d.matchRatePct ?? 0).toFixed(0)}%)`
                        : "no matches yet"}
                    </p>
                  </div>
                </div>

                {d.destinationModeDisabled ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <ShieldOff className="w-4 h-4 text-amber-700" />
                      <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        Destination mode disabled until{" "}
                        {new Date(
                          d.destinationModeDisabled.disabledUntil,
                        ).toLocaleString()}
                      </span>
                    </div>
                    {d.destinationModeDisabled.disabledReason && (
                      <p className="text-xs text-muted-foreground">
                        Reason: {d.destinationModeDisabled.disabledReason}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reenableDestinationMode.mutate()}
                      disabled={reenableDestinationMode.isPending}
                      data-testid="button-reenable-destination-mode"
                    >
                      Re-enable destination mode
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <Label>Disable for</Label>
                      <Select
                        value={dmDisableDuration}
                        onValueChange={(v) =>
                          setDmDisableDuration(v as "1" | "7" | "30")
                        }
                      >
                        <SelectTrigger
                          className="w-[140px]"
                          data-testid="select-dm-disable-duration"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 day</SelectItem>
                          <SelectItem value="7">7 days</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <Label htmlFor="dm-reason">Reason (optional)</Label>
                      <Input
                        id="dm-reason"
                        value={dmDisableReason}
                        placeholder="e.g. abuse of destination filter"
                        onChange={(e) => setDmDisableReason(e.target.value)}
                        data-testid="input-dm-disable-reason"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-amber-700 border-amber-400 hover:bg-amber-50"
                      onClick={() =>
                        disableDestinationMode.mutate({
                          durationDays: parseInt(dmDisableDuration, 10),
                          reason: dmDisableReason.trim() || undefined,
                        })
                      }
                      disabled={disableDestinationMode.isPending}
                      data-testid="button-disable-destination-mode"
                    >
                      <Navigation className="w-3.5 h-3.5 mr-1.5" />
                      Disable
                    </Button>
                  </div>
                )}
              </section>

              {(d.driverOnline || d.appMode === "driver") && (
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
                    ACCOUNT ACTIONS
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {d.driverOnline && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-amber-700 border-amber-400 hover:bg-amber-50"
                        onClick={() => setConfirmForceOffline(true)}
                        disabled={forceOffline.isPending}
                        data-testid="button-force-offline"
                      >
                        <ShieldOff className="w-4 h-4 mr-1.5" />
                        Force Offline
                      </Button>
                    )}
                    {d.appMode === "driver" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmSwitchToRider(true)}
                        disabled={switchToRider.isPending}
                        data-testid="button-switch-to-rider"
                      >
                        <Clock className="w-4 h-4 mr-1.5" />
                        Switch to Rider Mode
                      </Button>
                    )}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
                  PROFILE
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      data-testid="input-edit-firstName"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      data-testid="input-edit-lastName"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
                  VEHICLE
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <VehicleField label="Make" value={vehicle.make} onChange={(v) => setVehicle({ ...vehicle, make: v })} />
                  <VehicleField label="Model" value={vehicle.model} onChange={(v) => setVehicle({ ...vehicle, model: v })} />
                  <VehicleField label="Year" value={vehicle.year} onChange={(v) => setVehicle({ ...vehicle, year: v })} />
                  <VehicleField label="Color" value={vehicle.color} onChange={(v) => setVehicle({ ...vehicle, color: v })} />
                  <VehicleField
                    label="Plate"
                    value={vehicle.plate}
                    onChange={(v) => setVehicle({ ...vehicle, plate: v.toUpperCase() })}
                  />
                  <div>
                    <Label>Vehicle Category</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block">
                          <Select
                            disabled={!vehicleCoreFieldsFilled}
                            value={vehicle.vehicleTypeId ?? "none"}
                            onValueChange={(val) =>
                              setVehicle({ ...vehicle, vehicleTypeId: val === "none" ? null : val })
                            }
                          >
                            <SelectTrigger data-testid="select-vehicle-type">
                              <SelectValue placeholder="Select category…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— None —</SelectItem>
                              {vehicleTypes.map((vt) => (
                                <SelectItem key={vt.id} value={vt.id}>
                                  {vt.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </span>
                      </TooltipTrigger>
                      {!vehicleCoreFieldsFilled && (
                        <TooltipContent>Fill in vehicle details first</TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                  <div>
                    <Label>Operating Zone</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block">
                          <Select
                            disabled={!vehicleCoreFieldsFilled}
                            value={vehicle.zoneId ?? "none"}
                            onValueChange={(val) =>
                              setVehicle({ ...vehicle, zoneId: val === "none" ? null : val })
                            }
                          >
                            <SelectTrigger data-testid="select-zone">
                              <SelectValue placeholder="Select zone…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— None —</SelectItem>
                              {serviceAreas.map((sa) => (
                                <SelectItem key={sa.id} value={sa.id}>
                                  {sa.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </span>
                      </TooltipTrigger>
                      {!vehicleCoreFieldsFilled && (
                        <TooltipContent>Fill in vehicle details first</TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                </div>
              </section>
            </div>
          )}

          {saveError && (
            <p className="text-sm text-destructive px-1" data-testid="save-error">
              {saveError}
            </p>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(driverId)}
              data-testid="button-delete-from-dialog"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete driver
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || !d}
                data-testid="button-save-driver"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!rejectDialogDocType}
        onOpenChange={(o) => {
          if (!o) {
            setRejectDialogDocType(null);
            setRejectReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject document</AlertDialogTitle>
            <AlertDialogDescription>
              Optionally explain why this document was rejected. The driver may be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              placeholder="Reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              data-testid="input-reject-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!rejectDialogDocType) return;
                docStatusMutation.mutate({
                  docType: rejectDialogDocType,
                  status: "rejected",
                  rejectionReason: rejectReason.trim() || undefined,
                });
                setRejectDialogDocType(null);
                setRejectReason("");
              }}
              data-testid="button-confirm-reject-doc"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmForceOffline} onOpenChange={(o) => !o && setConfirmForceOffline(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force driver offline?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately set the driver as offline. They will no longer receive new ride requests and will be notified on their device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmForceOffline(false);
                forceOffline.mutate();
              }}
              data-testid="button-confirm-force-offline"
            >
              Force Offline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSwitchToRider} onOpenChange={(o) => !o && setConfirmSwitchToRider(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch driver to rider mode?</AlertDialogTitle>
            <AlertDialogDescription>
              This will switch the driver's app to rider mode and set them offline. They will be redirected to the rider flow on their device and notified of the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSwitchToRider(false);
                switchToRider.mutate();
              }}
              data-testid="button-confirm-switch-to-rider"
            >
              Switch to Rider Mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
          data-testid="lightbox-overlay"
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white hover:text-gray-300"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close preview"
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={lightboxUrl}
            alt="Document preview"
            className="max-w-[90vw] max-h-[90vh] rounded-md object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function VehicleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`input-vehicle-${label.toLowerCase()}`}
      />
    </div>
  );
}

function CreateDriverDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [approve, setApprove] = useState(true);
  const [vehicle, setVehicle] = useState<Vehicle>(EMPTY_VEHICLE);
  const [error, setError] = useState<string | null>(null);

  const { data: vtData } = useQuery({
    queryKey: ["/admin/vehicle-types"],
    queryFn: () => api<{ vehicleTypes: VehicleTypeSummary[] }>(`/admin/vehicle-types`),
  });
  const vehicleTypes = vtData?.vehicleTypes ?? [];

  const { data: saData } = useQuery({
    queryKey: ["/admin/service-areas"],
    queryFn: () => api<{ serviceAreas: ServiceAreaSummary[] }>(`/admin/service-areas`),
  });
  const serviceAreas = saData?.serviceAreas ?? [];

  const vehicleCoreFieldsFilled =
    vehicle.make.trim() !== "" &&
    vehicle.model.trim() !== "" &&
    vehicle.year.trim() !== "" &&
    vehicle.color.trim() !== "" &&
    vehicle.plate.trim() !== "";

  const create = useMutation({
    mutationFn: () =>
      api(`/admin/drivers`, {
        method: "POST",
        json: {
          phone,
          firstName,
          lastName,
          approve,
          vehicleTypeId: vehicle.vehicleTypeId ?? null,
          zoneId: vehicle.zoneId ?? null,
          vehicle:
            vehicle.make && vehicle.model && vehicle.year && vehicle.color && vehicle.plate
              ? {
                  make: vehicle.make,
                  model: vehicle.model,
                  year: vehicle.year,
                  color: vehicle.color,
                  plate: vehicle.plate,
                }
              : undefined,
        },
      }),
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message ?? "Could not create driver"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add driver</DialogTitle>
          <DialogDescription>
            Create a driver account directly. Skip the OTP flow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="newFirst">First name</Label>
              <Input
                id="newFirst"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex"
                data-testid="input-create-firstName"
              />
            </div>
            <div>
              <Label htmlFor="newLast">Last name</Label>
              <Input
                id="newLast"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Driver"
                data-testid="input-create-lastName"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="newPhone">Phone</Label>
            <Input
              id="newPhone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15555550123"
              data-testid="input-create-phone"
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
              VEHICLE (OPTIONAL)
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <VehicleField label="Make" value={vehicle.make} onChange={(v) => setVehicle({ ...vehicle, make: v })} />
              <VehicleField label="Model" value={vehicle.model} onChange={(v) => setVehicle({ ...vehicle, model: v })} />
              <VehicleField label="Year" value={vehicle.year} onChange={(v) => setVehicle({ ...vehicle, year: v })} />
              <VehicleField label="Color" value={vehicle.color} onChange={(v) => setVehicle({ ...vehicle, color: v })} />
              <VehicleField
                label="Plate"
                value={vehicle.plate}
                onChange={(v) => setVehicle({ ...vehicle, plate: v.toUpperCase() })}
              />
              <div>
                <Label>Vehicle Category</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <Select
                        disabled={!vehicleCoreFieldsFilled}
                        value={vehicle.vehicleTypeId ?? "none"}
                        onValueChange={(val) =>
                          setVehicle({ ...vehicle, vehicleTypeId: val === "none" ? null : val })
                        }
                      >
                        <SelectTrigger data-testid="select-create-vehicle-type">
                          <SelectValue placeholder="Select category…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— None —</SelectItem>
                          {vehicleTypes.map((vt) => (
                            <SelectItem key={vt.id} value={vt.id}>
                              {vt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  </TooltipTrigger>
                  {!vehicleCoreFieldsFilled && (
                    <TooltipContent>Fill in vehicle details first</TooltipContent>
                  )}
                </Tooltip>
              </div>
              <div>
                <Label>Operating Zone</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <Select
                        disabled={!vehicleCoreFieldsFilled}
                        value={vehicle.zoneId ?? "none"}
                        onValueChange={(val) =>
                          setVehicle({ ...vehicle, zoneId: val === "none" ? null : val })
                        }
                      >
                        <SelectTrigger data-testid="select-create-zone">
                          <SelectValue placeholder="Select zone…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— None —</SelectItem>
                          {serviceAreas.map((sa) => (
                            <SelectItem key={sa.id} value={sa.id}>
                              {sa.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  </TooltipTrigger>
                  {!vehicleCoreFieldsFilled && (
                    <TooltipContent>Fill in vehicle details first</TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={approve}
              onChange={(e) => setApprove(e.target.checked)}
              data-testid="checkbox-approve"
            />
            Approve immediately (driver can go online right away)
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              create.mutate();
            }}
            disabled={create.isPending || !phone || !firstName}
            data-testid="button-confirm-create"
          >
            {create.isPending ? "Creating…" : "Create driver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
