// src/app/api/location/nearby/route.ts
import { NextResponse } from "next/server";
import { safeQuery } from "@/lib/db";

/**
 * Haversine distance in metres (fallback when PostGIS is not available).
 */
const haversineExpr = `6371000 * acos(
  cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
  sin(radians($1)) * sin(radians(lat))
)`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius")); // metres
  const category = searchParams.get("category")?.toLowerCase() ?? null;

  // Basic validation
  if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius) || radius <= 0) {
    return NextResponse.json(
      { error: "Missing or invalid query parameters. Provide lat, lng and radius (positive number)." },
      { status: 400 }
    );
  }

  // Bounding‑box pre‑filter (approximation for quick index use)
  const earthRadius = 6371000; // metres
  const latDelta = (radius / earthRadius) * (180 / Math.PI);
  const lngDelta = (radius / earthRadius) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLng = lng - lngDelta;
  const maxLng = lng + lngDelta;

  // ── 1. Summary query: count + nearest per category ──────────────────────────
  const summarySql = `
    SELECT
      category,
      COUNT(*) AS count,
      MIN(distance) AS nearest_distance_meters
    FROM (
      SELECT
        category,
        ${haversineExpr} AS distance
      FROM osm_pois
      WHERE lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7
      UNION ALL
      SELECT
        building_type AS category,
        ${haversineExpr} AS distance
      FROM osm_buildings
      WHERE lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7
    ) sub
    WHERE distance <= $3
    ${category ? "AND LOWER(category) = $8" : ""}
    GROUP BY category
    ORDER BY category;
  `;

  // ── 2. Named places query: top 5 per category (only named POIs) ─────────────
  // IMPORTANT: Uses its own param array ($1=lat,$2=lng,$3=minLat,$4=maxLat,$5=minLng,$6=maxLng)
  // so there are no gaps (summarySql uses $3=radius which namedSql doesn't need).
  const namedSql = `
    SELECT
      category,
      name,
      ${haversineExpr} AS distance_meters
    FROM osm_pois
    WHERE
      lat BETWEEN $3 AND $4
      AND lng BETWEEN $5 AND $6
      AND name IS NOT NULL
      AND name <> ''
      AND LOWER(name) <> 'unknown'
      ${category ? "AND LOWER(category) = $7" : ""}
    ORDER BY distance_meters ASC
    LIMIT 200;
  `;

  const summaryParams: any[] = [lat, lng, radius, minLat, maxLat, minLng, maxLng];
  if (category) summaryParams.push(category);

  const namedParams: any[] = [lat, lng, minLat, maxLat, minLng, maxLng];
  if (category) namedParams.push(category);

  const [summaryRows, namedRows] = await Promise.all([
    safeQuery<any>(summarySql, summaryParams),
    safeQuery<any>(namedSql, namedParams),
  ]);


  if (!summaryRows) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Build summary map
  const results: Record<string, {
    count: number;
    nearest_distance_meters: number;
    named_places: Array<{ name: string; distance_meters: number }>;
  }> = {};

  for (const row of summaryRows) {
    const cat = (row.category as string).toLowerCase();
    results[cat] = {
      count: Number(row.count),
      nearest_distance_meters: Number(row.nearest_distance_meters),
      named_places: [],
    };
  }

  // Group named places by category (top 5 per category, within radius)
  if (namedRows) {
    const seenPerCat: Record<string, number> = {};
    for (const row of namedRows) {
      const cat = (row.category as string).toLowerCase();
      const dist = Number(row.distance_meters);
      if (dist > radius) continue;
      if (!results[cat]) continue; // skip cats not in summary
      seenPerCat[cat] = (seenPerCat[cat] ?? 0);
      if (seenPerCat[cat] < 5) {
        results[cat].named_places.push({ name: row.name, distance_meters: Math.round(dist) });
        seenPerCat[cat]++;
      }
    }
  }

  return NextResponse.json({ lat, lng, radius, results });
}
