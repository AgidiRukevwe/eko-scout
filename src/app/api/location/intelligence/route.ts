// src/app/api/location/intelligence/route.ts
import { NextResponse } from "next/server";
import { safeQuery } from "@/lib/db";
import { enrich_with_h3 } from "@/core/h3_utils";
import * as h3 from "h3-js";

/**
 * Helper to fetch a row from a table for a given H3 cell.
 * Returns the row if found, otherwise null.
 */
async function fetchRow<T = any>(table: string, h3cell: string): Promise<T | null> {
  const rows = await safeQuery<T>(`SELECT * FROM ${table} WHERE h3_r9 = $1`, [h3cell]);
  if (rows && rows.length) return rows[0];
  return null;
}

/**
 * Search for a row within a radius of k rings around the target H3 cell.
 * Returns the first found row and the ring distance used (0 = exact match).
 */
async function fetchWithExpansion<T = any>(table: string, baseCell: string, maxRing: number) {
  // First try exact match (k=0)
  const exact = await fetchRow<T>(table, baseCell);
  if (exact) return { row: exact, expansion: 0 };
  // Iterate rings k=1..maxRing
  for (let k = 1; k <= maxRing; k++) {
    const ringCells = h3.gridDisk(baseCell, k) as string[]; // includes inner cells as well
    const placeholders = ringCells.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await safeQuery<T>(`SELECT * FROM ${table} WHERE h3_r9 IN (${placeholders}) LIMIT 1`, ringCells);
    if (rows && rows.length) return { row: rows[0], expansion: k };
  }
  return { row: null, expansion: null };
}

/**
 * Nearby accessibility intelligence – queries POIs within a configurable radius.
 * Returns per‑category count and nearest distance (metres).
 */
async function fetchNearbyAccessibility(lat: number, lng: number, radius = 5000) {
  // Haversine expression used in the SQL query.
  const haversineExpr = `6371000 * acos(
    cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
    sin(radians($1)) * sin(radians(lat))
  )`;
  // Categories we care about – map to the column used in OSM POIs.
  const categories = [
    "school",
    "hospital",
    "pharmacy",
    "supermarket",
    "market",
    "bus_stop",
    "gym",
    "place_of_worship"
  ];
  const results: Record<string, { count: number; nearest_distance_meters: number | null }> = {};
  for (const cat of categories) {
    const sql = `SELECT COUNT(*) AS count, MIN(${haversineExpr}) AS nearest_distance_meters
                 FROM osm_pois
                 WHERE category = $3
                   AND ${haversineExpr} <= $4`;
    const rows = await safeQuery<any>(sql, [lat, lng, cat, radius]);
    if (rows && rows.length) {
      const row = rows[0];
      results[cat] = {
        count: Number(row.count),
        nearest_distance_meters: row.nearest_distance_meters ? Number(row.nearest_distance_meters) : null
      };
    } else {
      results[cat] = { count: 0, nearest_distance_meters: null };
    }
  }
  return results;

}

// Electricity intelligence – nearest neighbor lookup using centroids
async function fetchElectricityIntelligence(lat: number, lng: number) {
// baseCell not needed for distance query
  const distanceSql = `
    SELECT *, (6371000 * acos(
      cos(radians($1)) * cos(radians(centroid_lat)) *
      cos(radians(centroid_lng) - radians($2)) +
      sin(radians($1)) * sin(radians(centroid_lat))
    )) AS distance_m
    FROM electricity_h3_features
    ORDER BY distance_m ASC
    LIMIT 2;
  `;
  const rows = await safeQuery<any>(distanceSql, [lat, lng]);
  const dominant = rows[0] ?? null;
  const secondary = rows[1] && rows[1].distance_m <= 5000 ? rows[1] : null;
  return { dominant, secondary };
}

// Helper to convert degrees to radians
function toRadians(deg: number) {
  return (deg * Math.PI) / 180;
}



export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius")) || 2000; // for nearby query, default 2 km

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "Missing or invalid lat/lng parameters" }, { status: 400 });
  }

  // Compute H3 R9 cell.
  const { h3_r9 } = enrich_with_h3(lat, lng);

  // Environmental intelligence (h3_r9_features) – expand up to k=3.
  const env = await fetchWithExpansion<any>("h3_r9_features", h3_r9, 3);

// Electricity intelligence – nearest neighbor lookup using centroids
const electricityResult = await fetchElectricityIntelligence(lat, lng);
// dominant and secondary records (may be null)
const electricity = {
  dominant: electricityResult.dominant,
  secondary: electricityResult.secondary
};

// Flood intelligence – exact match only, null if absent.
const flood = await fetchRow<any>("flood", h3_r9);

// Nearby accessibility – use configurable radius.
const nearby = await fetchNearbyAccessibility(lat, lng, radius);

const response = {
  location: { lat, lng, h3_r9 },
  environmental_intelligence: env.row,
  environmental_expansion: env.expansion, // 0 = exact, 1‑3 = expanded, null = not found
  electricity_intelligence: electricity,
  // flood_intelligence: flood ?? null,
  nearby_accessibility: nearby,
  confidence: {
    environmental: env.row?.confidence_score ?? null,
    electricity: electricity.dominant?.confidence_score ?? null,
    flood: flood?.confidence_score ?? null
  }
};

  return NextResponse.json(response);
}
