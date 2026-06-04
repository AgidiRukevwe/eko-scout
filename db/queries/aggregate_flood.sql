/* 
 * EkoScout Flood Intelligence Aggregation
 * ---------------------------------------
 * Calculates deterministic flood risk exposure for H3 cells based on LASEMA data.
 * Applies a 2-layer scoring model:
 * Layer 1: Baseline flood score derived from LGA.
 * Layer 2: Score boost (+20) if the hex intersects a known flood-prone community.
 */

TRUNCATE TABLE h3_r9_flood;

WITH baseline AS (
    -- Maps the raw percentages to the base score (Layer 1)
    SELECT 
        h3_index,
        highest_point_m, 
        lowest_point_m, 
        elevation_range_m,
        CASE 
            WHEN flood_percent <= 5 THEN 10
            WHEN flood_percent <= 15 THEN 25
            WHEN flood_percent <= 30 THEN 45
            WHEN flood_percent <= 50 THEN 70
            ELSE 90
        END AS baseline_flood_score
    FROM h3_staging_lga_flood
),
community_boost AS (
    -- Identifies hexes intersecting high-risk communities (Layer 2)
    -- Group by to prevent duplicates if a hex falls in multiple communities
    SELECT 
        h3_index, 
        TRUE as flood_prone_locality, 
        STRING_AGG(community_name, ', ') AS community_name 
    FROM h3_staging_flood_community
    GROUP BY h3_index
),
scoring AS (
    SELECT 
        b.h3_index, 
        b.baseline_flood_score, 
        b.highest_point_m, 
        b.lowest_point_m, 
        b.elevation_range_m,
        COALESCE(c.flood_prone_locality, FALSE) AS flood_prone_locality,
        c.community_name AS flood_locality_name,
        
        -- Apply the +20 boost with a cap of 100
        LEAST(100, b.baseline_flood_score + (CASE WHEN COALESCE(c.flood_prone_locality, FALSE) THEN 20 ELSE 0 END)) AS flood_exposure_score
    FROM baseline b
    LEFT JOIN community_boost c ON b.h3_index = c.h3_index
)

INSERT INTO h3_r9_flood (
    h3_index, 
    baseline_flood_score, 
    flood_exposure_score, 
    flood_risk_level, 
    flood_prone_locality, 
    flood_locality_name, 
    highest_point_m, 
    lowest_point_m, 
    elevation_range_m, 
    confidence_score, 
    confidence_label, 
    updated_at
)
SELECT 
    h3_index,
    baseline_flood_score,
    flood_exposure_score,
    
    -- Absolute Thresholds for Risk Level
    CASE 
        WHEN flood_exposure_score <= 20 THEN 'Low'
        WHEN flood_exposure_score <= 40 THEN 'Medium'
        WHEN flood_exposure_score <= 70 THEN 'High'
        ELSE 'Severe'
    END AS flood_risk_level,
    
    flood_prone_locality,
    flood_locality_name,
    highest_point_m,
    lowest_point_m,
    elevation_range_m,
    
    -- Confidence score. Given this is deterministic mapping from authoritative LASEMA data,
    -- we set baseline confidence. If it has a community hit, it's very high confidence.
    CASE 
        WHEN flood_prone_locality THEN 95
        ELSE 75 
    END AS confidence_score,
    
    CASE 
        WHEN flood_prone_locality THEN 'High'
        ELSE 'Medium'
    END AS confidence_label,
    
    CURRENT_TIMESTAMP
FROM scoring

ON CONFLICT (h3_index) DO UPDATE SET
    baseline_flood_score = EXCLUDED.baseline_flood_score,
    flood_exposure_score = EXCLUDED.flood_exposure_score,
    flood_risk_level = EXCLUDED.flood_risk_level,
    flood_prone_locality = EXCLUDED.flood_prone_locality,
    flood_locality_name = EXCLUDED.flood_locality_name,
    highest_point_m = EXCLUDED.highest_point_m,
    lowest_point_m = EXCLUDED.lowest_point_m,
    elevation_range_m = EXCLUDED.elevation_range_m,
    confidence_score = EXCLUDED.confidence_score,
    confidence_label = EXCLUDED.confidence_label,
    updated_at = CURRENT_TIMESTAMP;
