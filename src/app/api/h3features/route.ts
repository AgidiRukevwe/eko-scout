// src/app/api/h3features/route.ts
import { NextResponse } from "next/server";
import { safeQuery } from "@/lib/db";
import { enrich_with_h3 } from "@/core/h3_utils";
import * as h3 from "h3-js";

async function geocodeWithGoogle(address: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const textQuery = `${address}, Lagos, Nigeria`;
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location"
      },
      body: JSON.stringify({ textQuery })
    });
    const data = await response.json();
    if (!data.places || !data.places.length) return null;
    return {
      lat: data.places[0].location.latitude,
      lng: data.places[0].location.longitude
    };
  } catch (e) {
    console.error("Google Maps geocoding error:", e);
    return null;
  }
}

async function geocodeAddress(address: string) {
  try {
    let query = address.trim();
    let searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query.toLowerCase().includes("lagos") ? query : query + ", Lagos, Nigeria"
    )}`;
    
    let response = await fetch(searchUrl, { headers: { "User-Agent": "eko-scout-app" } });
    let results = response.ok ? await response.json() : [];
    
    // Fallback: Exact raw address via OSM
    if ((!results || results.length === 0) && !query.toLowerCase().includes("lagos")) {
      searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
      response = await fetch(searchUrl, { headers: { "User-Agent": "eko-scout-app" } });
      results = response.ok ? await response.json() : [];
    }

    if (results && results.length > 0) {
      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon)
      };
    }
  } catch (e) {
    console.error("OSM Geocoding error:", e);
  }

  // Final Fallback: Google Maps Places API (much better at parsing full Nigerian street addresses)
  return await geocodeWithGoogle(address);
}

/**
 * Average an array of feature rows
 */
function aggregateFeatures(rows: any[]) {
  if (!rows || rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const aggregated: any = { ...rows[0] };
  const numericKeys = [
    "building_density", "poi_density", "road_density", 
    "activity_score", "mobility_score", "calm_score", 
    "congestion_score", "confidence_score", 
    "residential_score", "commercial_score"
  ];

  for (const key of numericKeys) {
    let sum = 0;
    for (const row of rows) {
      sum += (Number(row[key]) || 0);
    }
    aggregated[key] = Math.round(sum / rows.length);
  }

  const landUseCounts: Record<string, number> = {};
  for (const row of rows) {
    const type = row.land_use_type || "Unknown";
    landUseCounts[type] = (landUseCounts[type] || 0) + 1;
  }
  aggregated.land_use_type = Object.keys(landUseCounts).reduce((a, b) => landUseCounts[a] > landUseCounts[b] ? a : b);
  
  aggregated.h3_r9 = "AGGREGATED"; // Indicates this is an averaged result
  aggregated._aggregated_hex_count = rows.length;

  return aggregated;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");
    let h3Param = searchParams.get("h3");

    let targetLat: number | null = null;
    let targetLng: number | null = null;

    if (address) {
      const coords = await geocodeAddress(address);
      if (!coords || coords.lat == null || coords.lng == null) {
        return NextResponse.json({ error: "Could not resolve address to coordinates" }, { status: 404 });
      }
      targetLat = coords.lat;
      targetLng = coords.lng;
      
      const { h3_r9 } = enrich_with_h3(targetLat, targetLng);
      h3Param = h3_r9;
    }

    if (!h3Param) {
      return NextResponse.json({ error: "Either address or h3 query parameter is required" }, { status: 400 });
    }

    // Determine if the user queried a broad neighborhood (no numbers, short address)
    // or a specific building/street (contains numbers or very specific).
    const isBroadNeighborhood = address ? (!/\d/.test(address) && address.length < 30) : false;

    // Expand search radius: k=15 is a large radius (~2-3km) to compensate for the sparse 1550-row DB.
    // It guarantees we find the nearest data points.
    // Determine search radius: larger for specific addresses, smaller for broad neighborhoods
    const radius = isBroadNeighborhood ? 8 : 15; // 8 ≈ 1km, 15 ≈ 2‑3km
    const searchHexes = h3.gridDisk(h3Param, radius);
    
    let rows = await safeQuery<any>(
      "SELECT * FROM h3_r9_features WHERE h3_r9 = ANY($1::text[]) LIMIT 200",
      [searchHexes]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No features found near this location (DB is too sparse)" }, { status: 404 });
    }

    // If it's a specific address, sort by distance to the coordinate and average only the top 3 nearest hexes.
    // If it's a broad neighborhood like "Yaba", average EVERYTHING found in the area to give a macro view.
    if (targetLat != null && targetLng != null) {
       rows.sort((a, b) => {
          const [latA, lngA] = h3.cellToLatLng(a.h3_r9);
          const [latB, lngB] = h3.cellToLatLng(b.h3_r9);
          const distA = Math.pow(latA - targetLat!, 2) + Math.pow(lngA - targetLng!, 2);
          const distB = Math.pow(latB - targetLat!, 2) + Math.pow(lngB - targetLng!, 2);
          return distA - distB;
       });
       
       if (!isBroadNeighborhood) {
         rows = rows.slice(0, 3); // Highly local: Average only the 3 nearest hexes
       } else {
         rows = rows.slice(0, 50); // Broad view: Average up to 50 hexes around the center
       }
    }

    const result = aggregateFeatures(rows);
    if (result) {
      result.resolved_target_h3_r9 = h3Param;
      result.is_broad_aggregation = isBroadNeighborhood;
    }
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error in h3features GET API:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// No POST needed – this endpoint is read‑only.
