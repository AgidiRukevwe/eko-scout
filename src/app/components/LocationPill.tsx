import React from 'react';

interface Location {
  id: string;
  name: string;
  parentArea?: string;
  lat?: number;
  lng?: number;
}

interface LocationPillProps {
  location: Location;
  onRemove: () => void;
}

export default function LocationPill({ location, onRemove }: LocationPillProps) {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-600 px-3 py-1 text-sm font-medium text-white mr-2 mb-2">
      {location.name}
      <button
        type="button"
        className="ml-2 rounded-full hover:bg-indigo-500 focus:outline-none"
        onClick={onRemove}
        aria-label="Remove location"
      >
        ×
      </button>
    </span>
  );
}
