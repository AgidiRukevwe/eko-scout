"use client";
import React, { useMemo } from "react";
import { marked } from "marked";

interface MessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

// Configure marked for safe inline rendering
marked.setOptions({ breaks: true, gfm: true });

export default function Message({ role, content, isStreaming }: MessageProps) {
  const isUser = role === "user";

  const html = useMemo(() => {
    if (isUser) return null;
    // Parse markdown to HTML; cast to string since we're not using async
    return marked.parse(content) as string;
  }, [isUser, content]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <span className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-base select-none">
          🏙️
        </span>
      )}

      <div
        className={`max-w-xs md:max-w-md lg:max-w-2xl px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm whitespace-pre-wrap"
            : "bg-zinc-800 text-zinc-100 rounded-bl-sm prose-message"
        }`}
      >
        {isUser ? (
          <>
            {content}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 ml-0.5 align-middle bg-white/60 animate-pulse rounded" />
            )}
          </>
        ) : (
          <>
            {content ? (
              <div
                className="markdown"
                dangerouslySetInnerHTML={{ __html: html ?? "" }}
              />
            ) : isStreaming ? null : (
              <span className="text-zinc-500">…</span>
            )}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 ml-0.5 align-middle bg-zinc-400 animate-pulse rounded" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
