/*
 * Network Infrastructure Schema (Migration 006)
 * -----------------------------------------------
 * Step 1: Raw OpenCellID tower data (source of truth)
 * Step 2: Aggregated H3 R9 network features (fast lookup layer)
 *
 * Design principles:
 *   - Raw table is the canonical source of truth
 *   - H3 table contains only measurable aggregated counts
 *   - No signal labels, ratings, or coverage strings stored in either table
 *   - All scoring is computed dynamically by the API (network_score.ts)
 */

-- ============================================================
-- 1. RAW TABLE: opencellid_raw
--    One row per cell tower observation imported from OpenCellID.
--    H3 R9 is computed at import time and stored for fast lookup.
-- ============================================================

CREATE TABLE IF NOT EXISTS opencellid_raw (
    id                 BIGSERIAL PRIMARY KEY,

    -- Tower identifiers (from OpenCellID CSV)
    radio              VARCHAR(10)    NOT NULL,          -- GSM | UMTS | LTE | NR
    mcc                SMALLINT       NOT NULL,          -- Mobile Country Code (621 = Nigeria)
    mnc                SMALLINT       NOT NULL,          -- Mobile Network Code
    carrier_name       VARCHAR(50)    NOT NULL,          -- Normalised: MTN | Glo | Airtel | 9mobile
    lac                INTEGER        NOT NULL,          -- Location Area Code
    cid                BIGINT         NOT NULL,          -- Cell ID

    -- Geographic position
    latitude           DOUBLE PRECISION NOT NULL,
    longitude          DOUBLE PRECISION NOT NULL,

    -- Tower metadata
    range              INTEGER,                          -- Estimated coverage radius in metres
    samples            INTEGER,                          -- Number of observations that contributed
    average_signal     SMALLINT,                        -- Average signal strength (dBm); -1 if unknown

    -- Timestamps (Unix epoch from source, stored as timestamptz)
    created_timestamp  TIMESTAMPTZ,
    updated_timestamp  TIMESTAMPTZ,

    -- Spatial index key — H3 Resolution 9 (~200 m hex)
    h3_r9              VARCHAR(15)    NOT NULL
);

-- Indexes for fast spatial and carrier queries
CREATE INDEX IF NOT EXISTS idx_opencellid_h3_r9        ON opencellid_raw (h3_r9);
CREATE INDEX IF NOT EXISTS idx_opencellid_carrier_name ON opencellid_raw (carrier_name);
CREATE INDEX IF NOT EXISTS idx_opencellid_radio        ON opencellid_raw (radio);


-- ============================================================
-- 2. AGGREGATED TABLE: h3_network_features
--    One row per H3 R9 cell.
--    Contains only measurable tower counts — never ratings or labels.
--    Populated and refreshed by aggregate_network.py.
-- ============================================================

CREATE TABLE IF NOT EXISTS h3_network_features (
    h3_index           VARCHAR(15)    PRIMARY KEY,

    -- MTN tower counts by technology
    mtn_gsm_count      INTEGER        NOT NULL DEFAULT 0,
    mtn_3g_count       INTEGER        NOT NULL DEFAULT 0,
    mtn_lte_count      INTEGER        NOT NULL DEFAULT 0,
    mtn_5g_count       INTEGER        NOT NULL DEFAULT 0,

    -- Airtel tower counts by technology
    airtel_gsm_count   INTEGER        NOT NULL DEFAULT 0,
    airtel_3g_count    INTEGER        NOT NULL DEFAULT 0,
    airtel_lte_count   INTEGER        NOT NULL DEFAULT 0,
    airtel_5g_count    INTEGER        NOT NULL DEFAULT 0,

    -- Glo tower counts by technology
    glo_gsm_count      INTEGER        NOT NULL DEFAULT 0,
    glo_3g_count       INTEGER        NOT NULL DEFAULT 0,
    glo_lte_count      INTEGER        NOT NULL DEFAULT 0,
    glo_5g_count       INTEGER        NOT NULL DEFAULT 0,

    -- 9mobile tower counts by technology
    nine_mobile_gsm_count   INTEGER   NOT NULL DEFAULT 0,
    nine_mobile_3g_count    INTEGER   NOT NULL DEFAULT 0,
    nine_mobile_lte_count   INTEGER   NOT NULL DEFAULT 0,
    nine_mobile_5g_count    INTEGER   NOT NULL DEFAULT 0,

    -- Cross-carrier technology totals
    total_gsm          INTEGER        NOT NULL DEFAULT 0,
    total_3g           INTEGER        NOT NULL DEFAULT 0,
    total_lte          INTEGER        NOT NULL DEFAULT 0,
    total_5g           INTEGER        NOT NULL DEFAULT 0,

    -- Cell totals
    tower_count        INTEGER        NOT NULL DEFAULT 0,

    -- Data quality metric (0–100).
    -- Derived from tower_count + average samples + observation freshness.
    -- Never stored as a signal label — consumed by scoreCarrier() only.
    confidence_score   SMALLINT       NOT NULL DEFAULT 0,

    last_updated       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
