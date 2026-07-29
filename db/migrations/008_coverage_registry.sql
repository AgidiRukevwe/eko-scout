/*
 * Coverage Registry (Migration 008)
 * ------------------------------------
 * Lightweight audit table tracking which datasets have been ingested
 * for which Lagos LGAs/areas, and the status of each run.
 *
 * One row per ingestion run (not per cell). Intended to be queried by
 * developers and pipeline scripts — not by the application API.
 *
 * Columns:
 *   area_name   — Human-readable LGA or area name, e.g. "Lagos Mainland", "Ikeja"
 *   dataset     — Which dataset was processed, e.g. "osm_pois", "osm_buildings",
 *                 "electricity", "osm_roads", "opencellid"
 *   status      — Outcome: "complete" | "partial" | "failed"
 *   row_count   — Number of rows ingested or aggregated in this run
 *   started_at  — When the run began (set automatically)
 *   finished_at — When the run completed (set by the script on success/failure)
 *   notes       — Optional free-text: error message, warnings, or run metadata
 */

CREATE TABLE IF NOT EXISTS coverage_registry (
    id           BIGSERIAL     PRIMARY KEY,
    area_name    TEXT          NOT NULL,
    dataset      TEXT          NOT NULL,
    status       TEXT          NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
    row_count    INTEGER,
    started_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ,
    notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_coverage_registry_area    ON coverage_registry (area_name);
CREATE INDEX IF NOT EXISTS idx_coverage_registry_dataset ON coverage_registry (dataset);
CREATE INDEX IF NOT EXISTS idx_coverage_registry_status  ON coverage_registry (status);
