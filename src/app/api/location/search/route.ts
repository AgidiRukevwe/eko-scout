import { NextResponse } from "next/server";

export const maxDuration = 30; // allow up to 30s for external geocoding calls

type Candidate = {
  label: string;
  lat: number;
  lng: number;
  type: string;
  place_id?: string;
};

/**
 * Perform a Google Places Text Search if an API key is configured.
 */
async function searchGooglePlaces(query: string): Promise<Candidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("region", "ng");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "eko-scout/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    if (!data.results) return [];
    return data.results.map((r: any) => ({
      label: r.formatted_address || r.name,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      type: r.types?.[0] ?? "unknown",
      place_id: r.place_id,
    }));
  } catch (err) {
    console.error("[eko-scout] Google Places error:", err);
    return [];
  }
}

/**
 * Query Photon geocoder (by Komoot, powered by OSM).
 * Much more lenient rate limits than Nominatim.
 * bbox = minLng,minLat,maxLng,maxLat
 */
async function searchPhoton(query: string): Promise<Candidate[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", "en");
  // Lagos metro bounding box — bias results toward this area
  url.searchParams.set("bbox", "2.70,6.20,4.20,6.95");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "eko-scout/1.0 (lagos-electricity-map)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.error("[eko-scout] Photon HTTP error:", res.status);
      return [];
    }
    const data = (await res.json()) as { features: any[] };
    if (!data.features) return [];
    console.log(`[eko-scout] Photon returned ${data.features.length} features for: "${query}"`);
    return data.features.map((f: any) => {
      const props = f.properties ?? {};
      const coords = f.geometry?.coordinates ?? [0, 0];
      // Build a readable label: name + street + city
      const parts = [props.name, props.street, props.city, props.state, props.country].filter(Boolean);
      return {
        label: parts.join(", "),
        lat: coords[1],
        lng: coords[0],
        type: props.osm_value ?? props.type ?? "unknown",
      };
    });
  } catch (err) {
    console.error("[eko-scout] Photon error:", err);
    return [];
  }
}

/**
 * Fallback to Nominatim if Photon fails entirely.
 * (Nominatim may be rate-limited; this is a last resort.)
 */
async function searchNominatim(query: string): Promise<Candidate[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ng");
  url.searchParams.set("limit", "10");
  url.searchParams.set("viewbox", "2.70,6.20,4.20,6.95");
  url.searchParams.set("bounded", "0");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "eko-scout/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("[eko-scout] Nominatim HTTP error:", res.status);
      return [];
    }
    const data = (await res.json()) as any[];
    console.log(`[eko-scout] Nominatim returned ${data.length} results for: "${query}"`);
    return data.map((r) => ({
      label: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      type: r.type,
    }));
  } catch (err) {
    console.error("[eko-scout] Nominatim error:", err);
    return [];
  }
}

const isInLagos = (lat: number, lng: number): boolean => {
  const minLat = 6.20;
  const maxLat = 6.95;
  const minLng = 2.70;
  const maxLng = 4.20;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
};

const distanceToLagos = (lat: number, lng: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const centerLat = 6.5244;
  const centerLng = 3.3792;
  const dLat = toRad(lat - centerLat);
  const dLng = toRad(lng - centerLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(centerLat)) *
      Math.cos(toRad(lat)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawQ = searchParams.get("q")?.trim();
    if (!rawQ) {
      return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
    }

    // Don't force "Lagos" in the query — Photon's bbox param handles location bias.
    // Just append Nigeria if not already present so we stay in-country.
    const q = /nigeria/i.test(rawQ) ? rawQ : `${rawQ}, Nigeria`;

    // 1. Google Places (if API key configured)
    let candidates = await searchGooglePlaces(q);

    // 2a. Photon — bbox-scoped (fast, precise)
    if (candidates.length === 0) {
      candidates = await searchPhoton(rawQ);
    }

    // 2b. Photon — Lagos-qualified query (catches local area names like "Iyana Era")
    if (candidates.length === 0) {
      candidates = await searchPhoton(`${rawQ} Lagos`);
    }

    // 3. Nominatim last resort
    if (candidates.length === 0) {
      candidates = await searchNominatim(q);
    }

    console.log(`[eko-scout] Query "${rawQ}" → ${candidates.length} candidates before filter`);

    // Filter to Lagos metro bounding box
    const filtered = candidates.filter((c) => {
      const valid =
        typeof c.lat === "number" &&
        typeof c.lng === "number" &&
        !isNaN(c.lat) &&
        !isNaN(c.lng) &&
        isInLagos(c.lat, c.lng);
      if (!valid) {
        console.log(`[eko-scout] Filtered OUT: "${c.label}" lat=${c.lat} lng=${c.lng}`);
      }
      return valid;
    });

    console.log(`[eko-scout] After Lagos filter: ${filtered.length} results`);

    // Sort by proximity to Lagos centre
    const sorted = filtered.sort(
      (a, b) => distanceToLagos(a.lat, a.lng) - distanceToLagos(b.lat, b.lng)
    );

    return NextResponse.json({ results: sorted });
  } catch (error: any) {
    console.error("[eko-scout] Location search error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
