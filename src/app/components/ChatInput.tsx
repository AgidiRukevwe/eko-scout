"use client";
import React, { useState, useRef } from "react";
import LocationDropdown from "./LocationDropdown";
import type { Location } from "./LocationDropdown";

type Props = {
  onSend: (text: string, locations: Location[]) => void;
  isSending: boolean;
  /** Called immediately when the user picks a location so the parent can prefetch intelligence */
  onLocationSelect?: (loc: Location) => void;
};

const ChatInput: React.FC<Props> = ({ onSend, isSending, onLocationSelect }) => {
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<Location[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @query pattern just before the cursor.
    // Allow empty query after @ so the user can just type @ and see "Current Location"
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const match = before.match(/@([a-zA-Z0-9\s,-]{0,40})$/);
    if (match) {
      setLocationQuery(match[1].trim());
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
      setLocationQuery("");
    }
  };

  const handleSelectLocation = (loc: Location) => {
    // Replace the @... token with the actual location name
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@([a-zA-Z0-9\s,-]{0,40})$/, loc.name);
    const after = text.slice(cursor);
    setText(before + after);
    
    if (!selectedLocations.some(l => l.name === loc.name)) {
      setSelectedLocations([...selectedLocations, loc]);
    }
    
    setShowDropdown(false);
    setLocationQuery("");
    textareaRef.current?.focus();
    onLocationSelect?.(loc);
  };

  const handleSend = () => {
    const fullText = text.trim();
    if (!fullText || isSending) return;
    onSend(fullText, selectedLocations);
    setText("");
    setSelectedLocations([]);
    setShowDropdown(false);
  };

  return (
    <div className="relative max-w-2xl mx-auto w-full">
      {/* Location @ dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full mb-3 left-0 w-80 bg-white border border-zinc-100 rounded-2xl shadow-xl z-20 overflow-hidden">
          <LocationDropdown query={locationQuery} onSelect={handleSelectLocation} />
        </div>
      )}

      <div className="bg-zinc-50 border border-zinc-100/80 rounded-3xl p-3 shadow-sm relative">
        <div className="px-3 pb-2">
          {selectedLocations.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedLocations.map((loc, idx) => (
                <div key={idx} className="inline-flex items-center gap-1.5 bg-white border border-zinc-200 rounded-full px-2.5 py-1 shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-blue-500">
                    <path d="M12 21C16 16.8 19 12.8637 19 9.5C19 5.35786 15.866 2 12 2C8.13401 2 5 5.35786 5 9.5C5 12.8637 8 16.8 12 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-zinc-700 text-sm">{loc.name}</span>
                  <button 
                    onClick={() => {
                      setSelectedLocations(selectedLocations.filter(l => l.name !== loc.name));
                    }}
                    className="text-zinc-400 hover:text-zinc-700 ml-0.5"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <textarea
            ref={textareaRef}
            rows={1}
            disabled={isSending}
            className="w-full bg-transparent text-zinc-800 placeholder-zinc-500 focus:outline-none resize-none disabled:opacity-50 text-[0.95rem] py-1"
            placeholder="Ask anything about Yaba..."
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
        </div>

        <div className="flex items-center justify-between px-2 pt-1">
          <button 
            type="button"
            className="text-zinc-500 hover:text-blue-500 hover:bg-blue-50 p-2 rounded-full transition-colors flex items-center justify-center relative"
            title="Type @ to pin a location"
          >
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M12 8V16M8 12H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <button
            onClick={handleSend}
            disabled={!text.trim() || isSending}
            className="w-10 h-10 flex items-center justify-center shrink-0 bg-zinc-800 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full transition-colors"
          >
            {isSending ? (
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping"></span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="translate-x-[1px] translate-y-[-1px]">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
