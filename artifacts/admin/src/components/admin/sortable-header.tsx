import * as React from "react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export interface SortState<TKey extends string = string> {
  key: TKey;
  direction: SortDirection;
}

interface SortableHeaderProps<TKey extends string = string>
  extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "onClick"> {
  /** Stable key for this column. */
  sortKey: TKey;
  /** Currently active sort, if any. */
  sort: SortState<TKey> | null;
  onSortChange: (sort: SortState<TKey>) => void;
  children: React.ReactNode;
  /** Initial direction to use when this column becomes active. Default `desc`
   * for date/amount columns, `asc` reads better for names. */
  defaultDirection?: SortDirection;
  className?: string;
}

/**
 * Click-to-sort table header. Pair with a `useSort` hook (or your own state)
 * and `useMemo`-sorted rows. Shows a chevron when active, a dim
 * up/down indicator otherwise.
 *
 * @example
 * <TableHeader>
 *   <TableRow>
 *     <SortableHeader sortKey="name" sort={sort} onSortChange={setSort}>
 *       Name
 *     </SortableHeader>
 *     <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>
 *       Date
 *     </SortableHeader>
 *   </TableRow>
 * </TableHeader>
 */
export function SortableHeader<TKey extends string = string>({
  sortKey,
  sort,
  onSortChange,
  children,
  defaultDirection = "desc",
  className,
  ...rest
}: SortableHeaderProps<TKey>) {
  const active = sort?.key === sortKey;
  const direction = active ? sort?.direction : null;

  const handleClick = () => {
    if (!active) {
      onSortChange({ key: sortKey, direction: defaultDirection });
      return;
    }
    onSortChange({
      key: sortKey,
      direction: direction === "asc" ? "desc" : "asc",
    });
  };

  return (
    <TableHead className={cn("p-0", className)} {...rest}>
      <button
        type="button"
        onClick={handleClick}
        aria-sort={
          !active ? "none" : direction === "asc" ? "ascending" : "descending"
        }
        className={cn(
          "flex items-center gap-1 w-full h-10 px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors",
        )}
      >
        <span>{children}</span>
        {active ? (
          direction === "asc" ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

/**
 * Tiny convenience hook — keeps the boilerplate out of pages.
 */
export function useSort<TKey extends string = string>(
  initial: SortState<TKey> | null = null,
) {
  return React.useState<SortState<TKey> | null>(initial);
}

/**
 * Pure helper: returns a new array sorted by the active sort. Pass an accessor
 * to extract the comparable value from each row.
 */
export function sortRows<T, TKey extends string>(
  rows: readonly T[],
  sort: SortState<TKey> | null,
  getValue: (row: T, key: TKey) => string | number | Date | null | undefined,
): T[] {
  if (!sort) return [...rows];
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av instanceof Date && bv instanceof Date) {
      return (av.getTime() - bv.getTime()) * dir;
    }
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}
