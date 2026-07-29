/*
 * Freshness Metadata (Migration 007)
 * ------------------------------------
 * Adds computed_at and data_version to all intelligence tables.
 *
 * computed_at  — when this row was last fully recomputed from source data.
 *                Set explicitly by the aggregation script, not via DEFAULT NOW(),
 *                so it reflects the actual processing time rather than insertion time.
 *
 * data_version — short identifier for the ingestion run that produced this row.
 *                Format: "<area>-<dataset>-<YYYY-MM>", e.g. "lagos-mainland-osm-2025-07".
 *                Allows partial refreshes to be traced back to their source run.
 *
 * Note: h3_network_features already has last_updated — data_version is added only.
 */

-- h3_r9_features
ALTER TABLE h3_r9_features
    ADD COLUMN IF NOT EXISTS computed_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS data_version  TEXT;

-- electricity_h3_features
ALTER TABLE electricity_h3_features
    ADD COLUMN IF NOT EXISTS computed_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS data_version  TEXT;

-- h3_network_features (last_updated already exists)
ALTER TABLE h3_network_features
    ADD COLUMN IF NOT EXISTS data_version  TEXT;

-- h3_r9_flood
ALTER TABLE h3_r9_flood
    ADD COLUMN IF NOT EXISTS computed_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS data_version  TEXT;
