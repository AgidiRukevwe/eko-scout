import { NextResponse } from "next/server";
import { safeQuery } from "@/lib/db";

// Cache this endpoint globally since it relies on static dataset.
export const dynamic = "force-dynamic";

/**
 * Global Intelligence Route
 * Fetches notable streets/areas for top bands and features across Lagos.
 * This is used when the user asks global questions like "Which areas have Band A light?"
 */
export async function GET() {
  try {
    const electricityBands = ['A', 'B', 'C'];
    const electricitySummary: Record<string, string[]> = {};

    await Promise.all(electricityBands.map(async (band) => {
      // Find up to 15 distinct streets in cells that have this electricity band
      const sql = `
        SELECT DISTINCT r.name
        FROM osm_roads r
        JOIN electricity_h3_features e ON r.h3_r9 = e.h3_index
        WHERE e.dominant_band = $1 AND r.name IS NOT NULL AND length(r.name) > 3
        LIMIT 15;
      `;
      const rows = await safeQuery<any>(sql, [band]);
      electricitySummary[band] = (rows || []).map(r => r.name);
    }));

    // Find high activity areas (top 15 streets in cells with highest activity score)
    const activitySql = `
      SELECT DISTINCT r.name
      FROM osm_roads r
      JOIN h3_r9_features h ON r.h3_r9 = h.h3_r9
      WHERE r.name IS NOT NULL AND length(r.name) > 3
      ORDER BY h.activity_score DESC
      LIMIT 15;
    `;
    const activityRows = await safeQuery<any>(activitySql);
    const activitySummary = (activityRows || []).map(r => r.name);

    return NextResponse.json({
      electricity: electricitySummary,
      high_activity: activitySummary
    });
  } catch (error: any) {
    console.error("Global intelligence error:", error);
    return NextResponse.json({ error: "Failed to fetch global intelligence" }, { status: 500 });
  }
}
