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
    nearest_bands?: Record<string, { distance_m: number; lat: number; lng: number; name: string | null } | null>;
  };
  nearby_accessibility: Record<string, { count: number; nearest_distance_meters: number | null }>;
  confidence: { environmental: number | null; electricity: number | null; flood: number | null };
}

interface NearbyResults {
  [category: string]: {
    count: number;
    nearest_distance_meters: number;
    named_places: Array<{ name: string; distance_meters: number }>;
  };
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

async function fetchGlobalIntelligence(origin: string): Promise<any> {
  try {
    const res = await fetch(`${origin}/api/location/global`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Global fetch error:", err);
    return null;
  }
}

function buildSystemPrompt(
  priorities: UserPriorities,
  locationData: Array<{ location: ResolvedLocation; intelligence: LocationIntelligence | null; nearby: NearbyResults | null }>,
  globalData: any
): string {
  const persona = `You are EkoScout 🏙️ — a trusted local analyst and data-driven guide for housing decisions in Lagos, Nigeria.
Your role is to help users make informed decisions about living, working, or renting in Lagos based on real location intelligence data.

CONVERSATION STYLE:
- Be concise, practical, and decision-focused. The ideal response length for most questions is 2–5 sentences.
- Answer the user's specific question first, then provide only the most relevant supporting information.
- Prioritize insights over raw metrics. Translate technical data into real-world implications (e.g., "This is a predominantly residential area with relatively low traffic and a quieter environment than nearby commercial districts.").
- Keep responses conversational and natural. Avoid filler, unnecessary follow-up questions, and generic Lagos commentary.
- Do not generate report-style outputs unless the user explicitly asks for a full analysis. Avoid dumping multiple scores or datasets. Mention confidence levels only when uncertainty is important to the answer.
- If data is unavailable, explicitly state what is missing instead of making generic guesses (e.g., "I could not find a gym within the currently indexed dataset...").
- CRITICAL CONTEXT: In Nigeria, "Band A", "Band B", "Band C", "Band D", and "Band E" refer strictly to electricity supply tariffs and guaranteed daily power hours. NEVER assume "Band A" refers to property tax, council tax, or land use charge. If the user asks about a band, they are asking about electricity.`;

  const activePriorities: string[] = [];
  if (priorities.workFromHome) activePriorities.push("works from home (internet + power critical)");
  if (priorities.floodSensitive) activePriorities.push("flood-sensitive");
  if (priorities.commuteStress) activePriorities.push("worried about commute/traffic");
  if (priorities.noiseSensitive) activePriorities.push("noise-sensitive");
  if (priorities.powerReliability) activePriorities.push("power reliability is a priority");
  const prioritySection = activePriorities.length > 0
    ? `\nUSER PRIORITIES: ${activePriorities.join(", ")}.\n`
    : "";

  let globalSection = "";
  if (globalData) {
    globalSection += `\n═══ GLOBAL LAGOS INTELLIGENCE ═══\n`;
    if (globalData.electricity) {
      globalSection += `Notable areas by power supply:\n`;
      ['A', 'B', 'C'].forEach(band => {
        if (globalData.electricity[band] && globalData.electricity[band].length > 0) {
          globalSection += `- Band ${band}: ${globalData.electricity[band].slice(0, 8).join(', ')}\n`;
        }
      });
    }
    if (globalData.high_activity && globalData.high_activity.length > 0) {
      globalSection += `\nNotable high activity / commercial areas:\n`;
      globalSection += `- ${globalData.high_activity.slice(0, 8).join(', ')}\n`;
    }
    globalSection += `(Use this global intelligence if the user asks broad questions like "which areas have Band A").\n`;
  }

  if (locationData.length === 0) {
    return `${persona}${prioritySection}${globalSection}
No location is pinned yet. You can answer global questions using the Global Lagos Intelligence above. To get specific data, guide the user to type @ and select a Lagos neighbourhood or use their Current Location.`;
  }

  let intelligenceSection = "";

  // ── OSM category → human-readable alias ─────────────────────────────────
  const OSM_ALIASES: Record<string, string> = {
    hotel:           "Hotels / Accommodation",
    sport:           "Gyms / Fitness centres / Sports facilities",
    amenity:         "General amenities (unclassified)",
    fast_food:       "Fast food restaurants",
    restaurant:      "Restaurants / Eateries",
    bank:            "Banks / ATMs",
    atm:             "ATMs",
    hospital:        "Hospitals / Medical centres",
    clinic:          "Clinics / Health posts",
    pharmacy:        "Pharmacies / Chemists",
    health_centre:   "Health centres",
    school:          "Schools / Primary & secondary education",
    college:         "Colleges / Polytechnics",
    university:      "Universities",
    church:          "Churches",
    mosque:          "Mosques",
    place_of_worship: "Places of worship (unspecified denomination)",
    bus_station:     "Bus stops / Bus stations",
    train_station:   "Train stations / Railway stations",
    ferry_terminal:  "Ferry terminals",
    fuel:            "Petrol stations / Filling stations",
    marketplace:     "Markets / Marketplaces",
    supermarket:     "Supermarkets",
    shop:            "Shops / Retail stores",
    retail:          "Retail / Shopping",
    commercial:      "Commercial buildings / Office complexes",
    office:          "Office buildings",
    library:         "Libraries",
    internet_cafe:   "Cybercafés / Internet cafés",
    stadium:         "Stadiums / Sports arenas",
    grandstand:      "Grandstands / Viewing areas",
    parking:         "Car parks / Parking lots",
    police:          "Police stations",
    fire_station:    "Fire stations",
    civic:           "Civic / Government buildings",
    industrial:      "Industrial / Warehouse buildings",
    residential:     "Residential buildings",
    apartments:      "Apartment buildings",
    dormitory:       "Dormitories / Hostels",
    construction:    "Construction sites",
    vending_machine: "Vending machines",
    grave_yard:      "Cemeteries / Burial grounds",
    roof:            "Rooftop structures",
    ruins:           "Ruins / Abandoned structures",
    fixme:           "Unclassified / needs review",
    building:        "General buildings",
    house:           "Houses / Residential homes",
    semidetached_house: "Semi-detached houses",
    yes:             "Generic / unclassified features",
  };

  locationData.forEach((data, index) => {
    const { location, intelligence, nearby } = data;
    
    intelligenceSection += `\n═══ LOCATION ${index + 1}: ${location.name.toUpperCase()} ═══\n`;
    intelligenceSection += `Name: ${location.name}${location.parentArea ? ` (${location.parentArea})` : ""}\n`;
    intelligenceSection += `Coordinates: ${location.lat}, ${location.lng}\n`;

    if (!intelligence) {
      intelligenceSection += "⚠ No intelligence data available for this location.\n";
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

      if (elec.nearest_bands) {
        intelligenceSection += `\n  ── Nearest Electricity Sectors by Band ──\n`;
        ['A', 'B', 'C', 'D', 'E'].forEach(band => {
          const b = elec.nearest_bands![band];
          if (b) {
            const locDesc = b.name ? b.name : `coordinates ${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`;
            intelligenceSection += `    Band ${band}: ${Math.round(b.distance_m)}m away (near ${locDesc})\n`;
          }
        });
        intelligenceSection += `  (If user asks "closest area that has band a", use the distances and area names above. NEVER output raw lat/long coordinates to the user. Always use the area/street name).\n`;
      }

      // Nearby accessibility
      const accessItems = Object.entries(nearbyAccess).filter(([, v]) => v.count > 0);
      intelligenceSection += "\n── Nearby Accessibility (5 km radius) ──\n";
      if (accessItems.length > 0) {
        accessItems.forEach(([cat, v]) => {
          const dist = v.nearest_distance_meters != null ? `, nearest: ${Math.round(v.nearest_distance_meters)} m` : "";
          intelligenceSection += `  ${cat.replace(/_/g, " ")}: ${v.count} found${dist}\n`;
        });
      } else {
        intelligenceSection += "  No nearby amenity data.\n";
      }

      // Data Confidence
      intelligenceSection += `\n── Data Confidence ──\n`;
      intelligenceSection += `  Environmental: ${intelligence.confidence.environmental ?? "N/A"}\n`;
      intelligenceSection += `  Electricity: ${intelligence.confidence.electricity ?? "N/A"}\n`;
      intelligenceSection += `  Flood: ${intelligence.confidence.flood ?? "N/A"}\n`;
    }

    // Nearby POIs
    if (nearby) {
      const nearbyItems = Object.entries(nearby).filter(([, v]) => v.count > 0);
      if (nearbyItems.length > 0) {
        intelligenceSection += `\n── Nearby POIs (5 km radius) ──\n`;
        nearbyItems.forEach(([cat, v]) => {
          const alias = OSM_ALIASES[cat] ?? cat.replace(/_/g, " ");
          if (v.named_places && v.named_places.length > 0) {
            intelligenceSection += `  [${alias}] — ${v.count} total, nearest ${Math.round(v.nearest_distance_meters)}m:\n`;
            v.named_places.forEach((p) => {
              const streetLabel = p.distance_meters < 100 ? " (on same street)" : ` — ${p.distance_meters}m away`;
              intelligenceSection += `    • ${p.name}${streetLabel}\n`;
            });
          } else {
            intelligenceSection += `  [${alias}] — ${v.count} found, nearest ${Math.round(v.nearest_distance_meters)}m (no names)\n`;
          }
        });
      }
    }
  });


  return `${persona}${prioritySection}${globalSection}
${intelligenceSection}
═══ INSTRUCTIONS ═══
1. Answer the user's specific question directly and concisely. Ideal response: 2–5 sentences.
2. For amenity questions, look up the EXACT MATCHING alias in the Nearby POIs section above. For example:
   - "hotel" → look at [Hotels / Accommodation]
   - "gym" or "fitness" → look at [Gyms / Fitness centres / Sports facilities]
   - "church" → look at [Churches]
   - "market" → look at [Markets / Marketplaces]
3. When named places exist, say: "The closest [amenity] is [Name], approximately [Xm] away." When a place is <100m, say it is "located directly on this street" or "within the immediate street corridor."
4. When a category exists but NO named places exist (e.g., "no individual names in dataset"), say explicitly: "There are [X] [hotels/gyms/etc.] mapped nearby (the closest is [Y]m away), but their specific names are not recorded in the dataset." DO NOT substitute with a different category like 'general amenities'.
5. When a category DOES NOT EXIST in the list above, explicitly say: "I couldn't find any [gyms/hotels/etc.] mapped in the current dataset near this location."
6. When discussing electricity, ALWAYS mention both band and estimated daily supply hours:
   - Band A = 20+ h/day | Band B = 16–20 | Band C = 12–16 | Band D = 8–12 | Band E = 4–8
   Example: "This area is Band B — typically 16–20 hours of electricity daily."
7. Prioritize recognizable landmarks (e.g. University of Lagos, National Stadium) over unnamed POIs.
8. Never invent data not shown above. State explicitly when something is not in the dataset.

Response hierarchy for amenity questions:
• Places on the same street → walking distance → wider neighbourhood → distance-only fallback.`;
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
  locationData: Array<{ location: ResolvedLocation; intelligence: LocationIntelligence | null; nearby: NearbyResults | null }>,
  priorities: UserPriorities
): string {
  if (locationData.length === 0) {
    return `I am EkoScout, a data-driven local analyst for Lagos living conditions.\n\nPlease type **@** followed by a neighbourhood name to pin a location. I will provide intelligence regarding power supply, environmental features, and nearby amenities based on the available data.`;
  }

  let response = "";
  locationData.forEach((data) => {
    const { location, intelligence, nearby } = data;
    const label = location.parentArea ? `${location.name}, ${location.parentArea}` : location.name;

    if (!intelligence) {
      response += `Location pinned: **${label}**.\n\nHowever, I could not retrieve intelligence data for this location at this time.\n\n`;
      return;
    }

    const env = intelligence.environmental_intelligence;
    const elec = intelligence.electricity_intelligence;
    const nearbyAccess = intelligence.nearby_accessibility;

    response += `Here's what our data says about **${label}**:\n\n`;

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
  });

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

    const activeLocations: ResolvedLocation[] = Array.isArray(locations) ? locations : [];
    
    const openai = getOpenAI();

    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
      "X-EkoScout-Mode": openai ? "live" : "mock",
    });
    if (activeLocations.length > 0) {
      headers.set("X-EkoScout-Location", encodeURIComponent(JSON.stringify(activeLocations[0])));
    }

    const { protocol, host } = new URL(req.url);
    const origin = `${protocol}//${host}`;

    const [locationData, globalData] = await Promise.all([
      Promise.all(
        activeLocations
          .filter((loc) => loc.lat != null && loc.lng != null)
          .map(async (loc) => {
            const [intelligence, nearby] = await Promise.all([
              fetchIntelligence(loc.lat as number, loc.lng as number, origin),
              fetchNearby(loc.lat as number, loc.lng as number, origin),
            ]);
            return { location: loc, intelligence, nearby };
          })
      ),
      fetchGlobalIntelligence(origin)
    ]);

    const systemPrompt = buildSystemPrompt(priorities, locationData, globalData);

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
    const fallback = generateFallbackResponse(locationData, priorities);
    return new Response(makeStream(fallback), { headers });
  } catch (error: any) {
    console.error("Chat route error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
