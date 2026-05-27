import type { User } from "@workspace/db";

export interface PublicUser {
  id: string;
  phone: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  hasPassword: boolean;
  referralCode: string | null;
  referredByCode: string | null;
  gender: string | null;
  country: string | null;
  city: string | null;
  photoUrl: string | null;
  walletBalance: string;
  isActive: boolean;
  phoneVerified: boolean;
  appMode: "rider" | "driver";
  driverStatus: "not_applied" | "pending" | "approved" | "rejected" | "suspended";
  driverOnline: boolean;
  driverRejectionReason: string | null;
  driverSuspensionReason: string | null;
  rating: number;
  driverRatingCount: number;
  trips: number;
  customerRating: number | null;
  customerRatingCount: number;
  submittedDocs: Array<{ type: string; url: string; status?: "pending" | "approved" | "rejected"; rejectionReason?: string }>;
}

export interface SubmittedDoc {
  type: string;
  url: string;
  contentType?: string;
  status?: "pending" | "approved" | "rejected";
  rejectionReason?: string;
}

export function normalizeSubmittedDocs(raw: unknown): SubmittedDoc[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") return { type: item, url: "" };
    if (item && typeof item === "object" && "type" in item) {
      const r = item as Record<string, unknown>;
      const contentType = typeof r.contentType === "string" ? r.contentType : undefined;
      const status = (r.status === "approved" || r.status === "rejected" || r.status === "pending")
        ? r.status
        : undefined;
      const rejectionReason = typeof r.rejectionReason === "string" ? r.rejectionReason : undefined;
      return {
        type: String(r.type ?? ""),
        url: String(r.url ?? ""),
        ...(contentType ? { contentType } : {}),
        ...(status ? { status } : {}),
        ...(rejectionReason ? { rejectionReason } : {}),
      };
    }
    return { type: String(item), url: "" };
  });
}

export function toPublicUser(u: User): PublicUser {
  const docs = normalizeSubmittedDocs(u.submittedDocs);
  return {
    id: u.id,
    phone: u.phone,
    countryCode: u.countryCode,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email ?? null,
    hasPassword: !!u.password,
    referralCode: u.referralCode ?? null,
    referredByCode: u.referredByCode ?? null,
    gender: u.gender ?? null,
    country: u.country ?? null,
    city: u.city ?? null,
    photoUrl: u.photoUrl ?? null,
    walletBalance: u.walletBalance ?? "0",
    isActive: u.isActive ?? true,
    phoneVerified: u.phoneVerified ?? false,
    appMode: u.appMode,
    driverStatus: u.driverStatus,
    driverOnline: u.driverOnline,
    driverRejectionReason: u.driverRejectionReason ?? null,
    driverSuspensionReason: u.driverSuspensionReason ?? null,
    rating: parseFloat(u.rating),
    driverRatingCount: u.driverRatingCount ?? 0,
    trips: parseInt(u.trips, 10) || 0,
    customerRating: u.customerRating != null ? parseFloat(u.customerRating) : null,
    customerRatingCount: u.customerRatingCount ?? 0,
    submittedDocs: docs.map((d) => ({
      type: d.type,
      url: d.url,
      ...(d.status ? { status: d.status } : {}),
      ...(d.rejectionReason ? { rejectionReason: d.rejectionReason } : {}),
    })),
  };
}

export function initialOf(name: string): string {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}
