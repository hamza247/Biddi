import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  RefreshCw,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Star,
  Search,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from "lucide-react";
import { formatCurrency } from "@/lib/use-display-currency";
import { CurrencyFormDialog, type CurrencyFormValues } from "./CurrencyFormDialog";

interface Currency {
  code: string;
  name: string;
  symbol: string;
  rateFromUsd: number | null;
  lastUpdatedAt: string | null;
  isActive: boolean;
  isDefault: boolean;
  decimalPlaces: number;
  symbolPosition: "before" | "after";
  thousandsSeparator: "comma" | "dot" | "space";
  decimalSeparator: "dot" | "comma";
  sortOrder: number;
}

interface ListResponse {
  currencies: Currency[];
  defaultCode: string;
}

interface RefreshResponse extends ListResponse {
  updated: number;
  fetchedAt: string | null;
  error: string | null;
  errorMessage: string | null;
}

interface SingleResponse {
  currency: Currency;
  isCodeLocked: boolean;
}

function formatRate(rate: number | null): string {
  if (rate == null) return "—";
  return rate.toFixed(4);
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type StatusFilter = "all" | "active" | "inactive";

export function CurrencyTab() {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["/admin/currencies"] as const, []);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey,
    queryFn: () => api<ListResponse>("/admin/currencies"),
  });

  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingLocked, setEditingLocked] = useState(false);
  const [deleteCode, setDeleteCode] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: async (input: { code: string; isActive: boolean }) => {
      setPendingCode(input.code);
      return api<{ currency: Currency }>(`/admin/currencies/${input.code}`, {
        method: "PATCH",
        json: { isActive: input.isActive },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Currency updated" });
    },
    onError: (err: ApiError) => {
      toast({
        title: "Failed to update",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setPendingCode(null),
  });

  const refresh = useMutation({
    mutationFn: () =>
      api<RefreshResponse>("/admin/currencies/refresh", { method: "POST" }),
    onSuccess: (resp) => {
      qc.setQueryData(queryKey, {
        currencies: resp.currencies,
        defaultCode: resp.defaultCode,
      });
      if (resp.error) {
        toast({
          title: "Refresh failed",
          description: resp.errorMessage ?? "Refresh failed. Previous rates were kept.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Rates refreshed",
          description: `${resp.updated} currencies updated.`,
        });
      }
    },
    onError: (err: ApiError) => {
      toast({
        title: "Refresh failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const create = useMutation({
    mutationFn: (values: CurrencyFormValues) =>
      api<{ currency: Currency }>("/admin/currencies", {
        method: "POST",
        json: {
          code: values.code,
          name: values.name,
          symbol: values.symbol,
          rateFromUsd: Number(values.rateFromUsd),
          isActive: values.isActive,
          decimalPlaces: values.decimalPlaces,
          symbolPosition: values.symbolPosition,
          thousandsSeparator: values.thousandsSeparator,
          decimalSeparator: values.decimalSeparator,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Currency added" });
      setFormOpen(false);
    },
    onError: (err: ApiError) => {
      toast({
        title: "Could not add currency",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const update = useMutation({
    mutationFn: (input: { code: string; values: CurrencyFormValues }) => {
      const body: Record<string, unknown> = {
        name: input.values.name,
        symbol: input.values.symbol,
        isActive: input.values.isActive,
        decimalPlaces: input.values.decimalPlaces,
        symbolPosition: input.values.symbolPosition,
        thousandsSeparator: input.values.thousandsSeparator,
        decimalSeparator: input.values.decimalSeparator,
      };
      // Allow renaming the code as part of an edit. The server enforces
      // the lock rules (USD / current default / referenced rows) and
      // uniqueness; the URL param remains the *original* code so the
      // server can find the row.
      if (
        input.values.code &&
        input.values.code !== input.code &&
        input.code !== "USD"
      ) {
        body.code = input.values.code;
      }
      if (input.code !== "USD") {
        body.rateFromUsd = Number(input.values.rateFromUsd);
      }
      return api<{ currency: Currency }>(`/admin/currencies/${input.code}`, {
        method: "PATCH",
        json: body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Currency updated" });
      setFormOpen(false);
    },
    onError: (err: ApiError) => {
      toast({
        title: "Could not update currency",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setDefault = useMutation({
    mutationFn: (code: string) =>
      api<ListResponse & { currency: Currency }>(
        `/admin/currencies/${code}/set-default`,
        { method: "PATCH" },
      ),
    onSuccess: (resp) => {
      qc.setQueryData(queryKey, {
        currencies: resp.currencies,
        defaultCode: resp.defaultCode,
      });
      // Public config drives the rest of admin's currency display, so
      // bust it too.
      qc.invalidateQueries({ queryKey: ["/config/public"] });
      toast({ title: `${resp.defaultCode} is now the default currency` });
    },
    onError: (err: ApiError) => {
      toast({
        title: "Could not set default",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const reorder = useMutation({
    mutationFn: (codes: string[]) =>
      api<ListResponse>("/admin/currencies/reorder", {
        method: "PATCH",
        json: { codes },
      }),
    onMutate: async (codes) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<ListResponse>(queryKey);
      if (previous) {
        const order = new Map(codes.map((c, i) => [c, i] as const));
        const next: ListResponse = {
          ...previous,
          currencies: [...previous.currencies]
            .map((c) => ({ ...c, sortOrder: order.get(c.code) ?? c.sortOrder }))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        };
        qc.setQueryData(queryKey, next);
      }
      return { previous };
    },
    onError: (err: ApiError, _codes, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast({
        title: "Could not reorder currencies",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: (resp) => {
      qc.setQueryData(queryKey, resp);
      qc.invalidateQueries({ queryKey: ["/config/public"] });
    },
  });

  const remove = useMutation({
    mutationFn: (code: string) =>
      api<{ ok: boolean }>(`/admin/currencies/${code}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Currency deleted" });
      setDeleteCode(null);
    },
    onError: (err: ApiError) => {
      toast({
        title: "Could not delete currency",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const currencies = data?.currencies ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currencies.filter((c) => {
      if (statusFilter === "active" && !c.isActive) return false;
      if (statusFilter === "inactive" && c.isActive) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
      );
    });
  }, [currencies, search, statusFilter]);

  const [editInitial, setEditInitial] = useState<
    Partial<CurrencyFormValues> | undefined
  >(undefined);

  async function openEdit(code: string) {
    try {
      const resp = await api<SingleResponse>(`/admin/currencies/${code}`);
      setFormMode("edit");
      setEditingCode(code);
      setEditingLocked(resp.isCodeLocked);
      setEditInitial({
        code: resp.currency.code,
        name: resp.currency.name,
        symbol: resp.currency.symbol,
        rateFromUsd:
          resp.currency.rateFromUsd != null
            ? String(resp.currency.rateFromUsd)
            : "",
        decimalPlaces: resp.currency.decimalPlaces,
        symbolPosition: resp.currency.symbolPosition,
        thousandsSeparator: resp.currency.thousandsSeparator,
        decimalSeparator: resp.currency.decimalSeparator,
        isActive: resp.currency.isActive,
      });
      setFormOpen(true);
    } catch (err) {
      toast({
        title: "Could not load currency",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    }
  }

  function openCreate() {
    setFormMode("create");
    setEditingCode(null);
    setEditingLocked(false);
    setEditInitial(undefined);
    setFormOpen(true);
  }

  const deleteTarget = currencies.find((c) => c.code === deleteCode) ?? null;

  // Reordering only makes sense against the full, unfiltered list — a
  // search/filter could hide rows and any "move down" would skip past
  // them. We disable the controls (and drag handle) while filters are
  // active so the persisted order can never go out of sync with what
  // the operator sees.
  const reorderEnabled =
    statusFilter === "all" &&
    search.trim() === "" &&
    currencies.length > 1 &&
    !reorder.isPending;
  const [dragCode, setDragCode] = useState<string | null>(null);

  function moveCurrency(code: string, direction: -1 | 1) {
    const idx = currencies.findIndex((c) => c.code === code);
    if (idx === -1) return;
    const target = idx + direction;
    if (target < 0 || target >= currencies.length) return;
    const next = currencies.map((c) => c.code);
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate(next);
  }

  function handleDrop(targetCode: string) {
    const source = dragCode;
    setDragCode(null);
    if (!source || source === targetCode) return;
    const codes = currencies.map((c) => c.code);
    const from = codes.indexOf(source);
    const to = codes.indexOf(targetCode);
    if (from === -1 || to === -1) return;
    codes.splice(from, 1);
    codes.splice(to, 0, source);
    reorder.mutate(codes);
  }

  return (
    <div className="space-y-6" data-testid="currency-tab">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Currency Management</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            All money is stored internally in USD and converted to the display
            currency at render time. Add, edit, or delete currencies, and
            choose which one is the platform default. USD is the canonical
            base and cannot be removed or deactivated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            data-testid="button-refresh-rates"
          >
            {refresh.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Update Now
          </Button>
          <Button
            type="button"
            onClick={openCreate}
            data-testid="button-add-currency"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Currency
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or name…"
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium w-8" aria-label="Reorder" />
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-4 py-2 font-medium">Rate (per 1 USD)</th>
                <th className="px-4 py-2 font-medium">Sample</th>
                <th className="px-4 py-2 font-medium">Last updated</th>
                <th className="px-4 py-2 font-medium">Default</th>
                <th className="px-4 py-2 font-medium">Active</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                    {currencies.length === 0
                      ? "No currencies seeded yet."
                      : "No currencies match the current filters."}
                  </td>
                </tr>
              ) : (
                <TooltipProvider>
                  {filtered.map((c, visibleIdx) => {
                    const isUsd = c.code === "USD";
                    const isPending = pendingCode === c.code && toggle.isPending;
                    const fullIdx = currencies.findIndex(
                      (x) => x.code === c.code,
                    );
                    const isFirst = fullIdx === 0;
                    const isLast = fullIdx === currencies.length - 1;
                    return (
                      <tr
                        key={c.code}
                        className={`border-t border-border ${
                          dragCode === c.code ? "opacity-50" : ""
                        }`}
                        data-testid={`row-currency-${c.code}`}
                        onDragOver={(e) => {
                          if (reorderEnabled && dragCode) e.preventDefault();
                        }}
                        onDrop={() => reorderEnabled && handleDrop(c.code)}
                      >
                        <td className="px-2 py-3 align-middle">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                draggable={reorderEnabled}
                                onDragStart={() => setDragCode(c.code)}
                                onDragEnd={() => setDragCode(null)}
                                className={`inline-flex items-center justify-center text-muted-foreground ${
                                  reorderEnabled
                                    ? "cursor-grab active:cursor-grabbing"
                                    : "cursor-not-allowed opacity-40"
                                }`}
                                data-testid={`drag-handle-${c.code}`}
                                aria-label={`Drag ${c.code} to reorder`}
                              >
                                <GripVertical className="w-4 h-4" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {reorderEnabled
                                ? "Drag to reorder, or use the arrows in Actions"
                                : "Clear search and status filter to reorder"}
                            </TooltipContent>
                          </Tooltip>
                          <span className="sr-only">
                            Position {visibleIdx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">{c.code}</td>
                        <td className="px-4 py-3">{c.name}</td>
                        <td className="px-4 py-3">{c.symbol}</td>
                        <td className="px-4 py-3" data-testid={`rate-${c.code}`}>
                          {formatRate(c.rateFromUsd)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatCurrency(1234.5, c)}
                        </td>
                        <td
                          className="px-4 py-3 text-muted-foreground"
                          title={formatTimestamp(c.lastUpdatedAt)}
                        >
                          {formatRelative(c.lastUpdatedAt)}
                        </td>
                        <td className="px-4 py-3">
                          {c.isDefault ? (
                            <Badge data-testid={`badge-default-${c.code}`}>
                              Default
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className="inline-flex items-center gap-2"
                            title={
                              isUsd
                                ? "USD is the base currency and cannot be deactivated."
                                : c.isDefault
                                  ? "Set another currency as default before deactivating this one."
                                  : undefined
                            }
                          >
                            {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                            <Switch
                              checked={c.isActive}
                              disabled={isUsd || c.isDefault || isPending}
                              onCheckedChange={(v) =>
                                toggle.mutate({ code: c.code, isActive: v })
                              }
                              data-testid={`toggle-${c.code}`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={
                                      !reorderEnabled ||
                                      isFirst ||
                                      reorder.isPending
                                    }
                                    onClick={() => moveCurrency(c.code, -1)}
                                    data-testid={`button-move-up-${c.code}`}
                                    aria-label={`Move ${c.code} up`}
                                  >
                                    <ArrowUp className="w-4 h-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {!reorderEnabled
                                  ? "Clear search and status filter to reorder"
                                  : isFirst
                                    ? "Already first"
                                    : "Move up"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={
                                      !reorderEnabled ||
                                      isLast ||
                                      reorder.isPending
                                    }
                                    onClick={() => moveCurrency(c.code, 1)}
                                    data-testid={`button-move-down-${c.code}`}
                                    aria-label={`Move ${c.code} down`}
                                  >
                                    <ArrowDown className="w-4 h-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {!reorderEnabled
                                  ? "Clear search and status filter to reorder"
                                  : isLast
                                    ? "Already last"
                                    : "Move down"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={
                                      !c.isActive ||
                                      c.isDefault ||
                                      setDefault.isPending
                                    }
                                    onClick={() => setDefault.mutate(c.code)}
                                    data-testid={`button-set-default-${c.code}`}
                                  >
                                    <Star className="w-4 h-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {c.isDefault
                                  ? "Already the default"
                                  : !c.isActive
                                    ? "Activate this currency before making it the default"
                                    : "Set as platform default"}
                              </TooltipContent>
                            </Tooltip>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void openEdit(c.code)}
                              data-testid={`button-edit-${c.code}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={isUsd || c.isDefault}
                                    onClick={() => setDeleteCode(c.code)}
                                    data-testid={`button-delete-${c.code}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isUsd
                                  ? "USD cannot be deleted"
                                  : c.isDefault
                                    ? "Set another currency as default before deleting this one"
                                    : "Delete currency"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </TooltipProvider>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CurrencyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        initial={editInitial}
        codeLocked={editingLocked}
        hideRate={formMode === "edit" && editingCode === "USD"}
        saving={create.isPending || update.isPending}
        onSubmit={(values) => {
          if (formMode === "create") create.mutate(values);
          else if (editingCode) update.mutate({ code: editingCode, values });
        }}
      />

      <ConfirmDialog
        open={deleteCode != null}
        onOpenChange={(v) => !v && setDeleteCode(null)}
        title={`Delete ${deleteCode ?? "currency"}?`}
        description={
          deleteTarget ? (
            <>
              <strong>{deleteTarget.code}</strong> ({deleteTarget.name}) will be
              removed from every selector across admin. This can't be undone.
              If the currency has ever been used in a fare, payment, wallet, or
              transaction, the delete will be blocked — deactivate it instead.
            </>
          ) : (
            "This currency will be removed."
          )
        }
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleteCode && remove.mutate(deleteCode)}
      />
    </div>
  );
}
