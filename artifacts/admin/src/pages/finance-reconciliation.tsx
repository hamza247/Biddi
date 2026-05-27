import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Calendar, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

interface ReconciliationResponse {
  date: string;
  local: {
    walletByType: Array<{ type: string; count: number; total: number }>;
    paymentIntents: { count: number; total: number } | null;
    payouts: Array<{ status: string; count: number; total: number }>;
  };
  stripe:
    | {
        byType: Record<
          string,
          { count: number; gross: number; net: number; fee: number }
        >;
      }
    | { error: string };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function FinanceReconciliationPage() {
  const [date, setDate] = useState<string>(todayIso());

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin", "finance", "reconciliation", date],
    queryFn: () =>
      api<ReconciliationResponse>(`/admin/finance/reconciliation?date=${date}`),
  });

  const stripeError =
    data && "error" in data.stripe ? data.stripe.error : null;
  const stripeByType =
    data && !("error" in data.stripe) ? data.stripe.byType : {};

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Finance reconciliation</h1>
          <p className="text-muted-foreground text-sm">
            Compare local wallet ledger against Stripe balance transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load reconciliation data.
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section className="rounded border bg-card p-4">
            <h2 className="mb-3 text-lg font-medium">Local — wallet by type</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Count</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.local.walletByType.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-muted-foreground">
                      No wallet transactions on this day.
                    </td>
                  </tr>
                ) : (
                  data.local.walletByType.map((row) => (
                    <tr key={row.type} className="border-t">
                      <td className="py-2">{row.type}</td>
                      <td className="py-2 text-right">{row.count}</td>
                      <td className="py-2 text-right">{currency(row.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded border bg-card p-4">
            <h2 className="mb-3 text-lg font-medium">Local — payment intents</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-muted-foreground text-sm">Succeeded count</div>
              <div className="text-right text-sm font-medium">
                {data.local.paymentIntents?.count ?? 0}
              </div>
              <div className="text-muted-foreground text-sm">Succeeded total</div>
              <div className="text-right text-sm font-medium">
                {currency(data.local.paymentIntents?.total ?? 0)}
              </div>
            </div>

            <h3 className="mt-6 mb-2 text-md font-medium">Payouts</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Count</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.local.payouts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-muted-foreground">
                      No payouts on this day.
                    </td>
                  </tr>
                ) : (
                  data.local.payouts.map((row) => (
                    <tr key={row.status} className="border-t">
                      <td className="py-2">{row.status}</td>
                      <td className="py-2 text-right">{row.count}</td>
                      <td className="py-2 text-right">{currency(row.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded border bg-card p-4 md:col-span-2">
            <h2 className="mb-3 text-lg font-medium">
              Stripe — balance transactions by type
            </h2>
            {stripeError ? (
              <div className="rounded border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">
                Stripe unreachable: {stripeError}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2">Type</th>
                    <th className="pb-2 text-right">Count</th>
                    <th className="pb-2 text-right">Gross</th>
                    <th className="pb-2 text-right">Fee</th>
                    <th className="pb-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(stripeByType).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-muted-foreground">
                        No Stripe balance transactions on this day.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(stripeByType).map(([type, row]) => (
                      <tr key={type} className="border-t">
                        <td className="py-2">{type}</td>
                        <td className="py-2 text-right">{row.count}</td>
                        <td className="py-2 text-right">{currency(row.gross)}</td>
                        <td className="py-2 text-right">{currency(row.fee)}</td>
                        <td className="py-2 text-right">{currency(row.net)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
