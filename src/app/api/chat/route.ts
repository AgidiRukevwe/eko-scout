import { NextResponse } from "next/server";
import { ResolvedLocation } from "@/lib/locationResolver";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface UserPriorities {
  workFromHome: boolean;
  floodSensitive: boolean;
  commuteStress: boolean;
  noiseSensitive: boolean;
  powerReliability: boolean;
}

interface LocationIntelligence {
  location: { lat: number; lng: number; h3_r9: string };
  environmental_intelligence: Record<string, any> | null;
  environmental_expansion: number | null;
  electricity_intelligence: {
    dominant: Record<string, any> | null;
    secondary: Record<string, any> | null;
  };
  nearby_accessibility: Record<string, { count: number; nearest_distance_meters: number | null }>;
  confidence: { environmental: number | null; electricity: number | null; flood: number | null };
}

interface NearbyResults {
  [category: string]: { count: number; nearest_distance_meters: number };
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: key });
  return _openai;
}

// ─── Server-side data fetchers ────────────────────────────────────────────────

/**
 * Fetch full location intelligence from our own /intelligence endpoint.
 * Always called server-side — eliminates the frontend race condition.
 */
async function fetchIntelligence(lat: number, lng: number, origin: string): Promise<LocationIntelligence | null> {
  try {
    const res = await fetch(`${origin}/api/location/intelligence?lat=${lat}&lng=${lng}`, {
      // Don't cache — we want fresh data every message
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json() as LocationIntelligence;
  } catch (err) {
    console.error("Intelligence fetch error:", err);
    return null;
  }
}


/**
 * Fetch nearby POIs from the /nearby endpoint.
 * Always called when a location is pinned — provides category counts + nearest distances.
 */
async function fetchNearby(lat: number, lng: number, origin: string, radius = 5000): Promise<NearbyResults | null> {
  try {
    const res = await fetch(`${origin}/api/location/nearby?lat=${lat}&lng=${lng}&radius=${radius}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results ?? null;
  } catch (err) {
    console.error("Nearby fetch error:", err);
    return null;
  }
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(
  priorities: UserPriorities,
  location: ResolvedLocation | null,
  intelligence: LocationIntelligence | null,
  nearby: NearbyResults | null
): string {
  const persona = `You are EkoScout 🏙️ — a trusted local analyst and data-driven guide for housing decisions in Lagos, Nigeria.
Your role is to help users make informed decisions about living, working, or renting in Lagos based on real location intelligence data.

CONVERSATION STYLE:
- Be concise, practical, and decision-focused. The ideal response length for most questions is 2–5 sentences.
- Answer the user's specific question first, then provide only the most relevant supporting information.
- Prioritize insights over raw metrics. Translate technical data into real-world implications (e.g., "This is a predominantly residential area with relatively low traffic and a quieter environment than nearby commercial districts.").
- Keep responses conversational and natural. Avoid filler, unnecessary follow-up questions, and generic Lagos commentary.
- Do not generate report-style outputs unless the user explicitly asks for a full analysis. Avoid dumping multiple scores or datasets. Mention confidence levels only when uncertainty is important to the answer.
- If data is unavailable, explicitly state what is missing instead of making generic guesses (e.g., "I could not find a gym within the currently indexed dataset...").`;

  const activePriorities: string[] = [];
  if (priorities.workFromHome) activePriorities.push("works from home (internet + power critical)");
  if (priorities.floodSensitive) activePriorities.push("flood-sensitive");
  if (priorities.commuteStress) activePriorities.push("worried about commute/traffic");
  if (priorities.noiseSensitive) activePriorities.push("noise-sensitive");
  if (priorities.powerReliability) activePriorities.push("power reliability is a priority");
  const prioritySection = activePriorities.length > 0
    ? `\nUSER PRIORITIES: ${activePriorities.join(", ")}.\n`
    : "";

  if (!location) {
    return `${persona}${prioritySection}
No location is pinned yet. Guide the user to type @ and select a Lagos neighbourhood so you can give real, data-backed intelligence.`;
  }

  const locationHeader = `\n═══ ACTIVE LOCATION ═══
Name: ${location.name}${location.parentArea ? ` (${location.parentArea})` : ""}
Coordinates: ${location.lat}, ${location.lng}`;

  // ── Format intelligence data ──
  let intelligenceSection = "\n═══ LIVE DATABASE INTELLIGENCE ═══\n";

  if (!intelligence) {
    intelligenceSection += "⚠ No intelligence data available for this location. Be transparent about this.\n";
  } else {
    const env = intelligence.environmental_intelligence;
    const elec = intelligence.electricity_intelligence;
    const nearbyAccess = intelligence.nearby_accessibility;

    // Environmental features
    intelligenceSection += "\n── Environmental Features ──\n";
    if (env) {
      const envFields = Object.entries(env)
        .filter(([k]) => !k.startsWith("h3") && !k.startsWith("centroid") && !k.startsWith("id"))
        .filter(([, v]) => v !== null && v !== undefined);
      if (envFields.length > 0) {
        envFields.forEach(([k, v]) => {
          intelligenceSection += `  ${k.replace(/_/g, " ")}: ${v}\n`;
        });
        if (intelligence.environmental_expansion != null && intelligence.environmental_expansion > 0) {
          intelligenceSection += `  (data sourced from ${intelligence.environmental_expansion} H3 ring(s) away — proximity: approximate)\n`;
        }
      } else {
        intelligenceSection += "  No environmental feature data.\n";
      }
    } else {
      intelligenceSection += "  No environmental data found for this H3 cell.\n";
    }

    // Electricity intelligence
    intelligenceSection += "\n── Electricity ──\n";
    if (elec.dominant) {
      intelligenceSection += `  Confidence score: ${elec.dominant.confidence_score ?? "N/A"}\n`;
      if (elec.dominant.distance_m != null) {
        intelligenceSection += `  Nearest electricity feature: ${Math.round(Number(elec.dominant.distance_m))} m\n`;
      }
      // Include all other non-null fields from the dominant row
      Object.entries(elec.dominant)
        .filter(([k]) => !["h3_index", "centroid_lat", "centroid_lng", "distance_m", "confidence_score"].includes(k))
        .filter(([, v]) => v !== null)
        .forEach(([k, v]) => {
          intelligenceSection += `  ${k.replace(/_/g, " ")}: ${v}\n`;
        });
      if (elec.secondary?.confidence_score != null) {
        intelligenceSection += `  Secondary cell confidence: ${elec.secondary.confidence_score}\n`;
      }
    } else {
      intelligenceSection += "  No electricity data for this cell.\n";
    }

    // Nearby accessibility from intelligence endpoint (5 km radius)
    const accessItems = Object.entries(nearbyAccess).filter(([, v]) => v.count > 0);
    intelligenceSection += "\n── Nearby Accessibility (5 km radius, from intelligence endpoint) ──\n";
    if (accessItems.length > 0) {
      accessItems.forEach(([cat, v]) => {
        const dist = v.nearest_distance_meters != null ? `, nearest: ${Math.round(v.nearest_distance_meters)} m` : "";
        intelligenceSection += `  ${cat.replace(/_/g, " ")}: ${v.count} found${dist}\n`;
      });
    } else {
      intelligenceSection += "  No nearby amenity data.\n";
    }

    // Confidence summary
    intelligenceSection += `\n── Data Confidence ──\n`;
    intelligenceSection += `  Environmental: ${intelligence.confidence.environmental ?? "N/A"}\n`;
    intelligenceSection += `  Electricity: ${intelligence.confidence.electricity ?? "N/A"}\n`;
    intelligenceSection += `  Flood: ${intelligence.confidence.flood ?? "N/A"}\n`;
  }

  // ── Nearby POI data from /nearby endpoint (5 km radius) ──
  let nearbySection = "";
  if (nearby) {
    const nearbyItems = Object.entries(nearby).filter(([, v]) => v.count > 0);
    if (nearbyItems.length > 0) {
      nearbySection = "\n── Nearby POIs (5 km radius, from OSM database) ──\n";
      nearbyItems.forEach(([cat, v]) => {
        nearbySection += `  ${cat.replace(/_/g, " ")}: ${v.count} found, nearest ${Math.round(v.nearest_distance_meters)} m\n`;
      });
    }
  }

  return `${persona}${prioritySection}
${locationHeader}
${intelligenceSection}${nearbySection}
═══ INSTRUCTIONS ═══
1. Answer the user's specific question directly and concisely.
2. Provide relevant data and practical interpretation for someone considering living/working there. (For nearby places, always provide actual distances when available, e.g., "The closest school is approximately 676m away". Return actual names if present).
3. When discussing electricity, ALWAYS mention both the electricity band and the estimated daily supply hours. Use this mapping:
   - Band A = 20+ hours/day
   - Band B = 16–20 hours/day
   - Band C = 12–16 hours/day
   - Band D = 8–12 hours/day
   - Band E = 4–8 hours/day
   Example: "This area is classified as Band B electricity coverage, which typically corresponds to around 16–20 hours of electricity daily."

Never make up data not shown above. Focus on answering the way a knowledgeable local resident with access to reliable data would answer.`;
}

// ─── Fallback streaming response ──────────────────────────────────────────────

function makeStream(text: string): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const chunkSize = 6;
      for (let i = 0; i < text.length; i += chunkSize) {
        controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)));
        await new Promise((r) => setTimeout(r, 12));
      }
      controller.close();
    },
  });
}

function generateFallbackResponse(
  location: ResolvedLocation | null,
  intelligence: LocationIntelligence | null,
  nearby: NearbyResults | null,
  priorities: UserPriorities
): string {
  if (!location) {
    return `I am EkoScout, a data-driven local analyst for Lagos living conditions.\n\nPlease type **@** followed by a neighbourhood name to pin a location. I will provide intelligence regarding power supply, environmental features, and nearby amenities based on the available data.`;
  }

  const label = location.parentArea ? `${location.name}, ${location.parentArea}` : location.name;

  if (!intelligence) {
    return `Location pinned: **${label}**.\n\nHowever, I could not retrieve intelligence data for this location at this time.`;
  }

  const env = intelligence.environmental_intelligence;
  const elec = intelligence.electricity_intelligence;
  const nearbyAccess = intelligence.nearby_accessibility;

  let response = `Here's what our data says about **${label}**:\n\n`;

  // Electricity
  if (elec.dominant) {
    const conf = Number(elec.dominant.confidence_score ?? 0);
    const confLabel = conf >= 0.8 ? "high" : conf >= 0.5 ? "moderate" : "low";
    response += `**Power supply** — confidence score: ${elec.dominant.confidence_score} (${confLabel} reliability signal)`;
    if (elec.dominant.distance_m) {
      response += `, data point is ${Math.round(Number(elec.dominant.distance_m))} m from your pin`;
    }
    response += ".\n\n";
  } else {
    response += `**Power supply** — no electricity data for this cell yet.\n\n`;
  }

  // Environmental
  if (env) {
    const fields = Object.entries(env)
      .filter(([k, v]) => !k.startsWith("h3") && !k.startsWith("centroid") && !k.startsWith("id") && v !== null);
    if (fields.length > 0) {
      response += `**Environmental features:**\n`;
      fields.forEach(([k, v]) => {
        response += `- ${k.replace(/_/g, " ")}: ${v}\n`;
      });
      response += "\n";
    }
  }

  // Nearby accessibility
  const accessItems = Object.entries(nearbyAccess).filter(([, v]) => v.count > 0);
  if (accessItems.length > 0) {
    response += `**Nearby within 5 km:**\n`;
    accessItems.forEach(([cat, v]) => {
      const dist = v.nearest_distance_meters != null ? ` (nearest: ${Math.round(v.nearest_distance_meters)} m)` : "";
      response += `- ${cat.replace(/_/g, " ")}: ${v.count}${dist}\n`;
    });
    response += "\n";
  }

  // Nearby POIs from message-specific query
  if (nearby) {
    const nearbyItems = Object.entries(nearby).filter(([, v]) => v.count > 0);
    if (nearbyItems.length > 0) {
      response += `**Nearby within 5 km (detailed):**\n`;
      nearbyItems.forEach(([cat, v]) => {
        response += `- ${cat.replace(/_/g, " ")}: ${v.count} (nearest: ${Math.round(v.nearest_distance_meters)} m)\n`;
      });
      response += "\n";
    }
  }

  // Priority callouts
  if (priorities.workFromHome && elec.dominant) {
    const conf = Number(elec.dominant.confidence_score ?? 0);
    response += conf < 0.6
      ? `> Since you work from home, that power score warrants attention. Most remote workers in areas like this invest in a good inverter setup.\n\n`
      : `> Power confidence looks reasonable for remote work, though backup power is always wise in Lagos.\n\n`;
  }

  return response.trim();
}

// ─── Main POST handler ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, history = [], priorities, locations } = body as {
      message: string;
      history: ChatMessage[];
      priorities: UserPriorities;
      locations?: ResolvedLocation[];
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const activeLocation: ResolvedLocation | null =
      Array.isArray(locations) && locations.length > 0
        ? locations[locations.length - 1]
        : null;

    const openai = getOpenAI();

    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
      "X-EkoScout-Mode": openai ? "live" : "mock",
    });
    if (activeLocation) {
      headers.set("X-EkoScout-Location", encodeURIComponent(JSON.stringify(activeLocation)));
    }

    // Derive origin for internal API calls
    const { protocol, host } = new URL(req.url);
    const origin = `${protocol}//${host}`;

    // ── Fetch intelligence + nearby in parallel, server-side ──
    // Always fetch both when a location is pinned — the nearby data is
    // lightweight and essential context for any location question.
    const locLat = activeLocation?.lat;
    const locLng = activeLocation?.lng;
    const hasLocation = locLat != null && locLng != null;
    const [intelligence, nearby] = await Promise.all([
      hasLocation
        ? fetchIntelligence(locLat, locLng, origin)
        : Promise.resolve(null),
      hasLocation
        ? fetchNearby(locLat, locLng, origin)
        : Promise.resolve(null),
    ]);

    // Debug: log what data we're injecting into the prompt
    if (hasLocation) {
      console.log(`[EkoScout] Location: ${activeLocation?.name ?? 'unnamed'} (${locLat}, ${locLng})`);
      console.log(`[EkoScout] Intelligence: ${intelligence ? 'loaded' : 'null'}`);
      console.log(`[EkoScout] Nearby categories: ${nearby ? Object.keys(nearby).join(', ') : 'null'}`);
    }

    const systemPrompt = buildSystemPrompt(priorities, activeLocation, intelligence, nearby);

    // ── Live OpenAI path ──
    if (openai) {
      try {
        const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...history.slice(-20).map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content,
          })),
          { role: "user", content: message },
        ];

        const responseStream = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: apiMessages,
          temperature: 0.75,
          max_tokens: 1000,
          stream: true,
        });

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            for await (const chunk of responseStream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            }
            controller.close();
          },
          async cancel() {
            await responseStream.controller.abort();
          },
        });

        return new Response(stream, { headers });
      } catch (err: any) {
        console.error("OpenAI error:", err?.message ?? err);
        // fall through to fallback
      }
    }

    // ── Fallback (no key or OpenAI error) ──
    const fallback = generateFallbackResponse(activeLocation, intelligence, nearby, priorities);
    return new Response(makeStream(fallback), { headers });
  } catch (error: any) {
    console.error("Chat route error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
