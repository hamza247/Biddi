import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { useState } from "react";

interface DailyTrip {
  day: string;
  trips: number;
  completed: number;
  cancelled: number;
  revenue: number;
  revenueDisplay?: number;
}

interface ReportsData {
  summary: {
    totalTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    totalRevenue: number;
    totalRevenueDisplay?: {
      amountUsd: number;
      displayAmount: number;
      displayCurrency: string;
      displaySymbol: string;
    };
  };
  displayCurrency?: string;
  displaySymbol?: string;
  dailyTrips: DailyTrip[];
  activeDriversByDay: { day: string; drivers: number }[];
}

export default function ReportsPage() {
  const [range, setRange] = useState("30d");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reports", range],
    queryFn: () => api<ReportsData>(`/admin/reports/overview?range=${range}`),
  });

  const summary = data?.summary;
  const daily = data?.dailyTrips ?? [];
  const displayCurrency = data?.displayCurrency ?? "USD";
  const displaySymbol = data?.displaySymbol ?? "$";
  const totalRevenueDisplay = summary?.totalRevenueDisplay?.displayAmount ?? summary?.totalRevenue ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Platform analytics and trends</p>
        </div>
        <div className="flex gap-2">
          {[
            { value: "today", label: "Today" },
            { value: "7d", label: "7 Days" },
            { value: "30d", label: "30 Days" },
          ].map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Rides", key: "totalTrips", color: "text-blue-600" },
          { label: "Completed", key: "completedTrips", color: "text-green-600" },
          { label: "Cancelled", key: "cancelledTrips", color: "text-red-500" },
          { label: `Revenue (${displayCurrency})`, key: "totalRevenue", color: "text-purple-600", format: true },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-20 mt-1" />
            ) : (
              <p className={`text-2xl font-bold mt-1 ${c.color}`}>
                {c.format
                  ? `${displaySymbol}${totalRevenueDisplay.toFixed(0)}`
                  : (summary as any)?.[c.key] ?? 0}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Trip chart */}
      <div className="rounded-lg border bg-card p-5 mb-6">
        <h2 className="font-semibold text-sm mb-4">Trips by Day</h2>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : !daily.length ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={daily} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })}
              />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                formatter={(value: number, name: string) => [value, name]}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[2, 2, 0, 0]} />
              <Bar dataKey="cancelled" name="Cancelled" fill="#ef4444" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Revenue chart */}
      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-semibold text-sm mb-4">Revenue by Day ({displayCurrency})</h2>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : !daily.length ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={daily} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value: number) => [`${displaySymbol}${Number(value).toFixed(2)}`, "Revenue"]}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Line
                type="monotone"
                dataKey="revenueDisplay"
                name="Revenue"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
