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
  onPromptClick?: (prompt: string) => void;
  onEditMessage?: (msgId: string, newContent: string) => void;
};

export const ChatWindow: React.FC<Props> = ({ messages, onPromptClick, onEditMessage }) => {
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
      className="flex-1 overflow-y-auto p-4 space-y-4 bg-white"
    >
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-5 text-center select-none px-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-md mb-2 shrink-0"></div>
          <div>
            <h1 className="text-[1.75rem] leading-tight font-medium text-zinc-900 mb-3 tracking-tight">
              Explore Any <span className="text-slate-500">Neighborhood</span><br />
              Before You Move.
            </h1>
            <p className="text-[0.95rem] text-slate-500 max-w-sm mx-auto">
              Get local insights on power, flooding,<br />
              safety, traffic, rent, and more.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3 mt-4 max-w-lg">
            {[
              "Which parts of Yaba have stable power?",
              "Best neighborhoods for remote work",
              "Is my current location safe at night?",
              "Compare Akoka and Yaba",
            ].map((prompt) => (
              <button
                key={prompt}
                onClick={() => onPromptClick?.(prompt)}
                className="px-4 py-2.5 rounded-2xl bg-zinc-50 text-zinc-800 text-[0.9rem] transition-colors hover:bg-zinc-100"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((msg) => (
        <Message
          key={msg.id}
          role={msg.role}
          content={msg.content}
          isStreaming={msg.isStreaming}
          onEdit={(newContent) => onEditMessage?.(msg.id, newContent)}
        />
      ))}
    </div>
  );
};
