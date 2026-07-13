"use client";
import React, { useMemo, useState, useEffect } from "react";
import { marked } from "marked";
import { Like1Icon, DislikeIcon, Refresh2Icon, CopyIcon, TickCircleIcon, Edit2Icon, LocationIcon } from "./icons";

interface MessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  onEdit?: (newContent: string) => void;
}

marked.setOptions({ breaks: true, gfm: true });

export default function Message({ role, content, isStreaming, onEdit }: MessageProps) {
  const isUser = role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEditContent(content);
  }, [content]);

  const html = useMemo(() => {
    if (isUser) return null;
    return marked.parse(content) as string;
  }, [isUser, content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isUser) {
    return (
      <div className="flex justify-end mb-6">
        <div className="flex flex-col max-w-xs md:max-w-xl lg:max-w-2xl">
          <div className={`px-4 py-3 text-[0.95rem] leading-relaxed relative group ${
            isEditing ? "w-full min-w-[300px]" : "bg-zinc-50 text-zinc-800 rounded-3xl whitespace-pre-wrap"
          }`}>
            {isEditing ? (
              <div className="flex flex-col gap-2 w-full">
                <textarea
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-3 text-zinc-800 focus:outline-none focus:border-blue-300 resize-none"
                  rows={3}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setIsEditing(false); setEditContent(content); }}
                    className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      if (editContent.trim() !== content && editContent.trim()) {
                        onEdit?.(editContent.trim());
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-blue-500 text-white hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    Save &amp; Submit
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <span>
                  {content.split(/(@[a-zA-Z0-9\s,-]+)/g).map((part, i) => {
                    if (part.startsWith('@')) {
                      return (
                        <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-px mx-0.5 text-[0.85rem] font-medium align-middle">
                          <LocationIcon size={12} className="opacity-70" />
                          {part.slice(1)}
                        </span>
                      );
                    }
                    return <React.Fragment key={i}>{part}</React.Fragment>;
                  })}
                  {isStreaming && (
                    <span className="inline-block w-0.5 h-4 ml-0.5 align-middle bg-zinc-800/50 animate-pulse rounded" />
                  )}
                </span>
                {!isStreaming && onEdit && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-700 transition-all p-1 -mr-2 -mt-1 rounded hover:bg-zinc-200"
                    title="Edit message"
                  >
                    <Edit2Icon size={15} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message ──
  return (
    <div className="flex justify-start mb-6">
      <div className="flex flex-col max-w-xs md:max-w-xl lg:max-w-2xl">
        {/* Avatar stacked above the message */}
        <span className="mb-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-sm" />

        <div className="px-4 py-3 text-[0.95rem] leading-relaxed text-zinc-800 prose-message w-full">
          {content ? (
            <div
              className="markdown"
              dangerouslySetInnerHTML={{ __html: html ?? "" }}
            />
          ) : isStreaming ? null : (
            <span className="text-zinc-400">…</span>
          )}
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 ml-0.5 align-middle bg-zinc-400 animate-pulse rounded" />
          )}
        </div>

        {/* Feedback / action row */}
        {!isStreaming && content && (
          <div className="flex items-center gap-2 mt-3 ml-2">
            <div className="flex items-center bg-zinc-50 rounded-full border border-zinc-100 p-1">
              <button className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-full transition-colors" title="Helpful">
                <Like1Icon size={18} />
              </button>
              <button className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-full transition-colors" title="Not helpful">
                <DislikeIcon size={18} />
              </button>
              <button className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-full transition-colors" title="Regenerate">
                <Refresh2Icon size={18} />
              </button>
            </div>
            <button
              onClick={handleCopy}
              className={`p-2 rounded-full transition-colors ${
                copied
                  ? "text-green-500 bg-green-50"
                  : "text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
              }`}
              title={copied ? "Copied!" : "Copy text"}
            >
              {copied ? (
                <TickCircleIcon size={16} />
              ) : (
                <CopyIcon size={16} />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
