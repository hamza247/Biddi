/** Ray-casting point-in-polygon. Accepts GeoJSON Polygon or MultiPolygon
 *  in either {lng, lat} or [lng, lat] form. Returns false on any parse
 *  failure so the caller can fall back to "open" service areas. */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygonJson: string | null,
): boolean {
  if (!polygonJson) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(polygonJson);
  } catch {
    return false;
  }
  type Ring = Array<[number, number]>;
  const polygons: Ring[][] = [];
  const toRing = (raw: unknown): Ring | null => {
    if (!Array.isArray(raw)) return null;
    const out: Ring = [];
    for (const p of raw) {
      if (
        Array.isArray(p) &&
        p.length >= 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
      ) {
        out.push([p[0] as number, p[1] as number]);
      } else if (
        p &&
        typeof p === "object" &&
        typeof (p as { lng?: number }).lng === "number" &&
        typeof (p as { lat?: number }).lat === "number"
      ) {
        out.push([(p as { lng: number }).lng, (p as { lat: number }).lat]);
      } else {
        return null;
      }
    }
    return out;
  };
  const consume = (geom: any): void => {
    if (!geom) return;
    if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
      const rings = (geom.coordinates as unknown[])
        .map(toRing)
        .filter((r): r is Ring => !!r);
      if (rings.length) polygons.push(rings);
    } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
      for (const poly of geom.coordinates) {
        const rings = (poly as unknown[])
          .map(toRing)
          .filter((r): r is Ring => !!r);
        if (rings.length) polygons.push(rings);
      }
    } else if (Array.isArray(geom)) {
      const ring = toRing(geom);
      if (ring) polygons.push([ring]);
    }
  };
  consume(parsed);
  if (polygons.length === 0) return false;

  const inRing = (ring: Ring): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  return polygons.some((rings) => {
    const [outer, ...holes] = rings;
    if (!inRing(outer)) return false;
    return !holes.some((h) => inRing(h));
  });
}
