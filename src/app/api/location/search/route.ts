import { NextResponse } from "next/server";
import { executeLocationSearch } from "@/lib/locationSearch";

export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawQ = searchParams.get("q")?.trim();
    if (!rawQ) {
      return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
    }

    const sorted = await executeLocationSearch(rawQ);

    return NextResponse.json({ results: sorted });
  } catch (error: any) {
    console.error("[eko-scout] Location search error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
