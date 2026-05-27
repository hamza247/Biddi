import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Lucide icon component (or any React element). */
  icon?: React.ComponentType<{ className?: string }>;
  /** Bold title shown above the description. */
  title: string;
  /** Helpful one-liner explaining what to do next. */
  description?: React.ReactNode;
  /** Optional primary call-to-action (button, link, etc.). */
  action?: React.ReactNode;
  className?: string;
  /** Compact rendering for tight spaces (in-table, inline panels). */
  compact?: boolean;
}

/**
 * Unified empty state used across all admin pages. Pair with `<DataTable
 * empty={...}>` so every list has the same look.
 *
 * @example
 * <EmptyState
 *   icon={Bell}
 *   title="No templates yet"
 *   description="Create SMS, email, and push templates to get started."
 *   action={<Button>Add template</Button>}
 * />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-2",
        compact ? "py-8 px-4" : "py-16 px-6",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
            compact ? "w-10 h-10 mb-1" : "w-12 h-12 mb-2",
          )}
        >
          <Icon className={cn(compact ? "w-5 h-5" : "w-6 h-6")} />
        </div>
      )}
      <p className={cn("font-medium", compact ? "text-sm" : "text-base")}>
        {title}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-md">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
