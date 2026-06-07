"use client";
import React, { useState, useRef } from "react";
import LocationDropdown from "./LocationDropdown";
import LocationPill from "./LocationPill";
import type { Location } from "./LocationDropdown";

type Props = {
  onSend: (text: string, location: Location | null) => void;
  isSending: boolean;
  /** Called immediately when the user picks a location so the parent can prefetch intelligence */
  onLocationSelect?: (loc: Location) => void;
};

const ChatInput: React.FC<Props> = ({ onSend, isSending, onLocationSelect }) => {
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @query pattern just before the cursor
    // Allow letters, numbers, spaces, and commas up to 40 chars.
    // Stops matching if they type a period, question mark, or start a new sentence.
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const match = before.match(/@([a-zA-Z0-9\s,-]{0,40})$/);
    if (match) {
      setLocationQuery(match[1]);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
      setLocationQuery("");
    }
  };

  const handleSelectLocation = (loc: Location) => {
    // Remove the @... token from the text
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@([^@\s]*)$/, "");
    const after = text.slice(cursor);
    setText(before + after);
    setSelectedLocation(loc);
    setShowDropdown(false);
    setLocationQuery("");
    textareaRef.current?.focus();
    // Notify parent immediately so intelligence prefetch can start
    onLocationSelect?.(loc);
  };

  const handleSend = () => {
    if (!text.trim() || isSending) return;
    onSend(text.trim(), selectedLocation);
    setText("");
    setSelectedLocation(null);
    setShowDropdown(false);
  };

  return (
    <div className="relative p-4 bg-zinc-900 border-t border-zinc-700">
      {/* Location @ dropdown */}
      {showDropdown && (
        <LocationDropdown query={locationQuery} onSelect={handleSelectLocation} />
      )}

      {/* Pinned location pill */}
      {selectedLocation && (
        <div className="mb-2">
          <LocationPill
            location={selectedLocation}
            onRemove={() => setSelectedLocation(null)}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          disabled={isSending}
          className="flex-1 p-3 rounded-xl bg-zinc-800 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none disabled:opacity-50"
          placeholder="Ask about Lagos… type @ to pin a location"
          value={text}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
            if (e.key === "Escape") {
              setShowDropdown(false);
            }
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isSending}
          className="shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl font-medium transition-colors"
        >
          {isSending ? "…" : "Send"}
        </button>
      </div>

      <p className="mt-1.5 text-xs text-zinc-600">
        Press{" "}
        <kbd className="px-1 py-0.5 rounded bg-zinc-700 text-zinc-400 text-xs">
          @
        </kbd>{" "}
        to attach a Lagos location · Shift+Enter for new line
      </p>
    </div>
  );
};

export default ChatInput;
