import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When true, the bar shows a "Clear filters" button on the right. */
  hasActiveFilters?: boolean;
  onClear?: () => void;
  children?: React.ReactNode;
}

/**
 * Layout primitive for the row above a list — search + filters + optional
 * clear button. Pair with `<SearchInput>` and `<Select>` controls.
 *
 * @example
 * <FilterBar hasActiveFilters={status !== "all" || !!q} onClear={reset}>
 *   <SearchInput value={q} onChange={setQ} placeholder="Search…" />
 *   <Select value={status} onValueChange={setStatus}>…</Select>
 * </FilterBar>
 */
export function FilterBar({
  className,
  hasActiveFilters,
  onClear,
  children,
  ...rest
}: FilterBarProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap",
        className,
      )}
      {...rest}
    >
      {children}
      {hasActiveFilters && onClear && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="sm:ml-auto h-9 text-xs text-muted-foreground"
        >
          <X className="w-3.5 h-3.5 mr-1" /> Clear filters
        </Button>
      )}
    </div>
  );
}
