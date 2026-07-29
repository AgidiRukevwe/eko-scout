/*
 * Mark osm_buildings as Staging (Migration 009)
 * -----------------------------------------------
 * osm_buildings is a staging table, not a permanent production table.
 * It is populated during OSM ingestion and should be TRUNCATED after
 * aggregate_features.sql has run successfully.
 *
 * Keeping it populated between runs on Neon Free will exhaust storage
 * when ingesting full Lagos (est. 2–4 million building records).
 *
 * This migration adds a Postgres table comment to make the intent explicit
 * for any developer or tool inspecting the schema.
 */

COMMENT ON TABLE osm_buildings IS
    'Staging table. Populated during OSM ingestion to compute h3_r9_features. '
    'TRUNCATED automatically at the end of aggregate_features.sql. '
    'Do NOT query directly from the application layer. '
    'Do NOT treat as a permanent production table.';
