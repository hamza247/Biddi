import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Shared color-coded status pill used everywhere admin shows a state.
 *
 * Use one of the built-in variants (`success`, `warning`, `danger`, `info`,
 * `neutral`) or pass `className` for one-off tweaks. Keep colors consistent
 * across pages — drift is the whole reason this exists.
 *
 * @example
 * <StatusBadge variant="success">Active</StatusBadge>
 * <StatusBadge variant="warning">Pending</StatusBadge>
 */
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        success: "bg-emerald-50 text-emerald-700 border-emerald-200",
        warning: "bg-amber-50 text-amber-800 border-amber-200",
        danger: "bg-red-50 text-red-700 border-red-200",
        info: "bg-blue-50 text-blue-700 border-blue-200",
        neutral: "bg-muted text-muted-foreground border-border",
        accent: "bg-violet-50 text-violet-700 border-violet-200",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export type StatusBadgeVariant = NonNullable<
  VariantProps<typeof statusBadgeVariants>["variant"]
>;

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {}

export function StatusBadge({
  className,
  variant,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(statusBadgeVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * Small helper that maps common status strings to a sensible variant. Pages
 * that already have their own mapping (e.g. drivers) can keep it; this is the
 * default for new code.
 */
export function statusToVariant(status: string): StatusBadgeVariant {
  const s = status.toLowerCase();
  if (
    s === "active" ||
    s === "approved" ||
    s === "completed" ||
    s === "delivered" ||
    s === "accepted" ||
    s === "online" ||
    s === "resolved" ||
    s === "paid"
  ) {
    return "success";
  }
  if (
    s === "pending" ||
    s === "queued" ||
    s === "bidding" ||
    s === "in_progress" ||
    s === "driver_arriving" ||
    s === "warning"
  ) {
    return "warning";
  }
  if (
    s === "rejected" ||
    s === "failed" ||
    s === "cancelled" ||
    s === "banned" ||
    s === "danger"
  ) {
    return "danger";
  }
  if (s === "suspended") return "warning";
  if (s === "info") return "info";
  return "neutral";
}
