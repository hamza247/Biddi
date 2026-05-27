import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export interface FareBreakdown {
  currency: string;
  base: number;
  distance: number;
  distanceKm: number;
  pricePerKm: number;
  time: number;
  durationMin: number;
  pricePerMin: number;
  peakMultiplier: number;
  peakSurcharge: number;
  nightMultiplier: number;
  nightSurcharge: number;
  subtotal: number;
  minimumFare: number;
  minimumApplied: boolean;
  waitingMin: number;
  waitingFee: number;
  fareModel: "incremental" | "fixed";
  pool: boolean;
  total: number;
  weatherSurcharge?: number;
  weatherMultiplier?: number;
  weatherReason?: string;
  weatherRuleName?: string;
}

/**
 * Fetches a server-computed fare breakdown for the given vehicle type and
 * route parameters. Re-fetches automatically whenever any input changes.
 * Skips the request when distanceKm or durationMin is zero/negative.
 */
export function useFareEstimate(
  vehicleTypeId: string | null,
  distanceKm: number,
  durationMin: number,
  pickupLat?: number,
  pickupLng?: number,
): { breakdown: FareBreakdown | null; loading: boolean } {
  const [breakdown, setBreakdown] = useState<FareBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (distanceKm <= 0 || durationMin <= 0) {
      setBreakdown(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams({
      km: String(distanceKm),
      min: String(durationMin),
    });

    if (vehicleTypeId && !vehicleTypeId.startsWith("fallback-")) {
      params.set("vehicleTypeId", vehicleTypeId);
    }
    if (typeof pickupLat === "number" && typeof pickupLng === "number") {
      params.set("lat", String(pickupLat));
      params.set("lng", String(pickupLng));
    }

    setLoading(true);

    api<{ breakdown: FareBreakdown }>(`/fare-estimate?${params.toString()}`)
      .then((r) => {
        if (!controller.signal.aborted) {
          setBreakdown(r.breakdown);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBreakdown(null);
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [vehicleTypeId, distanceKm, durationMin, pickupLat, pickupLng]);

  return { breakdown, loading };
}

/**
 * Fetches fare estimates for multiple vehicle types in parallel.
 * Returns a map of vehicleTypeId → FareBreakdown.
 */
export function useFareEstimates(
  vehicleTypeIds: string[],
  distanceKm: number,
  durationMin: number,
  pickupLat?: number,
  pickupLng?: number,
): { estimates: Record<string, FareBreakdown>; loading: boolean; error: boolean } {
  const [estimates, setEstimates] = useState<Record<string, FareBreakdown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const keyRef = useRef<string>("");

  useEffect(() => {
    if (vehicleTypeIds.length === 0 || distanceKm <= 0 || durationMin <= 0) {
      setEstimates({});
      setLoading(false);
      setError(false);
      return;
    }

    const key = `${vehicleTypeIds.join(",")}|${distanceKm}|${durationMin}|${pickupLat ?? ""}|${pickupLng ?? ""}`;
    if (keyRef.current === key) return;
    keyRef.current = key;

    let cancelled = false;
    setLoading(true);

    Promise.all(
      vehicleTypeIds
        .filter((id) => !id.startsWith("fallback-"))
        .map(async (id) => {
          const params = new URLSearchParams({
            km: String(distanceKm),
            min: String(durationMin),
            vehicleTypeId: id,
          });
          if (typeof pickupLat === "number" && typeof pickupLng === "number") {
            params.set("lat", String(pickupLat));
            params.set("lng", String(pickupLng));
          }
          try {
            const r = await api<{ breakdown: FareBreakdown }>(
              `/fare-estimate?${params.toString()}`,
            );
            return [id, r.breakdown] as const;
          } catch {
            return null;
          }
        }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, FareBreakdown> = {};
      let anyFailure = false;
      for (const entry of results) {
        if (entry) map[entry[0]] = entry[1];
        else anyFailure = true;
      }
      if (anyFailure) {
        keyRef.current = "";
      }
      const allFailed = results.length > 0 && Object.keys(map).length === 0;
      setError(allFailed);
      setEstimates(map);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [vehicleTypeIds.join(","), distanceKm, durationMin, pickupLat, pickupLng]);

  return { estimates, loading, error };
}
