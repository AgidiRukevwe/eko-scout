// src/app/api/location/intelligence/route.ts
import { NextResponse } from "next/server";
import { safeQuery } from "@/lib/db";
import { enrich_with_h3 } from "@/core/h3_utils";

export const dynamic = "force-dynamic";
import * as h3 from "h3-js";
import {
  getKRingCells,
  filterTowersByRadius,
  scoreAllCarriers,
  type RawTower,
  type H3NetworkFeatures,
} from "@/core/network_score";

// ---------- Types ----------
/** Row returned from the electricity_h3_features table */
interface ElectricityRow {
  h3_index: string;
  centroid_lat: number;
  centroid_lng: number;
  confidence_score?: number;
  distance_m?: number;
}
/** Result of fetchElectricityIntelligence */
interface ElectricityResult {
  dominant: ElectricityRow | null;
  secondary: ElectricityRow | null;
  nearest_bands?: Record<string, { distance_m: number, lat: number, lng: number, name: string | null } | null>;
}
/** Generic row type for H3 feature tables */
interface H3FeatureRow {
  h3_r9: string;
  confidence_score?: number;
  [key: string]: any;
}


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

async function fetchNearestElectricityBands(lat: number, lng: number) {
  const bands = ['A', 'B', 'C', 'D', 'E'];
  const results: Record<string, { distance_m: number, lat: number, lng: number, name: string | null } | null> = {};
  
  await Promise.all(bands.map(async (band) => {
    const sql = `
      SELECT e.centroid_lat, e.centroid_lng, (6371000 * acos(
        cos(radians($1)) * cos(radians(e.centroid_lat)) *
        cos(radians(e.centroid_lng) - radians($2)) +
        sin(radians($1)) * sin(radians(e.centroid_lat))
      )) AS distance_m,
      (SELECT r.name FROM osm_roads r WHERE r.h3_r9 = e.h3_index AND r.name IS NOT NULL LIMIT 1) as area_name
      FROM electricity_h3_features e
      WHERE e.dominant_band = $3 AND e.centroid_lat IS NOT NULL
      ORDER BY distance_m ASC
      LIMIT 1;
    `;
    const rows = await safeQuery<any>(sql, [lat, lng, band]);
    if (rows && rows.length > 0) {
      results[band] = {
        distance_m: Number(rows[0].distance_m),
        lat: rows[0].centroid_lat,
        lng: rows[0].centroid_lng,
        name: rows[0].area_name || null
      };
    } else {
      results[band] = null;
    }
  }));
  return results;
}

async function fetchElectricityIntelligence(lat: number, lng: number): Promise<ElectricityResult> {
  // Determine the base H3 cell at resolution 9 for the location
  const baseCell = h3.latLngToCell(lat, lng, 9);
  // Get a set of nearby cells (radius 3 rings) to limit the search space
  const nearbyCells = h3.gridDisk(baseCell, 3) as string[];
  if (nearbyCells.length === 0) {
    return { dominant: null, secondary: null };
  }
  // Build placeholders for the IN clause ($3, $4, ...)
  const placeholders = nearbyCells.map((_, i) => `$${i + 3}`).join(', ');
  const distanceSql = `
    SELECT *, (6371000 * acos(
      cos(radians($1)) * cos(radians(centroid_lat)) *
      cos(radians(centroid_lng) - radians($2)) +
      sin(radians($1)) * sin(radians(centroid_lat))
    )) AS distance_m
    FROM electricity_h3_features
    WHERE h3_index IN (${placeholders})
    ORDER BY distance_m ASC
    LIMIT 2;
  `;
  const rows = await safeQuery<ElectricityRow>(distanceSql, [lat, lng, ...nearbyCells]);
  const dominant = rows?.[0] ?? null;
  const secondary = rows?.[1] && rows[1].distance_m && rows[1].distance_m <= 5000 ? rows[1] : null;
  
  const nearest_bands = await fetchNearestElectricityBands(lat, lng);
  
  return { dominant, secondary, nearest_bands };
}

/**
 * Network intelligence — property-level tower lookup.
 *
 * Steps:
 *   1. Convert lat/lng to H3 R9 cell.
 *   2. Build k=2 gridDisk (19 cells).
 *   3. Query all opencellid_raw towers within that disk.
 *   4. Filter by technology-specific max radius (5G/LTE: 2 km, 3G/GSM: 5 km).
 *   5. Fetch the H3 aggregated features row for coarse context.
 *   6. Score all four carriers via scoreAllCarriers().
 */
async function fetchNetworkIntelligence(lat: number, lng: number) {
  // Step 1-2: k=2 ring
  const ringCells = getKRingCells(lat, lng, 2);
  const placeholders = ringCells.map((_, i) => `$${i + 1}`).join(', ');

  // Step 3: Fetch all candidate towers from the ring
  const towerRows = await safeQuery<RawTower>(
    `SELECT carrier_name, radio, latitude, longitude, samples
     FROM opencellid_raw
     WHERE h3_r9 IN (${placeholders})`,
    ringCells
  );

  // Step 4: Filter by technology-specific radius
  const candidateTowers: RawTower[] = (towerRows ?? []).map((r) => ({
    carrier_name: r.carrier_name,
    radio:        r.radio,
    latitude:     Number(r.latitude),
    longitude:    Number(r.longitude),
    samples:      Number(r.samples),
  }));
  const nearbyTowers = filterTowersByRadius(candidateTowers, lat, lng);

  // Step 5: Fetch H3 aggregated features (exact cell only — used for context bonus)
  const h3Cell = h3.latLngToCell(lat, lng, 9);
  const featureRows = await safeQuery<H3NetworkFeatures>(
    `SELECT * FROM h3_network_features WHERE h3_index = $1`,
    [h3Cell]
  );
  const features: H3NetworkFeatures | null = featureRows?.[0] ?? null;

  // Step 6: Score all carriers
  return scoreAllCarriers(features, nearbyTowers, lat, lng);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius")) || 2000; // default 2 km for nearby queries

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "Missing or invalid lat/lng parameters" }, { status: 400 });
  }

  // Compute H3 R9 cell.
  const { h3_r9 } = enrich_with_h3(lat, lng);

  // Environmental intelligence – expand up to 3 rings.
  const env = await fetchWithExpansion<H3FeatureRow>("h3_r9_features", h3_r9, 3);

  // Electricity intelligence – limited to nearby H3 cells.
  const electricity = await fetchElectricityIntelligence(lat, lng);

  // Network (mobile connectivity) intelligence – k=2 ring, tech-specific radius filter.
  const network = await fetchNetworkIntelligence(lat, lng);

  // Nearby accessibility – aggregated per category.
  const nearby = await fetchNearbyAccessibility(lat, lng, radius);

  const response = {
    location: { lat, lng, h3_r9 },
    environmental_intelligence: env.row,
    environmental_expansion: env.expansion,
    electricity_intelligence: electricity,
    network_intelligence: network,
    // flood_intelligence: flood ?? null,
    nearby_accessibility: nearby,
    confidence: {
      environmental: env.row?.confidence_score ?? null,
      electricity: electricity.dominant?.confidence_score ?? null,
      network: network.confidence_score ?? null,
      flood: null // flood?.confidence_score ?? null
    }
  };

  return NextResponse.json(response);
}
