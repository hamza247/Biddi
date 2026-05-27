import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CheckCircle, XCircle, Eye, FileText } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
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

interface DriverApplication {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  driverStatus: string;
  createdAt: string;
  vehicle: {
    make: string;
    model: string;
    year: string;
    color: string;
    plate: string;
  } | null;
  documents: {
    id: string;
    type: string;
    fileUrl: string;
    status: string;
  }[];
}

const PAGE_SIZE = 25;

export default function DriverApplicationsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<DriverApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DriverApplication | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "driver-applications"],
    queryFn: () => api<{ drivers: DriverApplication[] }>("/admin/drivers?status=pending"),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(`/admin/drivers/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "driver-applications"] });
      toast({ title: "Driver approved" });
      setSelected(null);
    },
    onError: () => toast({ title: "Error approving driver", variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api(`/admin/drivers/${id}/reject`, { method: "POST", json: reason ? { reason } : {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "driver-applications"] });
      toast({ title: "Driver rejected" });
      setSelected(null);
      setRejectTarget(null);
      setRejectReason("");
    },
    onError: () => toast({ title: "Error rejecting driver", variant: "destructive" }),
  });

  const pending = data?.drivers ?? [];

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"createdAt" | "lastName">({
    key: "createdAt",
    direction: "desc",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter((d) =>
      `${d.firstName} ${d.lastName} ${d.phone} ${d.vehicle?.plate ?? ""}`.toLowerCase().includes(q),
    );
  }, [pending, search]);
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (d, k) => {
        if (k === "createdAt") return new Date(d.createdAt);
        return d[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">Driver Applications</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Pending driver sign-up approvals
          {pending.length > 0 && (
            <StatusBadge variant="warning" className="ml-2">{pending.length} pending</StatusBadge>
          )}
        </p>
      </div>

      <FilterBar hasActiveFilters={search !== ""} onClear={() => { setSearch(""); setPage(1); }}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by name, phone, or plate…"
          className="sm:w-72"
        />
      </FilterBar>

      <DataTable
        columnCount={7}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={FileText}
            title={search ? "No applications match" : "No pending applications"}
            description={
              search
                ? "Try adjusting your search."
                : "New driver applications will appear here for review."
            }
          />
        }
        header={
          <TableRow>
            <SortableHeader sortKey="lastName" sort={sort} onSortChange={setSort} defaultDirection="asc">Applicant</SortableHeader>
            <TableHead>Phone</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Docs</TableHead>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>Applied</SortableHeader>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="applications"
          />
        }
      >
        {paged.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="font-medium">{d.firstName} {d.lastName}</TableCell>
            <TableCell className="text-xs">{d.phone}</TableCell>
            <TableCell className="text-xs">
              {d.vehicle ? `${d.vehicle.make} ${d.vehicle.model}` : <span className="text-muted-foreground">Not submitted</span>}
            </TableCell>
            <TableCell className="text-xs">
              {d.documents?.length ? `${d.documents.length} files` : <span className="text-muted-foreground">None</span>}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(d.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <StatusBadge variant={statusToVariant(d.driverStatus)} className="capitalize">
                {d.driverStatus.replace(/_/g, " ")}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setSelected(d)} className="h-7 w-7 p-0">
                  <Eye className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => approve.mutate(d.id)}
                  className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => { setRejectTarget(d); setRejectReason(""); }}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Application — {selected?.firstName} {selected?.lastName}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Phone:</span> {selected.phone}</div>
                <div><span className="text-muted-foreground">Status:</span> {selected.driverStatus}</div>
              </div>
              {selected.vehicle && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Vehicle</p>
                  <div className="grid grid-cols-3 gap-2 text-sm bg-muted/30 rounded-lg p-3">
                    <div><span className="text-muted-foreground text-xs">Make:</span><br />{selected.vehicle.make}</div>
                    <div><span className="text-muted-foreground text-xs">Model:</span><br />{selected.vehicle.model}</div>
                    <div><span className="text-muted-foreground text-xs">Year:</span><br />{selected.vehicle.year}</div>
                    <div><span className="text-muted-foreground text-xs">Color:</span><br />{selected.vehicle.color}</div>
                    <div><span className="text-muted-foreground text-xs">Plate:</span><br /><span className="font-mono font-bold">{selected.vehicle.plate}</span></div>
                  </div>
                </div>
              )}
              {selected.documents?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Documents ({selected.documents.length})</p>
                  <div className="space-y-1">
                    {selected.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-3 py-2">
                        <span className="capitalize">{doc.type.replace("_", " ")}</span>
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-primary underline">View</a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
            <Button
              variant="destructive"
              onClick={() => { setRejectTarget(selected); setRejectReason(""); }}
              disabled={reject.isPending}
            >
              <XCircle className="w-4 h-4 mr-1.5" /> Reject
            </Button>
            <Button
              onClick={() => approve.mutate(selected!.id)}
              disabled={approve.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle className="w-4 h-4 mr-1.5" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject driver</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Optionally provide a reason for rejection. This will be included in the notification sent to the driver.
          </p>
          <Input
            placeholder="Reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            data-testid="input-reject-driver-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() => {
                if (!rejectTarget) return;
                reject.mutate({ id: rejectTarget.id, reason: rejectReason.trim() || undefined });
              }}
              data-testid="button-confirm-reject-driver"
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
