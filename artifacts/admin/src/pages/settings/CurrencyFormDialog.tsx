import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface CurrencyFormValues {
  code: string;
  name: string;
  symbol: string;
  rateFromUsd: string;
  decimalPlaces: number;
  symbolPosition: "before" | "after";
  thousandsSeparator: "comma" | "dot" | "space";
  decimalSeparator: "dot" | "comma";
  isActive: boolean;
}

const EMPTY: CurrencyFormValues = {
  code: "",
  name: "",
  symbol: "",
  rateFromUsd: "",
  decimalPlaces: 2,
  symbolPosition: "before",
  thousandsSeparator: "comma",
  decimalSeparator: "dot",
  isActive: true,
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When true, the form is in Edit mode and `initial` should be supplied. */
  mode: "create" | "edit";
  /** Initial values (Edit mode). For Create, omit. */
  initial?: Partial<CurrencyFormValues>;
  /** Lock the code field (Edit mode when the row is referenced by rides). */
  codeLocked?: boolean;
  /** Hide the rate field for USD edits where the rate is pinned at 1. */
  hideRate?: boolean;
  saving?: boolean;
  onSubmit: (values: CurrencyFormValues) => void;
}

function validate(
  v: CurrencyFormValues,
  mode: "create" | "edit",
  hideRate: boolean,
): string | null {
  if (mode === "create") {
    if (!/^[A-Z]{3}$/.test(v.code)) {
      return "Code must be exactly 3 uppercase letters (e.g. EUR).";
    }
  }
  if (!v.name.trim()) return "Name is required.";
  if (!v.symbol.trim()) return "Symbol is required.";
  if (!hideRate) {
    const rate = Number(v.rateFromUsd);
    if (!Number.isFinite(rate) || rate <= 0) {
      return "Exchange rate must be a positive number.";
    }
  }
  if (
    !Number.isInteger(v.decimalPlaces) ||
    v.decimalPlaces < 0 ||
    v.decimalPlaces > 4
  ) {
    return "Decimal places must be a whole number between 0 and 4.";
  }
  return null;
}

export function CurrencyFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  codeLocked = false,
  hideRate = false,
  saving = false,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<CurrencyFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues({ ...EMPTY, ...initial });
      setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof CurrencyFormValues>(
    key: K,
    val: CurrencyFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: val }));

  const handleSubmit = () => {
    const err = validate(values, mode, hideRate);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add Currency" : `Edit ${values.code || "currency"}`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="cur-code">Code</Label>
            <Input
              id="cur-code"
              value={values.code}
              maxLength={3}
              disabled={codeLocked}
              onChange={(e) =>
                set("code", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
              }
              placeholder="EUR"
              data-testid="input-code"
            />
            {codeLocked && mode === "edit" && (
              <p className="text-xs text-muted-foreground">
                This code is the platform default or referenced by existing
                rides, so it can't be changed.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cur-name">Name</Label>
            <Input
              id="cur-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Euro"
              data-testid="input-name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cur-symbol">Symbol</Label>
            <Input
              id="cur-symbol"
              value={values.symbol}
              maxLength={8}
              onChange={(e) => set("symbol", e.target.value)}
              placeholder="€"
              data-testid="input-symbol"
            />
          </div>
          {!hideRate && (
            <div className="space-y-1">
              <Label htmlFor="cur-rate">Exchange rate (per 1 USD)</Label>
              <Input
                id="cur-rate"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="0"
                value={values.rateFromUsd}
                onChange={(e) => set("rateFromUsd", e.target.value)}
                placeholder="0.92"
                data-testid="input-rate"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="cur-decimals">Decimal places</Label>
            <Input
              id="cur-decimals"
              type="number"
              min={0}
              max={4}
              step={1}
              value={values.decimalPlaces}
              onChange={(e) =>
                set("decimalPlaces", Math.max(0, Math.min(4, Number(e.target.value) || 0)))
              }
              data-testid="input-decimals"
            />
          </div>
          <div className="space-y-1">
            <Label>Symbol position</Label>
            <Select
              value={values.symbolPosition}
              onValueChange={(v) => set("symbolPosition", v as "before" | "after")}
            >
              <SelectTrigger data-testid="select-symbol-position">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">Before amount ($10.00)</SelectItem>
                <SelectItem value="after">After amount (10.00 MAD)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Thousands separator</Label>
            <Select
              value={values.thousandsSeparator}
              onValueChange={(v) =>
                set("thousandsSeparator", v as "comma" | "dot" | "space")
              }
            >
              <SelectTrigger data-testid="select-thousands">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comma">Comma (1,000)</SelectItem>
                <SelectItem value="dot">Dot (1.000)</SelectItem>
                <SelectItem value="space">Space (1 000)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Decimal separator</Label>
            <Select
              value={values.decimalSeparator}
              onValueChange={(v) => set("decimalSeparator", v as "dot" | "comma")}
            >
              <SelectTrigger data-testid="select-decimal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dot">Dot (10.00)</SelectItem>
                <SelectItem value="comma">Comma (10,00)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center justify-between rounded border border-border px-3 py-2">
            <div>
              <Label className="text-sm">Active</Label>
              <p className="text-xs text-muted-foreground">
                Inactive currencies are hidden from selectors elsewhere in admin.
              </p>
            </div>
            <Switch
              checked={values.isActive}
              onCheckedChange={(v) => set("isActive", v)}
              data-testid="switch-active"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" data-testid="form-error">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            data-testid="button-save"
          >
            {saving ? "Saving…" : mode === "create" ? "Add currency" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
