"use client";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { ChatWindow, ChatMessage } from "./components/ChatWindow";
import ChatInput from "./components/ChatInput";
import type { Location } from "./components/LocationDropdown";
import { AddCircleIcon } from "./components/icons";

import { Button } from "@/components/ui/button";

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
  const [activeLocations, setActiveLocations] = useState<Location[]>([]);

  // Stable ref so handleSend closure always sees the latest messages
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Called immediately when the user picks a location from the @ dropdown
  const handleLocationSelect = useCallback((loc: Location) => {
    setActiveLocations(prev => {
      if (!prev.some(l => l.name === loc.name)) {
        return [...prev, loc];
      }
      return prev;
    });
  }, []);

  const handleSend = useCallback(
    async (text: string, locations: Location[] | null) => {
      if (!text.trim() || isSending) return;

      // Use freshly passed locations or fall back to persisted active ones
      const effectiveLocations = (locations && locations.length > 0) ? locations : activeLocations;
      if (locations && locations.length > 0) {
        setActiveLocations(locations);
      }

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
            locations: effectiveLocations,
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
    [isSending, activeLocations]
  );

  return (
    <main className="flex flex-col h-screen bg-white text-zinc-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-sm" />
          <h1 className="font-newsreader text-xl font-semibold tracking-tight text-zinc-800">
            Adera
          </h1>
        </div>
        <Button variant="ghost" size="icon" className="-mr-1 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-xl transition-colors">
          <AddCircleIcon size={22} />
        </Button>
      </header>


      <div className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full">
        <ChatWindow 
          messages={messages} 
          onPromptClick={(text) => handleSend(text, null)} 
          onEditMessage={(id, content) => {
            const index = messagesRef.current.findIndex(m => m.id === id);
            if (index !== -1) {
              setMessages(messagesRef.current.slice(0, index));
              handleSend(content, null);
            }
          }}
        />
      </div>
      
      <div className="px-4 pb-4 bg-white">
        <ChatInput
          onSend={handleSend}
          isSending={isSending}
          onLocationSelect={handleLocationSelect}
        />
        <p className="text-center text-xs text-zinc-500 mt-3 mb-1">
          Adera is still learning. Please verify information.
        </p>
      </div>
    </main>
  );
}
