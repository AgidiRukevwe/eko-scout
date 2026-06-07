"use client";
import React, { useState, useCallback, useRef } from "react";
import { ChatWindow, ChatMessage } from "./components/ChatWindow";
import ChatInput from "./components/ChatInput";
import type { Location } from "./components/LocationDropdown";

// Default user priorities — wire to a settings panel later
const DEFAULT_PRIORITIES = {
  workFromHome: false,
  floodSensitive: false,
  commuteStress: false,
  noiseSensitive: false,
  powerReliability: false,
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [activeLocation, setActiveLocation] = useState<Location | null>(null);

  // Stable ref so handleSend closure always sees the latest messages
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // Called immediately when the user picks a location from the @ dropdown
  const handleLocationSelect = useCallback((loc: Location) => {
    setActiveLocation(loc);
  }, []);

  const handleSend = useCallback(
    async (text: string, location: Location | null) => {
      if (!text.trim() || isSending) return;

      // Use the freshly selected location, or fall back to the last active one
      const effectiveLocation = location ?? activeLocation;
      if (location) setActiveLocation(location);

      // 1. Append user message immediately
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };

      // 2. Create streaming placeholder for the assistant reply
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);
      setIsSending(true);

      try {
        // Build conversation history (exclude empty streaming placeholders)
        const history = messagesRef.current
          .filter((m) => m.content.trim())
          .map((m) => ({ role: m.role, content: m.content }));

        // The server fetches /intelligence and /nearby itself — no race condition
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            priorities: DEFAULT_PRIORITIES,
            locations: effectiveLocation ? [effectiveLocation] : [],
            // locationIntelligence is now fetched server-side
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err?.error ?? `Server error ${resp.status}`);
        }

        // 3. Stream chunks into the placeholder
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + chunk } : m
              )
            );
          }
        }

        // 4. Mark streaming done
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m
          )
        );
      } catch (err: any) {
        console.error("Chat error:", err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: err?.message ?? "Something went wrong. Please try again.", isStreaming: false }
              : m
          )
        );
      } finally {
        setIsSending(false);
      }
    },
    [isSending, activeLocation]
  );

  return (
    <main className="flex flex-col h-screen bg-zinc-950 text-zinc-50">
      {/* Active location badge */}
      {activeLocation && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-xs">
          <span className="text-indigo-400">📍</span>
          <span>
            <span className="text-zinc-300 font-medium">{activeLocation.name}</span>
            {activeLocation.parentArea && (
              <span className="ml-1 text-zinc-500">{activeLocation.parentArea}</span>
            )}
          </span>
          <span className="ml-auto text-zinc-600 italic">live data loaded per message</span>
        </div>
      )}

      <ChatWindow messages={messages} />
      <ChatInput
        onSend={handleSend}
        isSending={isSending}
        onLocationSelect={handleLocationSelect}
      />
    </main>
  );
}
