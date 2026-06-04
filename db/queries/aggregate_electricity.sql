/* 
 * EkoScout Electricity Infrastructure Aggregation
 * -----------------------------------------------
 * This script maps raw electrical feeders to their respective H3 cells.
 * It mandates deterministic aggregation: No probabilities or ML distributions.
 * The output for each cell is a single Dominant Band (with tie breakers) and
 * an absolute Confidence Label based purely on raw agreement metrics.
 */

TRUNCATE TABLE electricity_h3_features;

WITH raw_bands AS (
    SELECT 
        h3_index,
        -- Extract the primary band letter.
        CASE 
            WHEN service_band LIKE '%A%' THEN 'A'
            WHEN service_band LIKE '%B%' THEN 'B'
            WHEN service_band LIKE '%C%' THEN 'C'
            WHEN service_band LIKE '%D%' THEN 'D'
            WHEN service_band LIKE '%E%' THEN 'E'
            ELSE 'UNKNOWN'
        END AS band
    FROM h3_staging_power
    WHERE h3_index IS NOT NULL
),
band_counts AS (
    SELECT
        h3_index,
        COUNT(*)::INT AS feeder_count,
        SUM(CASE WHEN band = 'A' THEN 1 ELSE 0 END)::INT AS band_a_count,
        SUM(CASE WHEN band = 'B' THEN 1 ELSE 0 END)::INT AS band_b_count,
        SUM(CASE WHEN band = 'C' THEN 1 ELSE 0 END)::INT AS band_c_count,
        SUM(CASE WHEN band = 'D' THEN 1 ELSE 0 END)::INT AS band_d_count,
        SUM(CASE WHEN band = 'E' THEN 1 ELSE 0 END)::INT AS band_e_count
    FROM raw_bands
    GROUP BY h3_index
),
band_dominance AS (
    SELECT
        *,
        -- Determine the dominant band using absolute counts. 
        -- If tied, the GREATEST function allows cascading priority logic: A > B > C > D > E
        CASE
            WHEN band_a_count >= GREATEST(band_b_count, band_c_count, band_d_count, band_e_count) AND band_a_count > 0 THEN 'A'
            WHEN band_b_count >= GREATEST(band_a_count, band_c_count, band_d_count, band_e_count) AND band_b_count > 0 THEN 'B'
            WHEN band_c_count >= GREATEST(band_a_count, band_b_count, band_d_count, band_e_count) AND band_c_count > 0 THEN 'C'
            WHEN band_d_count >= GREATEST(band_a_count, band_b_count, band_c_count, band_e_count) AND band_d_count > 0 THEN 'D'
            WHEN band_e_count >= GREATEST(band_a_count, band_b_count, band_c_count, band_d_count) AND band_e_count > 0 THEN 'E'
            ELSE 'UNKNOWN'
        END AS dominant_band
    FROM band_counts
),
confidence_scoring AS (
    SELECT
        *,
        -- The confidence score is strictly the percentage of agreement for the dominant band.
        CASE 
            WHEN feeder_count = 0 THEN 0
            WHEN dominant_band = 'A' THEN ROUND((band_a_count::NUMERIC / feeder_count) * 100)::INT
            WHEN dominant_band = 'B' THEN ROUND((band_b_count::NUMERIC / feeder_count) * 100)::INT
            WHEN dominant_band = 'C' THEN ROUND((band_c_count::NUMERIC / feeder_count) * 100)::INT
            WHEN dominant_band = 'D' THEN ROUND((band_d_count::NUMERIC / feeder_count) * 100)::INT
            WHEN dominant_band = 'E' THEN ROUND((band_e_count::NUMERIC / feeder_count) * 100)::INT
            ELSE 0
        END AS confidence_score
    FROM band_dominance
)

INSERT INTO electricity_h3_features (
    h3_index, dominant_band,
    band_a_count, band_b_count, band_c_count, band_d_count, band_e_count,
    feeder_count, confidence_score, confidence_label, updated_at
)
SELECT 
    h3_index,
    dominant_band,
    band_a_count,
    band_b_count,
    band_c_count,
    band_d_count,
    band_e_count,
    feeder_count,
    confidence_score,
    
    -- Absolute threshold rule:
    -- If a hex has < 3 overall feeders, it is impossible to have high statistical confidence in the entire 0.1 sq km cell.
    CASE
        WHEN feeder_count < 3 THEN 'Low'
        WHEN confidence_score >= 70 THEN 'High'
        WHEN confidence_score >= 50 THEN 'Medium'
        ELSE 'Low'
    END AS confidence_label,
    
    CURRENT_TIMESTAMP
FROM confidence_scoring

ON CONFLICT (h3_index) DO UPDATE SET
    dominant_band = EXCLUDED.dominant_band,
    band_a_count = EXCLUDED.band_a_count,
    band_b_count = EXCLUDED.band_b_count,
    band_c_count = EXCLUDED.band_c_count,
    band_d_count = EXCLUDED.band_d_count,
    band_e_count = EXCLUDED.band_e_count,
    feeder_count = EXCLUDED.feeder_count,
    confidence_score = EXCLUDED.confidence_score,
    confidence_label = EXCLUDED.confidence_label,
    updated_at = CURRENT_TIMESTAMP;
