import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  CreditCard,
  Search,
  XCircle,
  Wallet,
  Smartphone,
  Building2,
} from "lucide-react";

type Status = "pending" | "approved" | "paid" | "rejected" | "cancelled";

interface PayoutMethod {
  method: "bank" | "mobile_money";
  accountName: string;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  mobileProvider?: string | null;
  mobileNumber?: string | null;
}

interface Withdrawal {
  id: string;
  driverId: string;
  amount: number;
  status: Status;
  payoutMethod: PayoutMethod;
  paymentReference: string | null;
  rejectionReason: string | null;
  decidedByAdminId: string | null;
  decidedByAdminName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  driver: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
  } | null;
}

interface WithdrawalsResponse {
  withdrawals: Withdrawal[];
  page: number;
  limit: number;
  total: number;
}

const TABS: { key: Status | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  paid: "default",
  rejected: "destructive",
  cancelled: "outline",
};

function formatDate(s: string) {
  return new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PayoutSummary({ pm }: { pm: PayoutMethod }) {
  if (pm.method === "bank") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
        <div>
          <div className="font-medium">{pm.bankName ?? "Bank"}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {pm.iban ?? pm.accountNumber ?? "—"} · {pm.accountName}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
      <div>
        <div className="font-medium">{pm.mobileProvider ?? "Mobile money"}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {pm.mobileNumber ?? "—"} · {pm.accountName}
        </div>
      </div>
    </div>
  );
}

export default function WithdrawalsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Status | "all">("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Withdrawal | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [paidOpen, setPaidOpen] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");

  const queryKey = ["/admin/withdrawals", tab, search, page] as const;
  const { data, isLoading } = useQuery<WithdrawalsResponse>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ status: tab, page: String(page) });
      if (search.trim()) params.set("search", search.trim());
      return api<WithdrawalsResponse>(`/admin/withdrawals?${params.toString()}`);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/admin/withdrawals"] });
  };

  const approve = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/withdrawals/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Withdrawal approved" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Approve failed",
        description: e instanceof ApiError ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const markPaid = useMutation({
    mutationFn: ({ id, paymentReference }: { id: string; paymentReference: string }) =>
      api(`/admin/withdrawals/${id}/mark-paid`, {
        method: "POST",
        json: { paymentReference },
      }),
    onSuccess: () => {
      invalidate();
      setPaidOpen(false);
      setPaymentReference("");
      setActive(null);
      toast({ title: "Marked as paid" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Mark-paid failed",
        description: e instanceof ApiError ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/admin/withdrawals/${id}/reject`, {
        method: "POST",
        json: { reason },
      }),
    onSuccess: () => {
      invalidate();
      setRejectOpen(false);
      setRejectReason("");
      setActive(null);
      toast({ title: "Withdrawal rejected", description: "Funds returned to driver wallet." });
    },
    onError: (e: unknown) =>
      toast({
        title: "Reject failed",
        description: e instanceof ApiError ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const rows = data?.withdrawals ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="w-6 h-6" />
            Driver Withdrawals
          </h1>
          <p className="text-sm text-muted-foreground">
            Review and process driver withdrawal requests.
          </p>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={tab === t.key ? "default" : "ghost"}
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className="h-8"
              >
                {t.label}
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search driver name or phone"
              className="pl-7 h-8 w-64"
            />
          </div>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Payout method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No withdrawals match this filter.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(w.requestedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {w.driver
                          ? `${w.driver.firstName} ${w.driver.lastName}`.trim()
                          : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {w.driver?.phone ?? ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      ${w.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <PayoutSummary pm={w.payoutMethod} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[w.status]} className="capitalize">
                        {w.status}
                      </Badge>
                      {w.status === "rejected" && w.rejectionReason && (
                        <div className="text-xs text-muted-foreground mt-1 max-w-[180px] truncate">
                          {w.rejectionReason}
                        </div>
                      )}
                      {w.status === "paid" && w.paymentReference && (
                        <div className="text-xs text-muted-foreground mt-1 font-mono max-w-[180px] truncate">
                          Ref: {w.paymentReference}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {(w.status === "pending" || w.status === "approved") && (
                        <div className="flex justify-end gap-1.5">
                          {w.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => approve.mutate(w.id)}
                              disabled={approve.isPending}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={() => {
                              setActive(w);
                              setPaymentReference("");
                              setPaidOpen(true);
                            }}
                          >
                            <CreditCard className="w-3.5 h-3.5 mr-1" />
                            Mark paid
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/5"
                            onClick={() => {
                              setActive(w);
                              setRejectReason("");
                              setRejectOpen(true);
                            }}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </Button>
          <span>
            Page {page}
            {data ? ` · ${data.total} total` : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!data || rows.length < data.limit}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      </Card>

      <Dialog
        open={paidOpen}
        onOpenChange={(o) => {
          if (!o) {
            setPaidOpen(false);
            setActive(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark withdrawal as paid</DialogTitle>
            <DialogDescription>
              {active &&
                `Confirm that $${active.amount.toFixed(2)} has been sent to ${active.driver?.firstName ?? "the driver"}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {active && (
              <div className="rounded-md border bg-muted/30 p-3">
                <PayoutSummary pm={active.payoutMethod} />
              </div>
            )}
            <div>
              <Label htmlFor="ref">Payment reference</Label>
              <Input
                id="ref"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="e.g. transfer ID, mobile money TXN"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaidOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!paymentReference.trim() || markPaid.isPending}
              onClick={() => {
                if (!active) return;
                markPaid.mutate({
                  id: active.id,
                  paymentReference: paymentReference.trim(),
                });
              }}
            >
              <CreditCard className="w-3.5 h-3.5 mr-1" />
              Confirm paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectOpen}
        onOpenChange={(o) => {
          if (!o) {
            setRejectOpen(false);
            setActive(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject withdrawal</DialogTitle>
            <DialogDescription>
              {active &&
                `Reject the $${active.amount.toFixed(2)} request. The funds will be returned to the driver's wallet.`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Tell the driver why this was rejected"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || reject.isPending}
              onClick={() => {
                if (!active) return;
                reject.mutate({ id: active.id, reason: rejectReason.trim() });
              }}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Reject and refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
