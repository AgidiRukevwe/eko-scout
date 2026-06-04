"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, ArrowRight, User, Sparkles, AlertCircle } from "lucide-react";
import { UserPriorities } from "./PrioritiesPanel";
import { LocationData } from "@/lib/lagosData";
import LocationCard from "./LocationCard";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  location?: LocationData;
}

interface ChatInterfaceProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  priorities: UserPriorities;
  className?: string;
}

export default function ChatInterface({
  messages,
  isLoading,
  onSendMessage,
  priorities,
  className = ""
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  // Scroll to bottom whenever messages or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Very lightweight markdown-like parser to render bold, lists, and headings nicely
  const parseMarkdown = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      let content = line;
      
      // Handle Headings (e.g. ### Heading)
      if (content.startsWith("### ")) {
        return (
          <h3 key={idx} className="text-sm font-bold text-zinc-100 mt-4 mb-2 first:mt-0">
            {content.replace("### ", "")}
          </h3>
        );
      }
      if (content.startsWith("## ")) {
        return (
          <h2 key={idx} className="text-base font-bold text-zinc-100 mt-5 mb-2 first:mt-0">
            {content.replace("## ", "")}
          </h2>
        );
      }

      // Handle Bullet Points (e.g. - item or * item)
      const isBullet = content.startsWith("- ") || content.startsWith("* ");
      if (isBullet) {
        content = content.replace(/^[-*]\s+/, "");
      }

      // Handle bold tags (**text**)
      const boldRegex = /\*\*(.*?)\*\*/g;
      const parts = [];
      let lastIndex = 0;
      let match;

      while ((match = boldRegex.exec(content)) !== null) {
        const textBefore = content.substring(lastIndex, match.index);
        if (textBefore) parts.push(textBefore);
        parts.push(
          <strong key={match.index} className="font-semibold text-emerald-400">
            {match[1]}
          </strong>
        );
        lastIndex = boldRegex.lastIndex;
      }
      
      const textAfter = content.substring(lastIndex);
      if (textAfter) parts.push(textAfter);

      // Render as list item or standard paragraph
      if (isBullet) {
        return (
          <li key={idx} className="ml-4 list-disc text-zinc-300 pl-1 my-1">
            {parts.length > 0 ? parts : content}
          </li>
        );
      }

      return (
        <p key={idx} className="text-zinc-300 my-2 leading-relaxed min-h-[1em]">
          {parts.length > 0 ? parts : content}
        </p>
      );
    });
  };

  const suggestedQuestions = [
    "How is Admiralty Way for remote work?",
    "Does this part of Ajah flood?",
    "How reliable is power around Chevron Drive?",
    "Is Ogudu good for someone working in Yaba?",
    "How noisy is Allen Avenue at night?"
  ];

  return (
    <div className={`flex flex-col h-full bg-zinc-950/20 border border-zinc-800 rounded-2xl overflow-hidden ${className}`}>
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {messages.length === 0 ? (
          /* Empty Chat / Suggestions State */
          <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto py-10 animate-fade-in">
            <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800 mb-4">
              <Sparkles className="text-emerald-500" size={32} />
            </div>
            <h2 className="text-xl font-bold text-zinc-100">
              Where are you looking to rent in Lagos?
            </h2>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm">
              Enter a street name, estate, or landmark. EkoScout analyzes internet, flood risk, electricity grid quality, and traffic.
            </p>

            <div className="w-full mt-8 flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest block text-left">
                Suggested hyper-local searches
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {suggestedQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSendMessage(q)}
                    className="p-3 text-xs font-medium text-left border border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 hover:bg-zinc-900/60 text-zinc-300 rounded-xl transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <span className="line-clamp-1">{q}</span>
                    <ArrowRight size={14} className="text-zinc-500 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Active Chat Flow */
          <div className="space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                } animate-fade-in`}
              >
                {/* Avatar for Assistant */}
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-emerald-500">
                    <Sparkles size={14} />
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    message.role === "user"
                      ? "bg-emerald-600 text-white rounded-br-none shadow-md shadow-emerald-900/10"
                      : "bg-zinc-900/60 border border-zinc-850 text-zinc-300 rounded-bl-none"
                  }`}
                >
                  {message.role === "user" ? (
                    <p className="leading-relaxed">{message.content}</p>
                  ) : (
                    <div className="space-y-2">
                      {parseMarkdown(message.content)}
                    </div>
                  )}

                  {/* Inline Location Card if Matched */}
                  {message.role === "assistant" && message.location && (
                    <div className="mt-4 pt-4 border-t border-zinc-800/80">
                      <LocationCard location={message.location} />
                    </div>
                  )}
                </div>

                {/* Avatar for User */}
                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-400">
                    <User size={14} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex gap-4 justify-start animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-emerald-500">
              <Sparkles size={14} />
            </div>
            <div className="bg-zinc-900/60 border border-zinc-850 rounded-2xl rounded-bl-none px-5 py-4 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-zinc-500 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-zinc-500 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-zinc-500 typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-zinc-800/60 bg-zinc-900/20"
      >
        <div className="relative flex items-center">
          <input
            id="chat-message-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Admiralty Way, Chevron Drive, Sabo Yaba, Ogudu..."
            disabled={isLoading}
            className="w-full py-3.5 pl-4 pr-12 rounded-xl border border-zinc-800 bg-zinc-950/80 focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/30 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            id="send-message-btn"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:bg-zinc-800 disabled:text-zinc-650 cursor-pointer disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
        
        <div className="flex items-center gap-1.5 mt-2 justify-center text-[10px] text-zinc-500">
          <AlertCircle size={10} />
          <span>Lagos infrastructure changes by street; reviews reflect community reports.</span>
        </div>
      </form>
    </div>
  );
}
