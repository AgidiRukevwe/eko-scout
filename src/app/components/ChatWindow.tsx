"use client";
import React, { useEffect, useRef } from "react";
import Message from "./Message";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

type Props = {
  messages: ChatMessage[];
};

export const ChatWindow: React.FC<Props> = ({ messages }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message whenever messages or content changes
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950"
    >
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center select-none px-6">
          <span className="text-5xl">🏙️</span>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100 mb-1">EkoScout</h1>
            <p className="text-sm text-zinc-400 max-w-sm">
              Your honest guide to living in Lagos. Ask anything — power supply, flooding, traffic, rent, what it&apos;s really like.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            {[
              "What's Lekki like for remote workers?",
              "Is Yaba flood-prone?",
              "Compare Ikeja vs Gbagada",
              "Best areas under ₦300k/month?",
            ].map((prompt) => (
              <span
                key={prompt}
                className="px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs cursor-default hover:border-indigo-500 transition-colors"
              >
                {prompt}
              </span>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-1">
            Type <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">@</kbd> to pin a neighbourhood for live data
          </p>
        </div>
      )}
      {messages.map((msg) => (
        <Message
          key={msg.id}
          role={msg.role}
          content={msg.content}
          isStreaming={msg.isStreaming}
        />
      ))}
    </div>
  );
};
