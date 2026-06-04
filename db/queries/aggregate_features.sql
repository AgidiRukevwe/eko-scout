/* 
 * EkoScout Environment Features Aggregation
 * -----------------------------------------
 * This script aggregates OSM entities (buildings, POIs, roads) into a unified H3 R9 grid.
 * It enforces deterministic classification logic (no percentiles or ML probabilities).
 * The pipeline normalizes entities, computes absolute intent scores, and uses strict 
 * threshold formulas (e.g. building_density > 5) to assign a definitive land_use_type.
 */

TRUNCATE TABLE h3_r9_features;

WITH normalized_buildings AS (
    SELECT 
        h3_r9,
        CASE 
            WHEN building_type IN ('residential','apartments','house','bungalow','dormitory','terrace')
                THEN 'residential'
            WHEN building_type IN ('commercial','retail','office','hotel','industrial','warehouse')
                THEN 'commercial'
            ELSE 'other'
        END AS norm_type
    FROM osm_buildings
),

normalized_pois AS (
    SELECT 
        h3_r9,
        CASE 
            WHEN category IN ('school','university','college','kindergarten')
                THEN 'education'
            WHEN category IN ('hospital','clinic','pharmacy','doctors','dentist')
                THEN 'health'
            WHEN category IN ('parking','fuel','bus_station','taxi')
                THEN 'transport'
            WHEN category IN ('bank','atm','marketplace','vending_machine')
                THEN 'commercial'
            WHEN category IN ('restaurant','fast_food','cafe','bar','pub')
                THEN 'food'
            ELSE 'other'
        END AS norm_cat
    FROM osm_pois
),

hex_buildings AS (
    SELECT 
        h3_r9,
        COUNT(*) AS building_density
    FROM normalized_buildings
    GROUP BY h3_r9
),

hex_pois AS (
    SELECT 
        h3_r9,
        COUNT(*) AS poi_density,
        SUM(CASE WHEN norm_cat = 'education' THEN 1 ELSE 0 END) AS edu_pois,
        SUM(CASE WHEN norm_cat = 'health' THEN 1 ELSE 0 END) AS health_pois,
        SUM(CASE WHEN norm_cat = 'transport' THEN 1 ELSE 0 END) AS transport_pois,
        SUM(CASE WHEN norm_cat = 'commercial' THEN 1 ELSE 0 END) AS commercial_pois,
        SUM(CASE WHEN norm_cat = 'food' THEN 1 ELSE 0 END) AS food_pois
    FROM normalized_pois
    GROUP BY h3_r9
),

hex_roads AS (
    SELECT 
        h3_r9,
        COUNT(*) AS road_density,
        SUM(CASE WHEN road_type IN ('motorway','trunk','primary','secondary')
            THEN 1 ELSE 0 END) AS major_roads
    FROM osm_roads
    GROUP BY h3_r9
),

hex AS (
    SELECT 
        COALESCE(b.h3_r9, p.h3_r9, r.h3_r9) AS h3_r9,
        COALESCE(b.building_density, 0) AS building_density,
        COALESCE(p.poi_density, 0) AS poi_density,
        COALESCE(r.road_density, 0) AS road_density,

        COALESCE(p.edu_pois, 0) AS edu_pois,
        COALESCE(p.health_pois, 0) AS health_pois,
        COALESCE(p.transport_pois, 0) AS transport_pois,
        COALESCE(p.commercial_pois, 0) AS commercial_pois,
        COALESCE(p.food_pois, 0) AS food_pois,

        
        -- Activity: Strict count of interactive entities (POIs + Roads). Buildings are excluded to prevent 
        -- purely residential sleep-towns from scoring high activity.
        COALESCE(p.poi_density, 0) + COALESCE(r.road_density, 0) AS activity_score,
        
        -- Mobility: Reflects transit availability.
        COALESCE(p.transport_pois, 0) * 2 + COALESCE(r.road_density, 0) AS mobility_score,
        
        -- Calm: Inversely related to activity, favoring heavy residential presence without commercial noise.
        COALESCE(b.building_density, 0) * 2 + COALESCE(p.health_pois, 0) * 1 AS calm_score,
        
        -- Residential Intent: Heavily weighted by schools, clinics, and strict building count.
        (COALESCE(p.edu_pois, 0) * 3) + 
        (COALESCE(p.health_pois, 0) * 2) + 
        (COALESCE(b.building_density, 0) * 1.0) AS residential_score,
        
        -- Commercial Intent: Multipliers attached to distinct commercial and transport markers.
        (COALESCE(p.commercial_pois, 0) * 3) + 
        (COALESCE(p.transport_pois, 0) * 2) + 
        (COALESCE(b.building_density, 0) * 2.0) AS commercial_score

    FROM hex_buildings b
    FULL OUTER JOIN hex_pois p ON b.h3_r9 = p.h3_r9
    FULL OUTER JOIN hex_roads r ON COALESCE(b.h3_r9, p.h3_r9) = r.h3_r9
)

-- ==========================================
-- 4. Final Classification & Insert
-- ==========================================
INSERT INTO h3_r9_features (
    h3_r9, building_density, poi_density, road_density,
    activity_score, mobility_score, calm_score,
    residential_score, commercial_score,
    confidence_score, congestion_score, land_use_type, updated_at
)
SELECT 
    h3_r9,
    building_density,
    poi_density,
    road_density,
    activity_score,
    mobility_score,
    calm_score,
    residential_score,
    commercial_score,
    
    -- Confidence and Congestion use Percent Rank ONLY for UI visualization purposes, 
    -- they are NEVER used as inputs to the land_use_type classification logic.
    CAST(PERCENT_RANK() OVER (ORDER BY activity_score + mobility_score) * 100 AS INT) AS confidence_score,
    CAST(PERCENT_RANK() OVER (ORDER BY road_density + (poi_density * 0.5)) * 100 AS INT) AS congestion_score,
    
    -- The core deterministic classification engine
    CASE 
        -- Must have significant interactive density to even be considered developed
        WHEN activity_score < 10 THEN 'undeveloped'
        -- Residential must beat commercial by 1.4x AND have actual structural footprint (>5)
        WHEN residential_score > (commercial_score * 1.4) AND building_density > 5 THEN 'residential'
        -- Commercial must beat residential by 1.4x AND have strong overall activity
        WHEN commercial_score > (residential_score * 1.4) AND activity_score > 15 THEN 'commercial'
        -- If both intents are exceedingly high and comparable, it's mixed
        WHEN residential_score > 20 AND commercial_score > 20 THEN 'mixed-use'
        -- Hexes with almost no signal fall to unknown
        WHEN (residential_score + commercial_score) < 15 THEN 'unknown'
        -- Everything else is in flux
        ELSE 'transitional'
    END AS land_use_type,
    CURRENT_TIMESTAMP
FROM hex

ON CONFLICT (h3_r9) DO UPDATE SET
    building_density = EXCLUDED.building_density,
    poi_density = EXCLUDED.poi_density,
    road_density = EXCLUDED.road_density,
    activity_score = EXCLUDED.activity_score,
    mobility_score = EXCLUDED.mobility_score,
    calm_score = EXCLUDED.calm_score,
    congestion_score = EXCLUDED.congestion_score,
    confidence_score = EXCLUDED.confidence_score,
    residential_score = EXCLUDED.residential_score,
    commercial_score = EXCLUDED.commercial_score,
    land_use_type = EXCLUDED.land_use_type,
    updated_at = CURRENT_TIMESTAMP;
