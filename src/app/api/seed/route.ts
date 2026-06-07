import { NextResponse } from "next/server";
import { sql, isDbConfigured } from "@/lib/db";

const lagosLocations: any[] = [];

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const expectedSecret = process.env.SEED_SECRET || "ekoscout-seed-123";

    if (secret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isDbConfigured) {
      return NextResponse.json(
        { error: "Database not configured. Set DATABASE_URL in environment." },
        { status: 400 }
      );
    }

    // Create table if not exists (redundancy safety)
    await sql(`
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        alternative_names TEXT[] NOT NULL DEFAULT '{}',
        parent_area TEXT NOT NULL,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        place_id TEXT,
        scores JSONB NOT NULL,
        details JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Seed data
    let insertedCount = 0;
    for (const loc of lagosLocations) {
      // Mock coordinates for the standard mock locations if not present
      let lat = null;
      let lng = null;
      if (loc.id === "admiralty-way") { lat = 6.4468; lng = 3.4735; }
      else if (loc.id === "chevron-drive") { lat = 6.4385; lng = 3.5350; }
      else if (loc.id === "sabo-yaba") { lat = 6.5095; lng = 3.3795; }
      else if (loc.id === "herbert-macaulay") { lat = 6.5050; lng = 3.3768; }
      else if (loc.id === "ikeja-gra") { lat = 6.5786; lng = 3.3547; }
      else if (loc.id === "allen-avenue") { lat = 6.5985; lng = 3.3533; }
      else if (loc.id === "ogudu-gra") { lat = 6.5765; lng = 3.4005; }
      else if (loc.id === "ikate") { lat = 6.4312; lng = 3.4988; }
      else if (loc.id === "jakande") { lat = 6.4338; lng = 3.5188; }
      else if (loc.id === "surulere-adeniran") { lat = 6.4988; lng = 3.3585; }
      else if (loc.id === "surulere-aguda") { lat = 6.4880; lng = 3.3368; }

      await sql(`
        INSERT INTO locations (id, name, alternative_names, parent_area, lat, lng, scores, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          alternative_names = EXCLUDED.alternative_names,
          parent_area = EXCLUDED.parent_area,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          scores = EXCLUDED.scores,
          details = EXCLUDED.details,
          updated_at = NOW();
      `, [
        loc.id,
        loc.name,
        loc.alternativeNames,
        loc.parentArea,
        lat,
        lng,
        JSON.stringify(loc.scores),
        JSON.stringify(loc.details)
      ]);
      insertedCount++;
    }

    return NextResponse.json({
      success: true,
      message: `Successfully seeded ${insertedCount} locations in Neon PostgreSQL.`,
    });
  } catch (error: any) {
    console.error("Seeding failed:", error);
    return NextResponse.json({ error: error.message || "Internal server error during seeding" }, { status: 500 });
  }
}
