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

// Electricity intelligence – discrete zone lookup using electricity_h3_features
async function fetchElectricityIntelligence(lat: number, lng: number) {
  const { h3_r9: baseCell } = enrich_with_h3(lat, lng);

  // Exact match first
  let rows = await safeQuery<any>(
    `
    SELECT *
    FROM electricity_h3_features
    WHERE h3_index = $1
    `,
    [baseCell]
  );

  if (rows?.length) {
    return {
      row: rows[0],
      expansion: 0,
    };
  }

  // Expand outward until we find a coverage cell
  const maxRing = 20;

  for (let k = 1; k <= maxRing; k++) {
    const candidateCells = h3.gridDisk(baseCell, k) as string[];

    rows = await safeQuery<any>(
      `
      SELECT *
      FROM electricity_h3_features
      WHERE h3_index = ANY($1::text[])
      ORDER BY confidence_score DESC
      LIMIT 1
      `,
      [candidateCells]
    );

    if (rows?.length) {
      return {
        row: rows[0],
        expansion: k,
      };
    }
  }

  return {
    row: null,
    expansion: null,
  };
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

  // Electricity intelligence – use h3_staging_power with neighbor expansion (k=0..2)
  const electricity = await fetchElectricityIntelligence(lat, lng);
  // fetchElectricityIntelligence returns { row: object | null, expansion: null }
  // We'll embed the row directly in the response.


  // Flood intelligence – exact match only, null if absent.
  const flood = await fetchRow<any>("flood", h3_r9);

  // Nearby accessibility – use configurable radius.
  const nearby = await fetchNearbyAccessibility(lat, lng, radius);

  const response = {
    location: { lat, lng, h3_r9 },
    environmental_intelligence: env.row,
    environmental_expansion: env.expansion, // 0 = exact, 1‑3 = expanded, null = not found
    electricity_intelligence: electricity.row,
    electricity_expansion: electricity.expansion,
    // flood_intelligence: flood ?? null,
    nearby_accessibility: nearby,
    confidence: {
      environmental: env.row?.confidence_score ?? null,
      electricity: electricity.row?.confidence_score ?? null,
      flood: flood?.confidence_score ?? null
    }
  };

  return NextResponse.json(response);
}
