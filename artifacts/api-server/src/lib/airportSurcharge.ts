import { and, eq } from "drizzle-orm";
import {
  db,
  serviceAreasTable,
  airportSurchargesTable,
  type AirportSurchargeType,
} from "@workspace/db";

export interface AirportZoneHit {
  airportLocationId: string;
  airportName: string;
  surchargeType: AirportSurchargeType;
  /** The pickup or dropoff value, depending on which side resolved this hit. */
  surchargeValue: number;
}

export interface ResolvedAirportSurcharge {
  pickup: AirportZoneHit | null;
  dropoff: AirportZoneHit | null;
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance between two lat/lng points, in meters. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const a =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/** Resolves any airport surcharge that should apply for the pickup and/or
 *  dropoff points of a ride. Returns null entries when no active airport zone
 *  for this vehicle type contains that side's coordinates. */
export async function resolveAirportSurcharge(
  vehicleTypeId: string | null | undefined,
  pickup: { lat: number | null; lng: number | null } | null,
  dropoff: { lat: number | null; lng: number | null } | null,
): Promise<ResolvedAirportSurcharge> {
  if (!vehicleTypeId) return { pickup: null, dropoff: null };

  const rows = await db
    .select({
      airportLocationId: serviceAreasTable.id,
      airportName: serviceAreasTable.name,
      centerLat: serviceAreasTable.centerLat,
      centerLng: serviceAreasTable.centerLng,
      radiusM: serviceAreasTable.radiusM,
      surchargeType: airportSurchargesTable.surchargeType,
      pickupSurchargeValue: airportSurchargesTable.pickupSurchargeValue,
      dropoffSurchargeValue: airportSurchargesTable.dropoffSurchargeValue,
    })
    .from(airportSurchargesTable)
    .innerJoin(
      serviceAreasTable,
      eq(serviceAreasTable.id, airportSurchargesTable.airportLocationId),
    )
    .where(
      and(
        eq(airportSurchargesTable.vehicleTypeId, vehicleTypeId),
        eq(airportSurchargesTable.active, true),
        eq(serviceAreasTable.active, true),
        eq(serviceAreasTable.type, "airport_surcharge"),
      ),
    );

  type Row = (typeof rows)[number];
  const pickHit = (
    point: { lat: number | null; lng: number | null } | null,
    side: "pickup" | "dropoff",
  ): AirportZoneHit | null => {
    if (!point || point.lat == null || point.lng == null) return null;
    let best: { row: Row; dist: number } | null = null;
    for (const r of rows) {
      if (
        r.centerLat == null ||
        r.centerLng == null ||
        r.radiusM == null ||
        r.radiusM <= 0
      ) {
        continue;
      }
      const dist = haversineMeters(point.lat, point.lng, r.centerLat, r.centerLng);
      if (dist > r.radiusM) continue;
      if (!best || dist < best.dist) best = { row: r, dist };
    }
    if (!best) return null;
    return {
      airportLocationId: best.row.airportLocationId,
      airportName: best.row.airportName,
      surchargeType: best.row.surchargeType,
      surchargeValue:
        side === "pickup"
          ? best.row.pickupSurchargeValue
          : best.row.dropoffSurchargeValue,
    };
  };

  return {
    pickup: pickHit(pickup, "pickup"),
    dropoff: pickHit(dropoff, "dropoff"),
  };
}
