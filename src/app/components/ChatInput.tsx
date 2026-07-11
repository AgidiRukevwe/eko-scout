"use client";
import React, { useState, useRef, useCallback, useEffect } from "react";
import LocationDropdown from "./LocationDropdown";
import type { Location } from "./LocationDropdown";
import { Location as LocationIcon, Send2 } from "iconsax-react";

type Props = {
  onSend: (text: string, locations: Location[]) => void;
  isSending: boolean;
  onLocationSelect?: (loc: Location) => void;
};

// Unique marker so we can find chips in DOM
const CHIP_ATTR = "data-location-chip";

/**
 * Get text content before cursor in a contentEditable element.
 */
function getTextBeforeCursor(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return range.toString();
}

/**
 * Select and delete the @query token immediately before the cursor.
 */
function deleteAtToken(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    const before = text.slice(0, offset);
    const match = before.match(/@([a-zA-Z0-9\s,-]{0,40})$/);
    if (match) {
      const start = offset - match[0].length;
      const newRange = document.createRange();
      newRange.setStart(node, start);
      newRange.setEnd(node, offset);
      sel.removeAllRanges();
      sel.addRange(newRange);
      document.execCommand("delete", false);
    }
  }
}

/**
 * Build the chip HTML string to inject.
 */
function buildChipHTML(loc: Location): string {
  return `<span
    ${CHIP_ATTR}="true"
    data-chip-id="${loc.id}"
    data-chip-name="${loc.name}"
    data-chip-lat="${loc.lat ?? ""}"
    data-chip-lng="${loc.lng ?? ""}"
    class="location-chip"
    contenteditable="false"
    aria-label="${loc.name}"
  ><span class="location-chip-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21C16 16.8 19 12.8637 19 9.5C19 5.35786 15.866 2 12 2C8.13401 2 5 5.35786 5 9.5C5 12.8637 8 16.8 12 21Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.5" stroke="currentColor" stroke-width="2"/></svg></span>${loc.name}</span>`;
}

/**
 * Read all text + chips from the editor div.
 */
function readEditorContent(el: HTMLElement): { text: string; locations: Location[] } {
  const locations: Location[] = [];
  let text = "";

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement;
      if (elem.getAttribute(CHIP_ATTR)) {
        const name = elem.dataset.chipName ?? "";
        const lat = elem.dataset.chipLat ? Number(elem.dataset.chipLat) : undefined;
        const lng = elem.dataset.chipLng ? Number(elem.dataset.chipLng) : undefined;
        const id = elem.dataset.chipId ?? name;
        text += name;
        if (!locations.some((l) => l.id === id)) {
          locations.push({ id, name, lat, lng });
        }
      } else {
        elem.childNodes.forEach(walk);
      }
    }
  };

  el.childNodes.forEach(walk);
  return { text, locations };
}

const ChatInput: React.FC<Props> = ({ onSend, isSending, onLocationSelect }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [isEmpty, setIsEmpty] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);

  // Track @-trigger on every input
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    // Update empty state
    const { text } = readEditorContent(el);
    setIsEmpty(text.trim() === "");

    // Detect @query before cursor
    const before = getTextBeforeCursor(el);
    const match = before.match(/@([a-zA-Z0-9\s,-]{0,40})$/);
    if (match) {
      setLocationQuery(match[1].trim());
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
      setLocationQuery("");
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Insert chip at cursor, replacing @query token
  const handleSelectLocation = (loc: Location) => {
    const el = editorRef.current;
    if (!el) return;

    setShowDropdown(false);
    setLocationQuery("");
    onLocationSelect?.(loc);

    el.focus();

    // 1. Delete the @query token
    deleteAtToken(el);

    // 2. Insert chip HTML + trailing non-breaking space
    const chipHTML = buildChipHTML(loc) + "&nbsp;";
    document.execCommand("insertHTML", false, chipHTML);

    // 3. Update empty state
    const { text } = readEditorContent(el);
    setIsEmpty(text.trim() === "");
  };

  const handleSend = () => {
    const el = editorRef.current;
    if (!el || isSending) return;

    const { text, locations } = readEditorContent(el);
    if (!text.trim()) return;

    onSend(text.trim(), locations);

    // Clear editor
    el.innerHTML = "";
    setIsEmpty(true);
    setShowDropdown(false);
  };

  // Trigger @ dropdown via the pin button
  const handlePinClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, "@");
    handleInput();
  };

  return (
    <div className="relative max-w-2xl mx-auto w-full">
      {/* @ location dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full mb-3 left-0 w-80 bg-white border border-zinc-100 rounded-2xl shadow-xl z-20 overflow-hidden">
          <LocationDropdown query={locationQuery} onSelect={handleSelectLocation} />
        </div>
      )}

      <div className="bg-zinc-50 border border-zinc-100/80 rounded-3xl p-3 shadow-sm">
        {/* Rich text editor */}
        <div className="px-3 pb-2 relative">
          <div
            ref={editorRef}
            contentEditable={!isSending}
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            className="chat-editor w-full min-h-[28px] max-h-40 overflow-y-auto text-zinc-800 focus:outline-none text-[0.95rem] py-1 leading-relaxed"
            aria-label="Chat input"
            role="textbox"
            aria-multiline="true"
          />
          {isEmpty && (
            <span className="pointer-events-none absolute top-1 left-0 text-[0.95rem] text-zinc-400 select-none">
              Ask anything. Type @ to pin a location…
            </span>
          )}
        </div>

        <div className="flex items-center justify-between px-2 pt-1">
          {/* Pin location button */}
          <button
            type="button"
            onMouseDown={handlePinClick}
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
              <Send2 size={18} variant="Bold" className="rotate-45 -translate-x-px" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
