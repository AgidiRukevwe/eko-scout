"use client";
import React, { useEffect, useRef, useState } from "react";
import { LocationIcon, GpsIcon } from "./icons";
import { Button } from "@/components/ui/button";

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

    // Hide dropdown when query is empty (but we now allow empty query to show "Current Location")
    if (!q && results.length === 0 && !loading) {
      // Just clear search results, but the component will still render the Current Location button
      setResults([]);
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

  // Render the dropdown if we are loading, have results, or if the query is empty/"current" to show the GPS button
  const showCurrentLocation = query.trim().length === 0 || query.toLowerCase().startsWith("c");
  if (!loading && results.length === 0 && !showCurrentLocation) return null;

  const handleCurrentLocationClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        onSelect({
          id: "current-location",
          name: "My Location",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        setLoading(false);
        alert("Unable to retrieve your location. Please check browser permissions.");
        console.error(err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );
  };

  return (
    <div className="w-full flex flex-col">
      {loading && (
        <div className="flex items-center gap-2 px-3 py-3 text-zinc-500 text-sm">
          <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Looking up locations…
        </div>
      )}
      <ul className="flex flex-col">
        {showCurrentLocation && (
          <li>
            <Button
              variant="ghost"
              onMouseDown={handleCurrentLocationClick}
              className="w-full flex items-center justify-start gap-3 px-4 py-6 rounded-none text-left border-b border-zinc-100 hover:bg-blue-50"
            >
              <div className="flex shrink-0 items-center justify-center text-blue-600 bg-blue-100/50 p-1.5 rounded-full">
                <GpsIcon size={14} />
              </div>
              <span className="text-[0.95rem] font-medium text-blue-700">Use Current Location</span>
            </Button>
          </li>
        )}
        {!loading && results.map((loc) => (
            <li key={loc.id}>
              <Button
                variant="ghost"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevents contentEditable from losing focus
                  onSelect(loc);
                }}
                className="w-full flex items-center justify-start gap-3 px-4 py-6 rounded-none text-left"
              >
                <div className="flex shrink-0 items-center justify-center text-blue-500">
                  <LocationIcon size={16} />
                </div>
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-[0.95rem] font-normal text-zinc-700">{loc.name}</span>
                  {loc.parentArea && (
                    <span className="text-[0.75rem] font-normal text-zinc-400">{loc.parentArea}</span>
                  )}
                </div>
              </Button>
            </li>
          ))}
      </ul>
    </div>
  );
}
