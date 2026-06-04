/*
 * Flood Risk Intelligence Schema (Migration 003)
 * ----------------------------------------------
 * Defines the staging tables for LGA boundaries and flood-prone communities,
 * and the finalized deterministic flood risk layer.
 */

-- 1. Staging Table: LGA Baselines mapped to H3 cells
CREATE TABLE IF NOT EXISTS h3_staging_lga_flood (
    h3_index VARCHAR(15) PRIMARY KEY,
    lga_name VARCHAR(100),
    highest_point_m NUMERIC(6,2),
    lowest_point_m NUMERIC(6,2),
    elevation_range_m NUMERIC(6,2),
    flood_percent NUMERIC(6,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Staging Table: Flood-Prone Communities mapped to H3 cells
CREATE TABLE IF NOT EXISTS h3_staging_flood_community (
    h3_index VARCHAR(15) PRIMARY KEY,
    community_name VARCHAR(255),
    lga_name VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Final Intelligence Layer
CREATE TABLE IF NOT EXISTS h3_r9_flood (
    h3_index VARCHAR(15) PRIMARY KEY,
    baseline_flood_score INTEGER DEFAULT 0,
    flood_exposure_score INTEGER DEFAULT 0,
    flood_risk_level VARCHAR(20), -- Low / Medium / High / Severe
    flood_prone_locality BOOLEAN DEFAULT FALSE,
    flood_locality_name TEXT,
    highest_point_m NUMERIC(6,2),
    lowest_point_m NUMERIC(6,2),
    elevation_range_m NUMERIC(6,2),
    confidence_score INTEGER,
    confidence_label VARCHAR(20),
    data_source VARCHAR(50) DEFAULT 'LASEMA',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
