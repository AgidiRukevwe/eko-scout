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

  // Build the base query – we query both POIs and buildings tables.
    const baseSql = `
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

  // Parameters ordering:
  // $1 = query latitude, $2 = query longitude,
  // $3 = radius (meters),
  // $4 = minLat, $5 = maxLat, $6 = minLng, $7 = maxLng,
  // $8 = category (optional)
  const params: any[] = [lat, lng, radius, minLat, maxLat, minLng, maxLng];
  if (category) params.push(category);

  const rows = await safeQuery<any>(baseSql, params);
  if (!rows) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const results: Record<string, { count: number; nearest_distance_meters: number }> = {};
  for (const row of rows) {
    const cat = (row.category as string).toLowerCase();
    results[cat] = {
      count: Number(row.count),
      nearest_distance_meters: Number(row.nearest_distance_meters)
    };
  }

  return NextResponse.json({ lat, lng, radius, results });
}
