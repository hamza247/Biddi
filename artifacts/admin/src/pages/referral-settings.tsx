import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";

interface ReferralLevel {
  level: number;
  percentage: number;
  isActive: boolean;
  updatedAt: string;
}

const DEFAULTS: Record<number, number> = { 1: 4, 2: 2, 3: 1 };

export default function ReferralSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "referral-levels"],
    queryFn: () => api<{ levels: ReferralLevel[] }>("/admin/referral-levels"),
  });

  const [form, setForm] = useState<Record<number, { percentage: number; isActive: boolean }>>({
    1: { percentage: DEFAULTS[1], isActive: true },
    2: { percentage: DEFAULTS[2], isActive: true },
    3: { percentage: DEFAULTS[3], isActive: true },
  });

  useEffect(() => {
    if (!data?.levels) return;
    setForm((prev) => {
      const next = { ...prev };
      data.levels.forEach((l) => {
        next[l.level] = { percentage: l.percentage, isActive: l.isActive };
      });
      return next;
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (level: number) =>
      api(`/admin/referral-levels/${level}`, {
        method: "PUT",
        json: form[level],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "referral-levels"] });
      toast({ title: "Referral level updated" });
    },
    onError: () => toast({ title: "Failed to update level", variant: "destructive" }),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="w-5 h-5" /> Referral Settings
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure the percentage of each completed ride that is credited to ancestors in the
          rider's 3-level referral chain.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((level) => (
            <div
              key={level}
              className="rounded-xl border bg-card p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Level
                  </div>
                  <div className="text-2xl font-bold">L{level}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`active-${level}`} className="text-xs">
                    Active
                  </Label>
                  <Switch
                    id={`active-${level}`}
                    checked={form[level].isActive}
                    onCheckedChange={(v) =>
                      setForm((f) => ({ ...f, [level]: { ...f[level], isActive: v } }))
                    }
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={`pct-${level}`}>Percentage of ride amount</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id={`pct-${level}`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={form[level].percentage}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        [level]: { ...f[level], percentage: Number(e.target.value) },
                      }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Default: {DEFAULTS[level]}%
                </p>
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={save.isPending}
                onClick={() => save.mutate(level)}
              >
                Save L{level}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl border bg-muted/40 p-5">
        <h2 className="text-sm font-semibold mb-3">Example calculation</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Preview how much each upline ancestor would earn from a single
          completed ride at the percentages above.
        </p>
        <ExamplePanel form={form} />
      </div>
    </div>
  );
}

function ExamplePanel({
  form,
}: {
  form: Record<number, { percentage: number; isActive: boolean }>;
}) {
  const [sample, setSample] = useState<number>(500);
  const total = [1, 2, 3].reduce((acc, l) => {
    if (!form[l].isActive) return acc;
    return acc + Math.round(sample * (form[l].percentage / 100) * 100) / 100;
  }, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label htmlFor="sample-amount" className="text-xs">
            Sample ride amount
          </Label>
          <Input
            id="sample-amount"
            type="number"
            min={0}
            step="1"
            value={sample}
            onChange={(e) => setSample(Number(e.target.value) || 0)}
            className="mt-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[1, 2, 3].map((l) => {
          const active = form[l].isActive;
          const credit = active
            ? Math.round(sample * (form[l].percentage / 100) * 100) / 100
            : 0;
          return (
            <div key={l} className="rounded-lg border bg-background p-3">
              <div className="text-xs text-muted-foreground">
                L{l} {active ? `(${form[l].percentage}%)` : "(inactive)"}
              </div>
              <div className="text-lg font-semibold">
                {credit.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground">
        Total credited to upline per ride:{" "}
        <span className="font-semibold text-foreground">
          {total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
