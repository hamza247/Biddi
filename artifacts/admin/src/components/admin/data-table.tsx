import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DataTableProps {
  /** Number of columns — used for skeleton + colspan on empty/error rows. */
  columnCount: number;
  /** Header row built from `<TableRow><TableHead>…</TableHead></TableRow>`
   * (or `<SortableHeader>` for sortable columns). */
  header: React.ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  /** Element shown when not loading and there are no rows. */
  empty?: React.ReactNode;
  /** Optional retry handler shown next to the error message. */
  onRetry?: () => void;
  /** Children should be `<TableRow>` elements when there is data. */
  children: React.ReactNode;
  /** Optional pagination footer; pass `<DataTablePagination …/>` here. */
  footer?: React.ReactNode;
  /** Skeleton row count while loading. Default 6. */
  skeletonRows?: number;
  className?: string;
}

/**
 * The single primitive used for every list in admin.
 *
 * It wraps the shadcn `<Table>` with built-in loading skeleton, an empty
 * state slot, and an error state with optional retry. Mobile responsiveness
 * is handled automatically — the underlying `<Table>` already wraps in
 * `overflow-auto`. Wrap the whole thing in a bordered card for the standard
 * admin look (the `bordered` prop does that for you).
 *
 * @example
 * <DataTable
 *   columnCount={5}
 *   isLoading={isLoading}
 *   isError={isError}
 *   onRetry={refetch}
 *   empty={<EmptyState icon={Bell} title="No templates" />}
 *   header={<TableRow>…<TableHead>Name</TableHead>…</TableRow>}
 *   footer={<DataTablePagination page={page} setPage={setPage} total={total} pageSize={pageSize} />}
 * >
 *   {rows.map(r => <TableRow key={r.id}>…</TableRow>)}
 * </DataTable>
 */
export function DataTable({
  columnCount,
  header,
  isLoading,
  isError,
  empty,
  onRetry,
  children,
  footer,
  skeletonRows = 6,
  className,
}: DataTableProps) {
  const hasRows = React.Children.count(children) > 0;
  return (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-hidden",
        className,
      )}
    >
      <Table>
        <TableHeader>{header}</TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`sk-${i}`}>
                {Array.from({ length: columnCount }).map((_, j) => (
                  <TableCell key={j} className="px-2 py-3">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : isError ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                className="text-center text-muted-foreground py-12"
              >
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    Couldn't load this list
                  </span>
                  <span className="text-xs">
                    Something went wrong on our end.
                  </span>
                  {onRetry && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRetry}
                      className="mt-2"
                    >
                      Try again
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ) : !hasRows ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="p-0">
                {empty ?? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No results.
                  </div>
                )}
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
      {footer && !isLoading && !isError && hasRows && (
        <div className="border-t">{footer}</div>
      )}
    </div>
  );
}

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  setPage: (page: number) => void;
  /** Optional label, e.g. "trips". */
  itemLabel?: string;
}

/**
 * Standard "Previous / page X of Y / Next" footer for DataTable.
 *
 * @example
 * <DataTablePagination page={page} setPage={setPage} total={data.total} pageSize={20} />
 */
export function DataTablePagination({
  page,
  pageSize,
  total,
  setPage,
  itemLabel,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        {total === 0
          ? "No results"
          : `Showing ${start}–${end} of ${total}${itemLabel ? ` ${itemLabel}` : ""}`}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!hasPrev}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft className="w-3 h-3" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!hasNext}
          onClick={() => setPage(page + 1)}
        >
          Next
          <ChevronRight className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
