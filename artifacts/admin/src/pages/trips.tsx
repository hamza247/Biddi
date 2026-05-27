import { useQuery, useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useDisplayCurrency, useFormatCurrency } from "@/lib/use-display-currency";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import { useState, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, Car, Mail, Loader2, Star, ExternalLink, Download, ShieldAlert, Route } from "lucide-react";
import { API_BASE, getToken } from "@/lib/api";
import {
  DataTable,
  DataTablePagination,
  EmptyState,
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge,
  sortRows,
  statusToVariant,
  useSort,
} from "@/components/admin";

interface TripFinalDisplay { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string }

interface Trip {
  id: string;
  riderName: string;
  riderPhone: string;
  driverName: string;
  driverPhone: string;
  pickup: string;
  dropoff: string;
  distanceKm: number;
  finalAmount: number | null;
  finalAmountDisplay?: TripFinalDisplay | null;
  vehicleClass: string | null;
  status: string;
  ratingScore: number | null;
  createdAt: string;
}

interface FareBreakdown {
  currency?: string;
  base?: number;
  distance?: number;
  distanceKm?: number;
  time?: number;
  durationMin?: number;
  peakSurcharge?: number;
  nightSurcharge?: number;
  weatherSurcharge?: number;
  weatherRuleName?: string | null;
  airportPickupSurcharge?: number;
  airportPickupName?: string | null;
  airportDropoffSurcharge?: number;
  airportDropoffName?: string | null;
  waitingFee?: number;
  waitingMin?: number;
  total?: number;
}

interface TripPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  rating: string | null;
  photoUrl: string | null;
}

interface SafetyAlertSummary {
  id: string;
  status: "active" | "resolved";
  createdAt: string;
}

interface TripDetail {
  id: string;
  riderId: string;
  acceptedDriverId: string | null;
  pickupLabel: string;
  pickupAddress: string;
  dropoffLabel: string;
  dropoffAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  routePolyline: string | null;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  finalAmount: number | null;
  finalAmountDisplay?: TripFinalDisplay | null;
  vehicleClass: string | null;
  paymentMethod: string;
  fareBreakdown: FareBreakdown | null;
  fareBreakdownDisplay?: (FareBreakdown & { displaySymbol: string }) | null;
  status: string;
  ratingScore: number | null;
  ratingComment: string | null;
  createdAt: string;
  updatedAt: string;
  rider: TripPerson | null;
  driver: TripPerson | null;
  safetyAlert: SafetyAlertSummary | null;
}

interface AdminSettings {
  googleMapsApiKeyWeb: string;
}

const VALID_STATUSES = ["all", "driver_arriving", "in_progress", "completed", "cancelled"];

const PAGE_SIZE = 25;

const COMMISSION = 0.15;

function fmt(n: number | undefined | null, currency = "MAD") {
  if (n == null) return "-";
  return `${Number(n).toFixed(2)} ${currency}`;
}

