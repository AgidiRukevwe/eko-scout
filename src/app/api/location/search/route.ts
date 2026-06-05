  import { NextResponse } from "next/server";
  // Using global fetch (Node 18+)

  type Candidate = {
    label: string;
    lat: number;
    lng: number;
    type: string; // street, neighborhood, landmark, admin area, etc.
    place_id?: string;
  };

  /**
   * Perform a Google Places Text Search if an API key is configured.
   * Returns an array of Candidate objects.
   */
  async function searchGooglePlaces(query: string): Promise<Candidate[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return [];
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("key", apiKey);
    // Restrict to Nigeria (country code NG) by adding region parameter
    url.searchParams.set("region", "ng");
    try {
      const res = await fetch(url.toString(), { headers: { "User-Agent": "eko-scout/1.0" } });
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
    } catch {
      return [];
    }
  }

  /**
   * Query OSM Nominatim with country=NG.
   */
  async function searchNominatim(query: string): Promise<Candidate[]> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "ng");
    url.searchParams.set("limit", "10");
    try {
      const res = await fetch(url.toString(), { headers: { "User-Agent": "eko-scout/1.0" } });
      if (!res.ok) return [];
      const data = (await res.json()) as any[];
      return data.map((r) => ({
        label: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        type: r.type,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Progressive token reduction fallback.
   * Reduces the query by stripping leading tokens iteratively.
   */
  async function progressiveSearch(originalQuery: string): Promise<Candidate[]> {
    const tokens = originalQuery.trim().split(/\s+/);
    let candidates: Candidate[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const subQuery = tokens.slice(i).join(" ");
      candidates = await searchNominatim(subQuery);
      if (candidates.length > 0) break;
    }
    return candidates;
  }

  const isInLagos = (lat: number, lng: number): boolean => {
    // const minLat = 6.45;
    // const maxLat = 6.80;
    // const minLng = 3.15;
    // const maxLng = 3.60;

    const minLat = 6.20;
const maxLat = 6.95;
const minLng = 2.70;
const maxLng = 4.20;

    return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
  };

  // Helper: haversine distance (meters) to Lagos city centre
  const distanceToLagos = (lat: number, lng: number): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const earthRadius = 6371000; // metres
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

  // Normalise query to bias Lagos
  const normalizeQuery = (q: string): string => {
    if (/lagos/i.test(q)) return q;
    return `${q}, Lagos, Nigeria`;
  };

  export async function GET(req: Request) {
    try {
      const { searchParams } = new URL(req.url);
      const rawQ = searchParams.get("q")?.trim();
      if (!rawQ) {
        return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
      }
      const q = normalizeQuery(rawQ);

      // 1. Google Places (if key present)
      let candidates = await searchGooglePlaces(q);
      // 2. Fallback to OSM Nominatim
      if (candidates.length === 0) {
        candidates = await searchNominatim(q);
      }
      // 3. Progressive token reduction fallback (only if still empty)
      if (candidates.length === 0) {
        candidates = await progressiveSearch(q);
      }

      // Filter to Lagos bounding box
      const filtered = candidates.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number' && isInLagos(c.lat, c.lng));

      // Sort by distance to Lagos centre (closest first)
      const sorted = filtered.sort(
        (a, b) => distanceToLagos(a.lat, a.lng) - distanceToLagos(b.lat, b.lng)
      );

      return NextResponse.json({ results: sorted });
    } catch (error: any) {
      console.error("Location search error:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
