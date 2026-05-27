import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useDisplayCurrency, useFormatCurrency } from "@/lib/use-display-currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  PlusCircle,
  Users as UsersIcon,
} from "lucide-react";
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
} from "@/components/admin";

interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  walletBalance: string;
  walletBalanceDisplay?: { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string } | null;
  isActive: boolean;
  phoneVerified: boolean;
  gender: string | null;
  country: string | null;
  city: string | null;
  photoUrl: string | null;
  appMode: "rider" | "driver";
  driverStatus: string;
  rating: number;
  trips: number;
  createdAt: string;
}

const PAGE_SIZE = 25;

function formatDate(iso: string) {
  const d = new Date(iso);
  const day = d.getDate().toString().padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" });
  const year = d.getFullYear();
  const dow = d.toLocaleString("en-US", { weekday: "short" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${mon}, ${year} (${dow})\nat ${time}`;
}

export default function UsersPage() {
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [creditTarget, setCreditTarget] = useState<UserRow | null>(null);
  const [creditAmount, setCreditAmount] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/admin/users"],
    queryFn: () => api<{ users: UserRow[] }>("/admin/users"),
    refetchInterval: 15000,
  });

  const banMut = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}/ban`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/users"] });
      toast.success("User banned / deactivated");
    },
    onError: () => toast.error("Action failed"),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}/activate`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/users"] });
      toast.success("User activated");
    },
    onError: () => toast.error("Action failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/users"] });
      setDeleteTarget(null);
      toast.success("User deleted");
    },
    onError: () => toast.error("Delete failed"),
  });

  const creditMut = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api(`/admin/users/${id}/credit`, { method: "POST", json: { amount } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/users"] });
      setCreditTarget(null);
      setCreditAmount("");
      toast.success("Balance credited successfully");
    },
    onError: () => toast.error("Failed to credit balance"),
  });

  const handleCredit = () => {
    const amt = parseFloat(creditAmount);
    if (!creditTarget || isNaN(amt) || amt <= 0) return;
    // The operator types the amount in the platform display currency, but
    // the wallet endpoint stores values in canonical USD. Convert back to
    // USD using the same rate the server uses to enrich envelopes so the
    // credited amount matches what the operator saw on screen.
    const amtUsd = Math.round((amt / displayCurrency.rate) * 100) / 100;
    creditMut.mutate({ id: creditTarget.id, amount: amtUsd });
  };

  const users = data?.users ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "rider" | "driver">("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"firstName" | "createdAt" | "walletBalance">({
    key: "createdAt",
    direction: "desc",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      if (roleFilter === "driver" && u.driverStatus !== "approved") return false;
      if (roleFilter === "rider" && u.driverStatus === "approved") return false;
      if (
        q &&
        !`${u.firstName} ${u.lastName} ${u.email ?? ""} ${u.phone}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [users, search, statusFilter, roleFilter]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (u, k) => {
        if (k === "createdAt") return new Date(u.createdAt);
        if (k === "walletBalance") return parseFloat(u.walletBalance ?? "0");
        return u[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = search !== "" || statusFilter !== "all" || roleFilter !== "all";
  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setRoleFilter("all");
    setPage(1);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1">All registered riders on Biddi</p>
        </div>
        <Button variant="outline" size="sm" className="font-semibold tracking-wide">
          EXPORT
        </Button>
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search by name, email, or phone…"
          className="sm:w-72"
        />
        <Select
          value={roleFilter}
          onValueChange={(v) => {
            setRoleFilter(v as "all" | "rider" | "driver");
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-[140px] h-9" data-testid="filter-user-role">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="rider">Riders</SelectItem>
            <SelectItem value="driver">Drivers</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as "all" | "active" | "inactive");
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-[140px] h-9" data-testid="filter-user-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
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
            icon={UsersIcon}
            title={hasFilters ? "No users match" : "No users yet"}
            description={
              hasFilters
                ? "Try adjusting your search or filters."
                : "Sign up in the mobile app to see users here."
            }
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="firstName" sort={sort} onSortChange={setSort} defaultDirection="asc">
              User Name
            </SortableHeader>
            <TableHead>Email</TableHead>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>
              Sign Up Date
            </SortableHeader>
            <TableHead>Mobile</TableHead>
            <SortableHeader sortKey="walletBalance" sort={sort} onSortChange={setSort}>
              Wallet Balance
            </SortableHeader>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="users"
          />
        }
      >
        {paged.map((u) => (
          <TableRow key={u.id} className="hover:bg-muted/20">
            <TableCell>
              <div className="flex items-center gap-3">
                {u.photoUrl ? (
                  <img
                    src={u.photoUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 border"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
                    {(u.firstName?.[0] ?? "?").toUpperCase()}
                  </div>
                )}
                <div>
                  <button
                    className="text-primary font-medium hover:underline text-sm leading-tight"
                    onClick={() => navigate(`/users/${u.id}/edit`)}
                  >
                    {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}
                  </button>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ★ {u.rating.toFixed(2)} · {u.trips} trips
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
              {formatDate(u.createdAt)}
            </TableCell>
            <TableCell className="text-sm font-mono">{u.phone}</TableCell>
            <TableCell>
              <div className="text-sm font-semibold text-foreground">
                {u.walletBalanceDisplay
                  ? `${u.walletBalanceDisplay.displaySymbol}${u.walletBalanceDisplay.displayAmount.toFixed(2)}`
                  : formatAmount(parseFloat(u.walletBalance ?? "0"), displayCurrency.code)}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-7 text-xs"
                onClick={() => {
                  setCreditTarget(u);
                  setCreditAmount("");
                }}
              >
                Add Balance
              </Button>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-center gap-1.5">
                <StatusBadge variant={u.isActive ? "success" : "neutral"}>
                  {u.isActive ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-center gap-1">
                <button
                  title="Set Active"
                  onClick={() => activateMut.mutate(u.id)}
                  disabled={activateMut.isPending}
                  className={`p-1 rounded-md transition-colors ${
                    u.isActive
                      ? "text-emerald-600"
                      : "text-muted-foreground/40 hover:text-emerald-500"
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5" />
                </button>
                <button
                  title="Deactivate"
                  onClick={() => banMut.mutate(u.id)}
                  disabled={banMut.isPending}
                  className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  <MinusCircle className="w-5 h-5" />
                </button>
                <button
                  title="Ban"
                  onClick={() => banMut.mutate(u.id)}
                  disabled={banMut.isPending}
                  className={`p-1 rounded-md transition-colors ${
                    !u.isActive
                      ? "text-destructive"
                      : "text-muted-foreground/40 hover:text-destructive"
                  }`}
                >
                  <XCircle className="w-5 h-5" />
                </button>
                <button
                  title="Edit user"
                  onClick={() => navigate(`/users/${u.id}/edit`)}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  title="Delete user"
                  onClick={() => setDeleteTarget(u)}
                  className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this user?"
        description={
          deleteTarget
            ? `This will permanently delete ${deleteTarget.firstName} ${deleteTarget.lastName} and all their data including rides, saved places, and wallet balance. This cannot be undone.`
            : ""
        }
        confirmLabel={deleteMut.isPending ? "Deleting…" : "Delete"}
        loading={deleteMut.isPending}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />

      <Dialog open={!!creditTarget} onOpenChange={(o) => !o && setCreditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-600" />
              Add Wallet Balance
            </DialogTitle>
            <DialogDescription>
              Credit{" "}
              <strong>
                {creditTarget?.firstName} {creditTarget?.lastName}
              </strong>
              's wallet. Current:{" "}
              <strong>{creditTarget?.walletBalanceDisplay
                ? `${creditTarget.walletBalanceDisplay.displaySymbol}${creditTarget.walletBalanceDisplay.displayAmount.toFixed(2)}`
                : formatAmount(parseFloat(creditTarget?.walletBalance ?? "0"), displayCurrency.code)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Amount ({displayCurrency.code})</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCredit()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleCredit}
              disabled={
                !creditAmount || parseFloat(creditAmount) <= 0 || creditMut.isPending
              }
            >
              {creditMut.isPending ? "Crediting…" : "Credit Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
