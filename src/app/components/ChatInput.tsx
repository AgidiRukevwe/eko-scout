"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import LocationDropdown from "./LocationDropdown";
import type { Location } from "./LocationDropdown";
import { Location as LocationIcon, Send2, Gps, CloseCircle } from "iconsax-react";

type Props = {
  onSend: (text: string, locations: Location[]) => void;
  isSending: boolean;
  onLocationSelect?: (loc: Location) => void;
};

// A token is either plain text or an @-location chip
type TextToken = { type: "text"; value: string };
type ChipToken = { type: "chip"; location: Location };
type Token = TextToken | ChipToken;

/**
 * ChatInput — rich input with inline @-location chips.
 *
 * Architecture: We maintain a `tokens` array (text + chip segments) as source of truth.
 * The visible input is a `contentEditable` div that renders them.
 * When the user types, we sync back to tokens.
 */
const ChatInput: React.FC<Props> = ({ onSend, isSending, onLocationSelect }) => {
  const [tokens, setTokens] = useState<Token[]>([{ type: "text", value: "" }]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const dropdownOpen = useRef(false);

  // Keep dropdownOpen ref in sync
  useEffect(() => {
    dropdownOpen.current = showDropdown;
  }, [showDropdown]);

  // Derive plain text (chips rendered as their name)
  const plainText = tokens
    .map((t) => (t.type === "chip" ? t.location.name : t.value))
    .join("");

  const selectedLocations = tokens
    .filter((t): t is ChipToken => t.type === "chip")
    .map((t) => t.location);

  const isEmpty = plainText.trim() === "";

  // ── Handle keydown ──────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // ── Handle input — parse tokens from DOM ────────────────────────────────────
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    // Walk the DOM, collecting text and chip nodes
    const newTokens: Token[] = [];
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        newTokens.push({ type: "text", value: node.textContent ?? "" });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.dataset.chipId) {
          // It's a chip — find the location from selectedLocations
          const loc = selectedLocations.find((l) => l.id === el.dataset.chipId);
          if (loc) {
            newTokens.push({ type: "chip", location: loc });
            return;
          }
        }
        // Fall back: treat any other element's text as plain text
        newTokens.push({ type: "text", value: el.textContent ?? "" });
      }
    });

    if (newTokens.length === 0) {
      newTokens.push({ type: "text", value: "" });
    }

    setTokens(newTokens);

    // Check for @ trigger in last text token
    const lastText = newTokens.findLast((t): t is TextToken => t.type === "text");
    if (lastText) {
      const match = lastText.value.match(/@([a-zA-Z0-9\s,-]{0,40})$/);
      if (match) {
        setLocationQuery(match[1].trim());
        setShowDropdown(true);
        return;
      }
    }
    setShowDropdown(false);
    setLocationQuery("");
  }, [selectedLocations]);

  // ── Insert chip when user picks a location ──────────────────────────────────
  const handleSelectLocation = (loc: Location) => {
    const el = editorRef.current;
    if (!el) return;

    setShowDropdown(false);
    setLocationQuery("");
    onLocationSelect?.(loc);

    // Build new tokens: replace the trailing @... in last text token with a chip
    setTokens((prev) => {
      const next: Token[] = [];
      let inserted = false;
      for (let i = prev.length - 1; i >= 0; i--) {
        const t = prev[i];
        if (!inserted && t.type === "text") {
          const cleaned = t.value.replace(/@([a-zA-Z0-9\s,-]{0,40})$/, "");
          if (cleaned !== t.value || i === prev.length - 1) {
            next.unshift({ type: "text", value: " " }); // trailing space after chip
            next.unshift({ type: "chip", location: loc });
            if (cleaned) next.unshift({ type: "text", value: cleaned });
            inserted = true;
            continue;
          }
        }
        next.unshift(t);
      }
      if (!inserted) {
        next.push({ type: "chip", location: loc });
        next.push({ type: "text", value: " " });
      }
      return next;
    });

    // Re-render and move cursor to end after React re-render
    requestAnimationFrame(() => {
      if (!editorRef.current) return;
      syncDOMFromTokens();
      moveCursorToEnd(editorRef.current);
    });
  };

  // ── Remove a chip ────────────────────────────────────────────────────────────
  const removeChip = (locId: string) => {
    setTokens((prev) => prev.filter((t) => !(t.type === "chip" && t.location.id === locId)));
    requestAnimationFrame(() => syncDOMFromTokens());
  };

  // ── Sync DOM from tokens (controlled render) ─────────────────────────────────
  const syncDOMFromTokens = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    // Save selection
    const sel = window.getSelection();
    const hadFocus = document.activeElement === el;

    el.innerHTML = "";
    tokens.forEach((t) => {
      if (t.type === "text") {
        el.appendChild(document.createTextNode(t.value));
      } else {
        const chip = document.createElement("span");
        chip.className = "location-chip";
        chip.contentEditable = "false";
        chip.dataset.chipId = t.location.id;
        chip.setAttribute("aria-label", t.location.name);

        const icon = document.createElement("span");
        icon.className = "location-chip-icon";
        icon.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21C16 16.8 19 12.8637 19 9.5C19 5.35786 15.866 2 12 2C8.13401 2 5 5.35786 5 9.5C5 12.8637 8 16.8 12 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="2"/></svg>`;

        const label = document.createElement("span");
        label.textContent = t.location.name;

        const remove = document.createElement("button");
        remove.className = "location-chip-remove";
        remove.type = "button";
        remove.innerHTML = "×";
        remove.addEventListener("mousedown", (e) => {
          e.preventDefault();
          removeChip(t.location.id);
        });

        chip.appendChild(icon);
        chip.appendChild(label);
        chip.appendChild(remove);
        el.appendChild(chip);
      }
    });

    if (hadFocus) moveCursorToEnd(el);
  }, [tokens]);

  // On token change, update DOM
  useEffect(() => {
    syncDOMFromTokens();
  }, [tokens]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function moveCursorToEnd(el: HTMLElement) {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  const handleSend = () => {
    if (isEmpty || isSending) return;
    onSend(plainText.trim(), selectedLocations);
    setTokens([{ type: "text", value: "" }]);
    if (editorRef.current) editorRef.current.innerHTML = "";
    setShowDropdown(false);
  };

  const handleFocus = () => {
    // noop — placeholder handled by CSS
  };

  return (
    <div className="relative max-w-2xl mx-auto w-full">
      {/* @ location dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full mb-3 left-0 w-80 bg-white border border-zinc-100 rounded-2xl shadow-xl z-20 overflow-hidden">
          <LocationDropdown query={locationQuery} onSelect={handleSelectLocation} />
        </div>
      )}

      <div className="bg-zinc-50 border border-zinc-100/80 rounded-3xl p-3 shadow-sm relative">
        {/* contentEditable rich input */}
        <div className="px-3 pb-2 relative">
          <div
            ref={editorRef}
            contentEditable={!isSending}
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            className="chat-editor w-full min-h-[28px] max-h-40 overflow-y-auto text-zinc-800 focus:outline-none text-[0.95rem] py-1 leading-relaxed"
            aria-label="Chat input"
            role="textbox"
            aria-multiline="true"
          />
          {/* Placeholder */}
          {isEmpty && (
            <span className="pointer-events-none absolute top-1 left-0 text-[0.95rem] text-zinc-400 select-none">
              Ask anything. Type @ to pin a location…
            </span>
          )}
        </div>

        <div className="flex items-center justify-between px-2 pt-1">
          {/* @ hint button */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              // Insert @ into the editor
              const el = editorRef.current;
              if (!el) return;
              el.focus();
              document.execCommand("insertText", false, "@");
            }}
            className="text-zinc-400 hover:text-blue-500 hover:bg-blue-50 p-2 rounded-full transition-colors flex items-center justify-center"
            title="Pin a location"
          >
            <LocationIcon size={20} variant="Linear" />
          </button>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={isEmpty || isSending}
            className="w-10 h-10 flex items-center justify-center shrink-0 bg-zinc-800 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full transition-colors"
          >
            {isSending ? (
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
            ) : (
              <Send2 size={18} variant="Bold" className="rotate-45 translate-x-[-1px]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