function PersonCard({ person, role, color }: {
  person: TripPerson;
  role: string;
  color: "blue" | "green";
}) {
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.phone;
  const colorCls = color === "blue"
    ? { bg: "bg-blue-100", icon: "text-blue-600", label: "text-blue-600" }
    : { bg: "bg-green-100", icon: "text-green-600", label: "text-green-600" };
  const initials = `${(person.firstName ?? "")[0] ?? ""}${(person.lastName ?? "")[0] ?? ""}`.toUpperCase() || "?";

  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden">
        {person.photoUrl ? (
          <img
            src={person.photoUrl}
            alt={name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className={`w-9 h-9 rounded-full ${colorCls.bg} flex items-center justify-center text-xs font-semibold ${colorCls.icon}`}>
            {initials}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{name}</p>
        <p className="text-xs text-muted-foreground">{person.phone}</p>
        {person.email && (
          <p className="text-xs text-muted-foreground truncate">{person.email}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs font-medium ${colorCls.label}`}>{role}</span>
          {person.rating && (
            <span className="flex items-center gap-0.5 text-xs text-amber-500 font-medium">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {person.rating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteMap({ trip, mapsKey }: { trip: TripDetail; mapsKey: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasCoords = trip.pickupLat != null && trip.pickupLng != null
    && trip.dropoffLat != null && trip.dropoffLng != null;

  const osmUrl = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${trip.pickupLat}&mlon=${trip.pickupLng}#map=13/${trip.pickupLat}/${trip.pickupLng}`
    : null;

  if (!hasCoords || imgFailed || !mapsKey) {
    return (
      <div className="w-full h-32 bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center gap-2">
        <MapPin className="h-7 w-7 text-slate-400" />
        {osmUrl && (
          <a
            href={osmUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            View on map <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  }

  const pathParam = trip.routePolyline
    ? `path=enc:${encodeURIComponent(trip.routePolyline)}`
    : `path=color:0x3b82f6ff%7Cweight:3%7C${trip.pickupLat},${trip.pickupLng}%7C${trip.dropoffLat},${trip.dropoffLng}`;

  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=560x220`
    + `&markers=color:green%7Clabel:A%7C${trip.pickupLat},${trip.pickupLng}`
    + `&markers=color:red%7Clabel:B%7C${trip.dropoffLat},${trip.dropoffLng}`
    + `&${pathParam}`
    + `&key=${encodeURIComponent(mapsKey)}`;

  return (
    <div className="w-full h-40 overflow-hidden relative group">
      <img
        src={mapUrl}
        alt="Route map"
        className="w-full h-full object-cover"
        onError={() => setImgFailed(true)}
      />
      {osmUrl && (
        <a
          href={osmUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-2 right-2 flex items-center gap-1 bg-white/90 text-xs text-blue-600 rounded px-2 py-1 shadow hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function TripDetailPanel({ tripId }: { tripId: string }) {
  const { data: tripData, isLoading } = useQuery({
    queryKey: ["admin", "trip-detail", tripId],
    queryFn: () => api<{ trip: TripDetail }>(`/admin/trips/${tripId}`),
    enabled: !!tripId,
  });

  const { data: settingsData } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<{ settings: AdminSettings }>("/admin/settings"),
    staleTime: 5 * 60 * 1000,
  });

  const trip = tripData?.trip;
  const mapsKey = settingsData?.settings?.googleMapsApiKeyWeb ?? "";

  const emailMut = useMutation({
    mutationFn: () => api<{ ok: boolean; sentTo: string }>(`/admin/trips/${tripId}/email-invoice`, {
      method: "POST",
      json: {},
    }),
    onSuccess: (res) => {
      toast.success(`Invoice sent to ${res.sentTo}`);
    },
    onError: (err: ApiError | Error) => {
      toast.error(err.message ?? "Failed to send invoice email.");
    },
  });

  const [isPdfDownloading, setIsPdfDownloading] = useState(false);

  const downloadPdf = async () => {
    setIsPdfDownloading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/trips/${tripId}/invoice.pdf`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${tripId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download PDF.");
    } finally {
      setIsPdfDownloading(false);
    }
  };

  // Prefer server-provided display envelopes so the rendered amounts/currency
  // always match the platform display currency (no client-side FX math, no
  // symbol/amount mismatch when displayCurrency != USD).
  const fbDisplay = trip?.fareBreakdownDisplay ?? null;
  const fb = fbDisplay ?? trip?.fareBreakdown;
  const currency =
    fbDisplay?.currency ??
    trip?.finalAmountDisplay?.displayCurrency ??
    fb?.currency ??
    "USD";
  const total = trip?.finalAmountDisplay?.displayAmount ?? trip?.finalAmount ?? 0;
  const commission = Math.round(total * COMMISSION * 100) / 100;
  const driverEarning = Math.round((total - commission) * 100) / 100;

  return (
    <div className="flex flex-col h-full">
      {isLoading ? (
        <div className="flex-1 p-6 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      ) : !trip ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Trip not found.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <RouteMap trip={trip} mapsKey={mapsKey} />

          <div className="p-5 space-y-5">
            {/* ID + status */}
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground truncate">{trip.id}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {trip.safetyAlert && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${trip.safetyAlert.status === "active" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                    <ShieldAlert className="h-3 w-3 shrink-0" />
                    {trip.safetyAlert.status === "active" ? "Safety Alert" : "Safety Alert (resolved)"}
                  </span>
                )}
                <StatusBadge variant={statusToVariant(trip.status)} className="capitalize">
                  {trip.status.replace(/_/g, " ")}
                </StatusBadge>
              </div>
            </div>

            {/* Route */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Route</p>
              <div className="flex gap-3">
                <div className="flex flex-col items-center pt-1 gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
                  <div className="w-px flex-1 bg-border min-h-4" />
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                </div>
                <div className="flex flex-col gap-3 flex-1 min-w-0">
                  <div>
                    <p className="text-sm font-medium leading-tight truncate">{trip.pickupLabel}</p>
                    {trip.pickupAddress && trip.pickupAddress !== trip.pickupLabel && (
                      <p className="text-xs text-muted-foreground truncate">{trip.pickupAddress}</p>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      {new Date(trip.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {" · "}
                      {new Date(trip.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-tight truncate">{trip.dropoffLabel}</p>
                    {trip.dropoffAddress && trip.dropoffAddress !== trip.dropoffLabel && (
                      <p className="text-xs text-muted-foreground truncate">{trip.dropoffAddress}</p>
                    )}
                    {trip.status === "completed" && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3 shrink-0" />
                        {new Date(trip.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {new Date(trip.updatedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Meta row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>{new Date(trip.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Car className="h-3.5 w-3.5 shrink-0" />
                <span>{trip.vehicleClass ? trip.vehicleClass.charAt(0).toUpperCase() + trip.vehicleClass.slice(1) : "-"}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{trip.estimatedDistanceKm.toFixed(1)} km</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>{trip.estimatedDurationMin} min (est.)</span>
              </div>
            </div>

            <hr className="border-border" />

            {/* Rider + Driver */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">People</p>
              <div className="space-y-3">
                {trip.rider && (
                  <PersonCard person={trip.rider} role="Rider" color="blue" />
                )}
                {trip.driver && (
                  <PersonCard person={trip.driver} role="Driver" color="green" />
                )}
                {trip.ratingScore != null && (
                  <div className="space-y-1 pl-12">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                      <span>Rider rated this trip {trip.ratingScore}/5</span>
                    </div>
                    {trip.ratingComment && (
                      <p className="text-xs text-muted-foreground italic">"{trip.ratingComment}"</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <hr className="border-border" />

            {/* Fare breakdown */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fare Breakdown</p>
              <table className="w-full text-sm">
                <tbody>
                  {fb?.base != null && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">Base fare</td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.base, currency)}</td>
                    </tr>
                  )}
                  {fb?.distance != null && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">
                        Distance {fb.distanceKm != null ? `(${fb.distanceKm.toFixed(1)} km)` : ""}
                      </td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.distance, currency)}</td>
                    </tr>
                  )}
                  {fb?.time != null && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">
                        Time {fb.durationMin != null ? `(${fb.durationMin} min)` : ""}
                      </td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.time, currency)}</td>
                    </tr>
                  )}
                  {fb?.peakSurcharge != null && fb.peakSurcharge > 0 && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">Peak surcharge</td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.peakSurcharge, currency)}</td>
                    </tr>
                  )}
                  {fb?.nightSurcharge != null && fb.nightSurcharge > 0 && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">Night surcharge</td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.nightSurcharge, currency)}</td>
                    </tr>
                  )}
                  {fb?.weatherSurcharge != null && fb.weatherSurcharge > 0 && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">
                        Weather surcharge{fb.weatherRuleName ? ` (${fb.weatherRuleName})` : ""}
                      </td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.weatherSurcharge, currency)}</td>
                    </tr>
                  )}
                  {fb?.airportPickupSurcharge != null && fb.airportPickupSurcharge > 0 && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">
                        Airport pickup surcharge{fb.airportPickupName ? ` (${fb.airportPickupName})` : ""}
                      </td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.airportPickupSurcharge, currency)}</td>
                    </tr>
                  )}
                  {fb?.airportDropoffSurcharge != null && fb.airportDropoffSurcharge > 0 && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">
                        Airport dropoff surcharge{fb.airportDropoffName ? ` (${fb.airportDropoffName})` : ""}
                      </td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.airportDropoffSurcharge, currency)}</td>
                    </tr>
                  )}
                  {fb?.waitingFee != null && fb.waitingFee > 0 && (
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">
                        Waiting fee {fb.waitingMin != null ? `(${fb.waitingMin} min)` : ""}
                      </td>
                      <td className="py-1.5 text-right font-medium">{fmt(fb.waitingFee, currency)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-border">
                    <td className="pt-2 font-semibold">Total</td>
                    <td className="pt-2 text-right font-bold text-base">{fmt(total, currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-muted-foreground text-xs">Commission (15%)</td>
                    <td className="py-1 text-right text-xs text-muted-foreground">{fmt(commission, currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-muted-foreground text-xs">Driver earning</td>
                    <td className="py-1 text-right text-xs text-muted-foreground">{fmt(driverEarning, currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-muted-foreground text-xs">Payment method</td>
                    <td className="py-1 text-right text-xs capitalize">{trip.paymentMethod}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Invoice actions — completed trips only */}
      {trip?.status === "completed" && (
        <div className="p-5 border-t border-border shrink-0 space-y-2">
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={emailMut.isPending || !trip.rider?.email}
              onClick={() => emailMut.mutate()}
              title={!trip.rider?.email ? "Rider has no email address on file" : undefined}
            >
              {emailMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              {emailMut.isPending ? "Sending…" : "Email Invoice"}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={isPdfDownloading}
              onClick={downloadPdf}
            >
              {isPdfDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isPdfDownloading ? "Downloading…" : "Download PDF"}
            </Button>
          </div>
          {!trip.rider?.email && (
            <p className="text-xs text-muted-foreground text-center">Rider has no email on file</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function TripsPage() {
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialStatus = params.get("status") ?? "all";
  const initialId = params.get("id") ?? null;
  const [statusFilter, setStatusFilter] = useState(VALID_STATUSES.includes(initialStatus) ? initialStatus : "all");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(initialId);

  useEffect(() => {
    const p = new URLSearchParams(search);
    const id = p.get("id");
    setSelectedTripId(id);
  }, [search]);

  const path = statusFilter !== "all" ? `/admin/trips?status=${statusFilter}` : "/admin/trips";
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "trips", statusFilter],
    queryFn: () => api<{ trips: Trip[] }>(path),
    refetchInterval: 10000,
  });

  const trips = data?.trips ?? [];
  const completed = trips.filter((t) => t.status === "completed").length;
  const inProgress = trips.filter((t) => t.status === "in_progress").length;
  const cancelled = trips.filter((t) => t.status === "cancelled").length;

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useSort<"createdAt" | "finalAmount" | "distanceKm" | "riderName" | "driverName">({
    key: "createdAt",
    direction: "desc",
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter((t) =>
      `${t.id} ${t.riderName} ${t.riderPhone} ${t.driverName} ${t.driverPhone} ${t.pickup} ${t.dropoff}`
        .toLowerCase()
        .includes(q),
    );
  }, [trips, query]);
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (t, k) => {
        if (k === "createdAt") return new Date(t.createdAt);
        return t[k];
      }),
    [filtered, sort],
  );
  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = query !== "" || statusFilter !== "all";
  const resetFilters = () => { setQuery(""); setStatusFilter("all"); setPage(1); };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">Trips</h1>
        <p className="text-muted-foreground text-sm mt-0.5">All rides with assigned drivers</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "In Progress", value: inProgress, color: "text-blue-600" },
          { label: "Completed", value: completed, color: "text-green-600" },
          { label: "Cancelled", value: cancelled, color: "text-red-600" },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <FilterBar hasActiveFilters={hasFilters} onClear={resetFilters}>
        <SearchInput
          value={query}
          onChange={(v) => { setQuery(v); setPage(1); }}
          placeholder="Search by trip ID, rider, driver, or address…"
          className="sm:w-72"
        />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="sm:w-[180px] h-9"><SelectValue placeholder="Filter status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Trips</SelectItem>
            <SelectItem value="driver_arriving">Driver Arriving</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columnCount={8}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={Route}
            title={hasFilters ? "No trips match" : "No trips yet"}
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Trips show up here once drivers accept rides."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Trip ID</TableHead>
            <SortableHeader sortKey="riderName" sort={sort} onSortChange={setSort} defaultDirection="asc">Rider</SortableHeader>
            <SortableHeader sortKey="driverName" sort={sort} onSortChange={setSort} defaultDirection="asc">Driver</SortableHeader>
            <TableHead>Route</TableHead>
            <SortableHeader sortKey="distanceKm" sort={sort} onSortChange={setSort} className="text-right">Dist.</SortableHeader>
            <SortableHeader sortKey="finalAmount" sort={sort} onSortChange={setSort} className="text-right">Amount</SortableHeader>
            <TableHead>Status</TableHead>
            <SortableHeader sortKey="createdAt" sort={sort} onSortChange={setSort}>Date</SortableHeader>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="trips"
          />
        }
      >
        {paged.map((trip) => (
          <TableRow
            key={trip.id}
            className="hover:bg-muted/20 cursor-pointer"
            onClick={() => setSelectedTripId(trip.id)}
          >
            <TableCell className="font-mono text-xs text-muted-foreground">{trip.id.slice(0, 8)}…</TableCell>
            <TableCell>
              <div className="font-medium text-xs">{trip.riderName}</div>
              <div className="text-xs text-muted-foreground">{trip.riderPhone}</div>
            </TableCell>
            <TableCell>
              <div className="font-medium text-xs">{trip.driverName}</div>
              <div className="text-xs text-muted-foreground">{trip.driverPhone}</div>
            </TableCell>
            <TableCell className="max-w-[180px]">
              <div className="text-xs truncate">{trip.pickup}</div>
              <div className="text-xs text-muted-foreground truncate">→ {trip.dropoff}</div>
            </TableCell>
            <TableCell className="text-right text-xs">{trip.distanceKm.toFixed(1)} km</TableCell>
            <TableCell className="text-right font-semibold text-xs">
              {trip.finalAmountDisplay
                ? formatAmount(
                    trip.finalAmountDisplay.displayAmount,
                    trip.finalAmountDisplay.displayCurrency,
                  )
                : trip.finalAmount != null
                  ? formatAmount(trip.finalAmount, displayCurrency.code)
                  : "-"}
            </TableCell>
            <TableCell>
              <StatusBadge variant={statusToVariant(trip.status)} className="capitalize">
                {trip.status.replace(/_/g, " ")}
              </StatusBadge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(trip.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Sheet open={!!selectedTripId} onOpenChange={(open) => { if (!open) setSelectedTripId(null); }}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
            <SheetTitle className="text-base">Trip Details</SheetTitle>
          </SheetHeader>
          {selectedTripId && <TripDetailPanel tripId={selectedTripId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
