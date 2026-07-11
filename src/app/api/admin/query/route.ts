import { NextResponse } from "next/server";
import { safeQuery } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { query, params } = await req.json();
    const result = await safeQuery(query, params || []);
    return NextResponse.json({ result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
