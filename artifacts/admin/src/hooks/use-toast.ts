import * as React from "react";
import { toast as sonnerToast } from "sonner";

/**
 * Sonner-backed shim for the legacy shadcn `useToast` hook so existing pages
 * keep working without changes. New code should import `toast` directly from
 * "sonner". Both call patterns route to the same `sonner` toaster mounted in
 * `App.tsx`.
 *
 * Supports the legacy shape:
 *   toast({ title, description, variant: "destructive" | "default" })
 * and the new shape:
 *   toast.success("Saved")
 */
type LegacyVariant = "default" | "destructive" | "success";

interface LegacyToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: LegacyVariant;
  duration?: number;
  /** Accepted for back-compat with the radix toast type; ignored. */
  action?: unknown;
}

function renderTitle(title: React.ReactNode): string {
  if (typeof title === "string") return title;
  if (typeof title === "number") return String(title);
  return "";
}

function callLegacy(input: LegacyToastInput) {
  const title = renderTitle(input.title) || "Notice";
  const description =
    typeof input.description === "string" ? input.description : undefined;
  const opts = {
    description,
    duration: input.duration,
  };

  if (input.variant === "destructive") {
    return sonnerToast.error(title, opts);
  }
  if (input.variant === "success") {
    return sonnerToast.success(title, opts);
  }
  return sonnerToast(title, opts);
}

export function toast(input: LegacyToastInput) {
  const id = callLegacy(input);
  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: (next: LegacyToastInput) => callLegacy(next),
  };
}

export function useToast() {
  return {
    toast,
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
    toasts: [] as Array<unknown>,
  };
}
