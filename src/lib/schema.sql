-- Schema for EkoScout locations table in Neon PostgreSQL

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alternative_names TEXT[] NOT NULL DEFAULT '{}',
  parent_area TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  place_id TEXT,           -- Google Maps Place ID for enrichment
  scores JSONB NOT NULL,   -- JSON object containing scores: { internet, power, flooding, traffic, noise, safety }
  details JSONB NOT NULL,  -- JSON object containing details: { internet: {...}, power: {...}, flooding: {...}, traffic: {...}, noise: {...}, safety: {...}, lifestyle: {...} }
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching alternative names using GIN
-- Useful if queries lookup against alternative_names array
CREATE INDEX IF NOT EXISTS idx_locations_alternative_names ON locations USING gin (alternative_names);
