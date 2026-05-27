import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Save, RefreshCw, Loader2 } from "lucide-react";
import { MaskedSecretInput } from "./MaskedSecretInput";
import type { FieldDef, SectionDef, TabSettingsResponse } from "./types";

type FormValues = Record<string, string | number | boolean>;

interface Props {
  tab: string;
  sections: SectionDef[];
  /** Optional content rendered above the form (e.g. extra cards). */
  before?: ReactNode;
  /** Optional content rendered below the form, before save buttons. */
  after?: (ctx: {
    values: FormValues;
    set: <K extends string>(key: K, v: FormValues[string]) => void;
    hasSecrets: Record<string, boolean>;
  }) => ReactNode;
  /** Local validation hook. Return error message string to block save. */
  validate?: (values: FormValues) => string | null;
}

function fieldError(def: FieldDef, value: unknown): string | null {
  if (def.kind === "email" && typeof value === "string" && value.trim()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "Invalid email address";
  }
  if (def.kind === "url" && typeof value === "string" && value.trim()) {
    try {
      new URL(value.trim());
    } catch {
      return "Invalid URL";
    }
  }
  if (def.kind === "number" && value !== "" && value != null) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Must be a number";
    if (def.min != null && n < def.min) return `Must be at least ${def.min}`;
    if (def.max != null && n > def.max) return `Must be at most ${def.max}`;
  }
  return null;
}

export function SettingsForm({ tab, sections, before, after, validate }: Props) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => [`/admin/settings/${tab}`] as const, [tab]);

  const { data, isLoading, refetch, isFetching } = useQuery<TabSettingsResponse>({
    queryKey,
    queryFn: () => api<TabSettingsResponse>(`/admin/settings/${tab}`),
  });

  const allFields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);

  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    const init: FormValues = {};
    for (const f of allFields) {
      const raw = data.settings[f.key];
      if (f.kind === "secret") {
        init[f.key] = "";
      } else if (f.kind === "boolean") {
        init[f.key] = !!raw;
      } else if (f.kind === "number") {
        init[f.key] = typeof raw === "number" ? raw : Number(raw ?? 0);
      } else {
        init[f.key] = (raw as string | number | boolean | undefined) ?? "";
      }
    }
    setValues(init);
    setErrors({});
  }, [data, allFields]);

  const set = (key: string, v: FormValues[string]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const save = useMutation({
    mutationFn: (body: FormValues) =>
      api<TabSettingsResponse>(`/admin/settings/${tab}`, { method: "PUT", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const onSave = () => {
    // Validate per-field
    const nextErrors: Record<string, string> = {};
    for (const f of allFields) {
      const err = fieldError(f, values[f.key]);
      if (err) nextErrors[f.key] = err;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast({
        title: "Please fix the errors before saving",
        variant: "destructive",
      });
      return;
    }
    if (validate) {
      const err = validate(values);
      if (err) {
        toast({ title: err, variant: "destructive" });
        return;
      }
    }
    // Strip empty secrets so they aren't overwritten
    const body: FormValues = {};
    for (const f of allFields) {
      const v = values[f.key];
      if (f.kind === "secret" && (v === "" || v == null)) continue;
      body[f.key] = v;
    }
    save.mutate(body);
  };

  const onReset = () => {
    refetch();
  };

  const hasSecrets = data?._hasSecrets ?? {};

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {before}
      {sections.map((section, i) => (
        <div key={i} className="space-y-4">
          {section.title && (
            <div>
              <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
              {section.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {section.fields.map((f) => (
              <FieldRow
                key={f.key}
                def={f}
                value={values[f.key]}
                error={errors[f.key]}
                hasSaved={hasSecrets[f.key] ?? false}
                onChange={(v) => set(f.key, v)}
              />
            ))}
          </div>
        </div>
      ))}

      {after && after({ values, set, hasSecrets })}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save changes
        </Button>
        <Button variant="outline" onClick={onReset} disabled={isFetching || save.isPending}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Reset
        </Button>
      </div>
    </div>
  );
}

interface FieldRowProps {
  def: FieldDef;
  value: FormValues[string] | undefined;
  error?: string;
  hasSaved: boolean;
  onChange: (v: FormValues[string]) => void;
}

function FieldRow({ def, value, error, hasSaved, onChange }: FieldRowProps) {
  const id = `f-${def.key}`;
  const wrapperClass = def.fullWidth || def.kind === "boolean" || def.kind === "textarea"
    ? "sm:col-span-2"
    : "";

  if (def.kind === "boolean") {
    return (
      <div
        className={`${wrapperClass} flex items-start justify-between gap-4 p-3 rounded-lg border border-border`}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium">{def.label}</div>
          {def.help && <div className="text-xs text-muted-foreground mt-0.5">{def.help}</div>}
        </div>
        <Switch
          checked={!!value}
          onCheckedChange={(v) => onChange(v)}
          aria-label={def.label}
        />
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <Label htmlFor={id}>{def.label}</Label>
      <div className="mt-1">
        {def.kind === "select" ? (
          <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={id}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {def.options?.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : def.kind === "secret" ? (
          <MaskedSecretInput
            id={id}
            value={String(value ?? "")}
            onChange={onChange}
            hasSaved={hasSaved}
            placeholder={def.placeholder}
          />
        ) : def.kind === "textarea" ? (
          <Textarea
            id={id}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.placeholder}
            rows={4}
          />
        ) : def.kind === "number" ? (
          <Input
            id={id}
            type="number"
            min={def.min}
            max={def.max}
            step={def.step ?? 1}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === "" ? "" : Number(v));
            }}
            placeholder={def.placeholder}
          />
        ) : (
          <Input
            id={id}
            type={def.kind === "email" ? "email" : def.kind === "url" ? "url" : "text"}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.placeholder}
          />
        )}
      </div>
      {def.help && !error && (
        <p className="text-xs text-muted-foreground mt-1">{def.help}</p>
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
