/*
 * Core Environment Schema (Migration 001)
 * ---------------------------------------
 * Defines the raw staging tables for OSM entities (pois, buildings, roads) 
 * and the finalized intelligence layer (h3_r9_features).
 */

-- 1. POIs Table
CREATE TABLE IF NOT EXISTS osm_pois (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    h3_r10 VARCHAR(15) NOT NULL,
    h3_r9 VARCHAR(15) NOT NULL,
    tags_json JSONB,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Buildings Table
CREATE TABLE IF NOT EXISTS osm_buildings (
    id BIGINT PRIMARY KEY,
    building_type VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    area DOUBLE PRECISION,
    h3_r10 VARCHAR(15) NOT NULL,
    h3_r9 VARCHAR(15) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Roads Table
CREATE TABLE IF NOT EXISTS osm_roads (
    id BIGINT PRIMARY KEY,
    road_type VARCHAR(100),
    name VARCHAR(255),
    length DOUBLE PRECISION,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    h3_r10 VARCHAR(15) NOT NULL,
    h3_r9 VARCHAR(15) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Intelligence Layer (Aggregated Features)
CREATE TABLE IF NOT EXISTS h3_r9_features (
    h3_r9 VARCHAR(15) PRIMARY KEY,
    building_density INT DEFAULT 0,
    poi_density INT DEFAULT 0,
    road_density INT DEFAULT 0,
    activity_score INT DEFAULT 0,
    mobility_score INT DEFAULT 0,
    calm_score INT DEFAULT 0,
    congestion_score INT DEFAULT 0,
    confidence_score INT DEFAULT 0,
    residential_score INT DEFAULT 0,
    commercial_score INT DEFAULT 0,
    land_use_type VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_osm_pois_h3_r9 ON osm_pois (h3_r9);
CREATE INDEX IF NOT EXISTS idx_osm_buildings_h3_r9 ON osm_buildings (h3_r9);
CREATE INDEX IF NOT EXISTS idx_osm_roads_h3_r9 ON osm_roads (h3_r9);
CREATE INDEX IF NOT EXISTS idx_osm_pois_h3_r10 ON osm_pois (h3_r10);
