/*
 * Electricity Infrastructure Schema (Migration 002)
 * -------------------------------------------------
 * Defines the final aggregated table for the electricity infrastructure layer.
 * Contains absolute band counts, the computed dominant band, and the deterministic confidence label.
 */

CREATE TABLE IF NOT EXISTS electricity_h3_features (
    h3_index VARCHAR(15) PRIMARY KEY,
    dominant_band VARCHAR(5),
    band_a_count INT DEFAULT 0,
    band_b_count INT DEFAULT 0,
    band_c_count INT DEFAULT 0,
    band_d_count INT DEFAULT 0,
    band_e_count INT DEFAULT 0,
    feeder_count INT DEFAULT 0,
    confidence_score INT DEFAULT 0,
    confidence_label VARCHAR(20),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
