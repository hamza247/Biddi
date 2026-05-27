import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, EmptyState, FilterBar } from "@/components/admin";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import { useState } from "react";
import { TrendingUp } from "lucide-react";

interface Earning {
  id: string;
  userId: string;
  fromUserId: string;
  rideId: string;
  level: number;
  percentage: number;
  amount: number;
  status: string;
  createdAt: string;
  beneficiaryName: string | null;
  beneficiaryPhone: string | null;
  fromUserName: string | null;
  fromUserPhone: string | null;
}

interface Resp {
  earnings: Earning[];
  total: number;
  totalAmount: number;
}

interface SummaryResp {
  total: number;
  totalAmount: number;
  uniqueBeneficiaries: number;
  uniqueRides: number;
  byLevel: Array<{ level: number; count: number; amount: number }>;
}

export default function ReferralEarningsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [level, setLevel] = useState<string>("all");
  const [userId, setUserId] = useState("");
  const [rideId, setRideId] = useState("");

  const params = new URLSearchParams();
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  if (level !== "all") params.set("level", level);
  if (userId.trim()) params.set("userId", userId.trim());
  if (rideId.trim()) params.set("rideId", rideId.trim());
  const qs = params.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "referral-earnings", from, to, level, userId, rideId],
    queryFn: () =>
      api<Resp>(`/admin/referral-earnings${qs ? `?${qs}` : ""}`),
  });

  const { data: summary } = useQuery({
    queryKey: ["admin", "referral-earnings-summary", from, to, level, userId, rideId],
    queryFn: () =>
      api<SummaryResp>(`/admin/referral-earnings/summary${qs ? `?${qs}` : ""}`),
  });

  const rows = data?.earnings ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5" /> Referral Earnings
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            All credits paid out from the multi-level referral program.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total credited</div>
          <div className="text-xl font-bold">
            {(summary?.totalAmount ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {summary?.total ?? 0} entries · {summary?.uniqueBeneficiaries ?? 0} beneficiaries ·{" "}
            {summary?.uniqueRides ?? 0} rides
          </div>
          {summary?.byLevel?.length ? (
            <div className="text-xs text-muted-foreground mt-1">
              {summary.byLevel
                .map(
                  (b) =>
                    `L${b.level}: ${b.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${b.count})`,
                )
                .join(" · ")}
            </div>
          ) : null}
        </div>
      </div>

      <FilterBar>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Level</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="1">L1</SelectItem>
              <SelectItem value="2">L2</SelectItem>
              <SelectItem value="3">L3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">User ID</Label>
          <Input
            placeholder="beneficiary uuid"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Ride ID</Label>
          <Input
            placeholder="ride uuid"
            value={rideId}
            onChange={(e) => setRideId(e.target.value)}
          />
        </div>
      </FilterBar>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No referral earnings" description="No earnings match these filters." />
      ) : (
        <DataTable
          columnCount={7}
          header={
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Beneficiary</TableHead>
              <TableHead>From rider</TableHead>
              <TableHead>Level</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Ride</TableHead>
            </TableRow>
          }
        >
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <div className="font-medium">{r.beneficiaryName?.trim() || "—"}</div>
                <div className="text-xs text-muted-foreground">{r.beneficiaryPhone}</div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{r.fromUserName?.trim() || "—"}</div>
                <div className="text-xs text-muted-foreground">{r.fromUserPhone}</div>
              </TableCell>
              <TableCell>L{r.level}</TableCell>
              <TableCell className="text-right">{r.percentage}%</TableCell>
              <TableCell className="text-right font-semibold">
                {r.amount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">
                {r.rideId.slice(0, 8)}…
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
