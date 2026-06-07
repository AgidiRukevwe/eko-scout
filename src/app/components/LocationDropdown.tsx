"use client";
import React, { useEffect, useRef, useState } from "react";

export interface Location {
  id: string;
  name: string;
  parentArea?: string;
  lat?: number;
  lng?: number;
}

interface Props {
  query: string;
  onSelect: (loc: Location) => void;
}

export default function LocationDropdown({ query, onSelect }: Props) {
  const [results, setResults] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();

    // Hide dropdown when query is empty
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Debounce: wait 300 ms before firing the request
    const timer = setTimeout(async () => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const res = await fetch(
          `/api/location/search?q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Search failed");
        const data = (await res.json()) as { results: Array<{ label: string; lat: number; lng: number; type: string }> };

        const mapped: Location[] = (data.results ?? []).map((r, i) => ({
          id: `${i}-${r.lat}-${r.lng}`,
          name: r.label.split(",")[0].trim(),
          parentArea: r.label.split(",").slice(1, 3).join(",").trim() || undefined,
          lat: r.lat,
          lng: r.lng,
        }));

        setResults(mapped.slice(0, 6));
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Location search error:", err);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  if (!loading && results.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50">
      <p className="px-3 py-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide border-b border-zinc-700">
        {loading ? "Searching…" : "Search Results"}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-zinc-500 text-sm">
          <svg className="animate-spin h-4 w-4 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Looking up locations…
        </div>
      ) : (
        <ul>
          {results.map((loc) => (
            <li key={loc.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Prevent textarea blur before click registers
                  e.preventDefault();
                  onSelect(loc);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-700 transition-colors"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-400 text-xs">
                  📍
                </span>
                <span>
                  <span className="block text-sm font-medium text-zinc-100">{loc.name}</span>
                  {loc.parentArea && (
                    <span className="block text-xs text-zinc-400">{loc.parentArea}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
