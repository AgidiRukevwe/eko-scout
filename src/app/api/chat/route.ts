import { NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveLocation, ResolvedLocation } from "@/lib/locationResolver";

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

// Disable static rendering for API route (make it dynamic)
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, history = [], priorities } = body as {
      message: string;
      history: ChatMessage[];
      priorities: UserPriorities;
    };

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // 1. Resolve location from message (DB first, Google Maps second)
    const matchedLoc = await resolveLocation(message);

    // Get API Keys if available
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const isLive = !!openAiApiKey;

    // Construct metadata headers
    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
      "X-EkoScout-Mode": isLive ? "live" : "mock",
    });

    if (matchedLoc) {
      // Safely encode JSON to prevent HTTP header formatting issues
      headers.set("X-EkoScout-Location", encodeURIComponent(JSON.stringify(matchedLoc)));
    }

    // 2. If OpenAI key is present, use OpenAI with streaming
    if (isLive) {
      try {
        const openai = new OpenAI({ apiKey: openAiApiKey });
        const systemPrompt = constructSystemPrompt(priorities, matchedLoc);
        
        const apiMessages = [
          { role: "system" as const, content: systemPrompt },
          ...history.map(h => ({ role: h.role as "user" | "assistant" | "system", content: h.content })),
          { role: "user" as const, content: message }
        ];

        const responseStream = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 800,
          stream: true,
        });

        // Create a ReadableStream from the OpenAI stream
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            for await (const chunk of responseStream) {
              const text = chunk.choices[0]?.delta?.content || "";
              if (text) {
                controller.enqueue(encoder.encode(text));
              }
            }
            controller.close();
          },
        });

        return new Response(stream, { headers });
      } catch (err) {
        console.error("OpenAI API call failed, falling back to mock intelligence:", err);
      }
    }

    // 3. Fallback/Mock Mode: Generate mock intelligence response and stream it to user
    const responseText = generateMockIntelligenceResponse(message, priorities, matchedLoc);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Stream text word-by-word with small delay to simulate typing
        const words = responseText.split(" ");
        for (let i = 0; i < words.length; i++) {
          controller.enqueue(encoder.encode(words[i] + (i === words.length - 1 ? "" : " ")));
          // Yield to main thread & simulate latency (around 30ms per word)
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        controller.close();
      },
    });

    return new Response(stream, { headers });

  } catch (error: any) {
    console.error("Error in chat API route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

function constructSystemPrompt(priorities: UserPriorities, location: ResolvedLocation | null): string {
  const isGoogle = location?.isGooglePlace;

  return `You are "EkoScout", a highly practical, conversational, and grounded AI living-condition assistant for Lagos, Nigeria.
Your job is to help users understand what living in a specific street, junction, landmark, or neighborhood in Lagos is ACTUALLY like before they visit it.

PRIMARY INSTRUCTIONS:
1. Tone: Practical, realistic, empathetic, conversational, and transparent about street-level uncertainty.
2. Vocabulary: Use authentic Nigerian context terms where appropriate (e.g., "Band A grid power", "danfo", "korope", "area boys", "estimated billing", "inverter load", "up-Island", "mainland").
3. Nuance: Do NOT sound overly confident. Use phrases like:
   - "Internet quality varies street by street here."
   - "Reports around this area are mixed."
   - "Flooding tends to worsen during heavy rainfall."
   - "Traffic becomes significantly worse during weekday evenings."
4. Customization: The user has set the following priorities. You must tailor your response to highlight how the location fares against these:
   - Work From Home / Remote Work: ${priorities.workFromHome ? "CRITICAL (Needs stable internet & power)" : "Neutral"}
   - Flood Sensitivity: ${priorities.floodSensitive ? "CRITICAL (Flooding is a dealbreaker)" : "Neutral"}
   - Commute Stress: ${priorities.commuteStress ? "CRITICAL (Hates traffic, needs good transit access)" : "Neutral"}
   - Noise Sensitivity: ${priorities.noiseSensitive ? "CRITICAL (Needs quiet, family-friendly area)" : "Neutral"}
   - Power Reliability: ${priorities.powerReliability ? "CRITICAL (Needs constant or highly stable power)" : "Neutral"}

LOCATION CONTEXT:
${location ? `We resolved location information for: "${location.name}".
- Parent Area: ${location.parentArea}
${location.formattedAddress ? `- Resolved Address via Google Maps: ${location.formattedAddress}` : ""}
${location.lat && location.lng ? `- Coordinates: Latitude ${location.lat}, Longitude ${location.lng}` : ""}
${isGoogle ? `
NOTE: This location was resolved dynamically via Google Maps but EkoScout has no verified surveyor audits for it yet. 
You must explicitly mention that this is an unverified area. Tell the user what you know generally about the parent area (${location.parentArea}) and offer general advice based on their priorities. Be open about the lack of specific street-level survey data.
` : `
Use this verified hyperlocal survey data as your ground truth:
- Ratings (out of 5, where 5 is best/most favorable):
  * Internet: ${location.scores.internet}/5 (Details: ${location.details.internet.status}. Breakdown: ${location.details.internet.breakdown}. Recommended ISPs: ${location.details.internet.recommendedISPs.join(", ")})
  * Power: ${location.scores.power}/5 (Details: ${location.details.power.status}. Breakdown: ${location.details.power.breakdown}. Backup: ${location.details.power.backupOptions}. Billing: ${location.details.power.billing})
  * Drainage/Flooding: ${location.scores.flooding}/5 (Higher is better/less flood risk. Details: ${location.details.flooding.status}. Breakdown: ${location.details.flooding.breakdown}. Seasonality: ${location.details.flooding.seasonality})
  * Traffic/Commute: ${location.scores.traffic}/5 (Higher is better/less traffic. Details: ${location.details.traffic.status}. Breakdown: ${location.details.traffic.breakdown}. Peak Hours: ${location.details.traffic.peakHours}. Transit: ${location.details.traffic.transitAccess})
  * Quietness: ${location.scores.noise}/5 (Higher is better/quieter. Details: ${location.details.noise.status}. Breakdown: ${location.details.noise.breakdown}. Sources: ${location.details.noise.sources.join(", ")})
  * Safety: ${location.scores.safety}/5 (Details: ${location.details.safety.status}. Breakdown: ${location.details.safety.breakdown}. Security Type: ${location.details.safety.securityType})
  * Vibe: ${location.details.lifestyle.vibe}
  * Remote Work suitability: ${location.details.lifestyle.remoteWork}
  * Walkability: ${location.details.lifestyle.walkability}
  * Advice: ${location.details.lifestyle.generalAdvice}
`}
` : "No specific match was found in our database or Google Maps for this exact location. Answer based on general knowledge of the area, but explicitly state your uncertainty. Remind the user that Lagos is extremely micro-local and conditions can change from one street to the next."}

Remember, you are an advisor, not a sales agent. Be extremely honest. If an area floods or is noisy, say so plainly. Provide practical tips (e.g. tell them to inspect the walls for dampness, or visit the area at 10 PM on a Friday).`;
}

// Local mock intelligence response generator when OpenAI is not configured
function generateMockIntelligenceResponse(
  message: string,
  priorities: UserPriorities,
  location: ResolvedLocation | null
): string {
  if (!location) {
    return `I couldn't match the exact street or landmark you mentioned to our database or Google Maps. In Lagos, living conditions are extremely micro-local; one street can have 24/7 power while the very next street is in darkness for days.
    
Could you try asking about a specific street (e.g., *Admiralty Way*, *Chevron Drive*, *Sabo Yaba*, *Adeniran Ogunsanya*, or *Ikeja GRA*)?

*Tip: You can ask things like "Does Chevron Drive flood?" or "Is Sabo Yaba good for remote work?"*`;
  }

  const { name, scores, details } = location;
  const isGoogle = location.isGooglePlace;

  let text = `Here is a practical lifestyle audit for **${name}** based on local reports.\n\n`;

  if (isGoogle) {
    text += `⚠️ **Unverified Location:** We resolved this location via Google Maps at *${location.formattedAddress}*, but we do not have verified street-level survey data for it yet.\n\n`;
    text += `### General Area Vibe (${location.parentArea})\nThis area is general Mainland or Island territory. Conditions vary street-by-street. Be sure to check the neighborhood profile during high tide or heavy rains.\n\n`;
    
    // Advice based on priorities
    const adviceList = [];
    if (priorities.workFromHome) adviceList.push("- **Remote Work:** Verify ISP fiber routing directly. Do not assume estate generators provide constant power.");
    if (priorities.floodSensitive) adviceList.push("- **Flooding:** Check gutters. If they are filled with stagnant dark silt, the road is highly likely to pool during downpours.");
    if (priorities.commuteStress) adviceList.push("- **Traffic:** Commuting routes depend heavily on exits to the major expressways.");
    if (priorities.noiseSensitive) adviceList.push("- **Quietness:** Inner residential closes are usually tranquil, but properties close to commercial streets are heavily subject to shop generator noise.");
    if (priorities.powerReliability) adviceList.push("- **Power Profile:** Ask if the building is on a Band A grid line, or check generator run-schedules (many estates turn them off at 9 AM).");
    
    if (adviceList.length > 0) {
      text += `### Recommendations for your Filters:\n${adviceList.join("\n")}\n\n`;
    }
    
    text += `### EkoScout Inspection Advice\n💡 Visit the street at 8 PM on a weekday to audit noise, and inspect concrete walls for tide lines or rising damp before renting.`;
    return text;
  }

  // 1. Vibe & Overview
  text += `### The Vibe\n${details.lifestyle.vibe} Generally, safety is rated at **${scores.safety}/5** (${details.safety.status}).\n\n`;

  // 2. Tailoring to user priorities
  const priorityComments: string[] = [];

  if (priorities.workFromHome) {
    if (scores.internet >= 4 && scores.power >= 4) {
      priorityComments.push(`Since you **work remotely**, this is a highly viable location. The internet is rated **${scores.internet}/5** (${details.internet.status}) and power is **${scores.power}/5** (${details.power.status}). ${details.lifestyle.remoteWork}`);
    } else {
      priorityComments.push(`As a **remote worker**, please note: while the internet is rated **${scores.internet}/5**, grid power sits at **${scores.power}/5** (${details.power.status}). You will definitely need a robust backup (inverter or solar) to survive here without constant interruption.`);
    }
  }

  if (priorities.floodSensitive) {
    if (scores.flooding <= 2) {
      priorityComments.push(`⚠️ **Flooding is a major concern here.** We rate this area's flood resistance at just **${scores.flooding}/5** (${details.flooding.status}). During heavy rainfall from June to September, adjacent streets become waterlogged. ${details.flooding.breakdown}`);
    } else if (scores.flooding === 3) {
      priorityComments.push(`🌧️ **Moderate flood risk.** The drainage is rated **${scores.flooding}/5**. Some parts are elevated, but access roads can gather deep puddles during downpours. ${details.flooding.breakdown}`);
    } else {
      priorityComments.push(`✅ **Flood resistance is high (${scores.flooding}/5).** ${details.flooding.status}. The terrain is higher, and drainages work well, so water drains quickly.`);
    }
  }

  if (priorities.commuteStress) {
    if (scores.traffic <= 2) {
      priorityComments.push(`🚗 **Commute stress is high.** Traffic is rated **${scores.traffic}/5** (${details.traffic.status}). During rush hours, expect significant gridlocks. ${details.traffic.breakdown}`);
    } else {
      priorityComments.push(`🚦 **Commute is relatively manageable (${scores.traffic}/5).** ${details.traffic.status} It's central enough that ride-hailing is fast and connections to bridges are straightforward.`);
    }
  }

  if (priorities.noiseSensitive) {
    if (scores.noise <= 2) {
      priorityComments.push(`🤫 **Noise is a problem here.** Quietness is rated **${scores.noise}/5** (${details.noise.status}). Nightlife, clubs, or traffic echo are dominant. ${details.noise.breakdown}`);
    } else {
      priorityComments.push(`🤫 **Quiet and peaceful.** Quietness is rated **${scores.noise}/5** (${details.noise.status}). It is mostly residential and sheltered from commercial hum.`);
    }
  }

  if (priorities.powerReliability && !priorities.workFromHome) {
    priorityComments.push(`⚡ **Power Profile:** Rated **${scores.power}/5** (${details.power.status}). ${details.power.breakdown} Billing is via ${details.power.billing}.`);
  }

  if (priorityComments.length > 0) {
    text += `### How It Fits Your Needs\n${priorityComments.join("\n\n")}\n\n`;
  }

  // 3. Infrastructure & Daily Life Breakdown
  text += `### Infrastructure Breakdown\n`;
  text += `- **Internet & Connectivity:** ${details.internet.breakdown} *Recommended: ${details.internet.recommendedISPs.join(", ")}*\n`;
  text += `- **Power & Light:** ${details.power.status}. ${details.power.backupOptions}\n`;
  text += `- **Traffic & Access:** Peak bottleneck occurs around **${details.traffic.peakHours}**. Public transit access is *${details.traffic.transitAccess}*.\n`;
  text += `- **Noise Profile:** ${details.noise.breakdown} Major sources: *${details.noise.sources.join(", ")}*.\n\n`;

  // 4. Actionable Advice
  text += `### EkoScout Inspection Advice\n`;
  text += `💡 *${details.lifestyle.generalAdvice}* Also verify if there are any pending estate dues, and check if the apartment has a dedicated water filtration system, as water quality can vary significantly.`;

  return text;
}
