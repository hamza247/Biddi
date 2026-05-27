import * as React from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Show a clear (×) button when value is non-empty. Default true. */
  clearable?: boolean;
  className?: string;
}

/**
 * Standard admin search input — magnifier icon on the left, optional clear
 * button on the right. Use this on every list page so search affordance looks
 * the same everywhere.
 *
 * @example
 * <SearchInput
 *   value={q}
 *   onChange={setQ}
 *   placeholder="Search by name, email, or phone…"
 * />
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  clearable = true,
  className,
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("pl-8", clearable && value ? "pr-8" : undefined)}
        {...rest}
      />
      {clearable && value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
