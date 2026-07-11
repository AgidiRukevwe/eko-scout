"use client";
import React, { useMemo, useState, useEffect } from "react";
import { marked } from "marked";

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
                  {content}
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11 4H4C2.89543 4 2 4.89543 2 6V20C2 21.1046 2.89543 22 4 22H18C19.1046 22 20 21.1046 20 20V13M18.5 2.5C19.8807 1.11929 22.1193 1.11929 23.5 2.5C24.8807 3.88071 24.8807 6.11929 23.5 7.5L12 19L7 20L8 15L18.5 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 9V5C14 3.89543 13.1046 3 12 3H10C9.73478 3 9.48043 3.10536 9.29289 3.29289L3.29289 9.29289C3.10536 9.48043 3 9.73478 3 10V20C3 21.1046 3.89543 22 5 22H16.28C17.2215 22 18.0315 21.35 18.23 20.424L19.73 13.424C19.9827 12.2446 19.0831 11.135 17.88 11.135H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-full transition-colors" title="Not helpful">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 15V19C10 20.1046 10.8954 21 12 21H14C14.2652 21 14.5196 20.8946 14.7071 20.7071L20.7071 14.7071C20.8946 14.5196 21 14.2652 21 14V4C21 2.89543 20.1046 2 19 2H7.72C6.77848 2 5.96848 2.65005 5.77 3.57597L4.27 10.576C4.01734 11.7554 4.91694 12.865 6.12 12.865H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-full transition-colors" title="Regenerate">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4M12 4L8 8M12 4L16 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
