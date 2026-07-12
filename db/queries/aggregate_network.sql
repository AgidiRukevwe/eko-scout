/*
 * Network Features Aggregation — SQL Reference
 * ---------------------------------------------
 * SQL equivalent of aggregate_network.py.
 *
 * Idempotent: ON CONFLICT (h3_index) DO UPDATE ensures this can be re-run
 * without creating duplicate rows.
 *
 * Confidence score formula:
 *   tower_score    = LEAST(tower_count, 50) / 50.0 * 60   → up to 60 pts
 *   sample_score   = LEAST(avg_samples,  20) / 20.0 * 20  → up to 20 pts
 *   freshness_score = 20 if most recent update within 730 days, else 0
 *
 *   confidence_score = ROUND(tower_score + sample_score + freshness_score)
 *
 * Run this after opencellid_loader.py has populated opencellid_raw.
 */

INSERT INTO h3_network_features (
    h3_index,

    mtn_gsm_count,    mtn_3g_count,    mtn_lte_count,    mtn_5g_count,
    airtel_gsm_count, airtel_3g_count, airtel_lte_count, airtel_5g_count,
    glo_gsm_count,    glo_3g_count,    glo_lte_count,    glo_5g_count,
    nine_mobile_gsm_count, nine_mobile_3g_count, nine_mobile_lte_count, nine_mobile_5g_count,

    total_gsm, total_3g, total_lte, total_5g,
    tower_count, confidence_score, last_updated
)
SELECT
    h3_r9 AS h3_index,

    -- MTN
    COUNT(*) FILTER (WHERE carrier_name = 'MTN'    AND radio = 'GSM')  AS mtn_gsm_count,
    COUNT(*) FILTER (WHERE carrier_name = 'MTN'    AND radio = 'UMTS') AS mtn_3g_count,
    COUNT(*) FILTER (WHERE carrier_name = 'MTN'    AND radio = 'LTE')  AS mtn_lte_count,
    COUNT(*) FILTER (WHERE carrier_name = 'MTN'    AND radio = 'NR')   AS mtn_5g_count,

    -- Airtel
    COUNT(*) FILTER (WHERE carrier_name = 'Airtel' AND radio = 'GSM')  AS airtel_gsm_count,
    COUNT(*) FILTER (WHERE carrier_name = 'Airtel' AND radio = 'UMTS') AS airtel_3g_count,
    COUNT(*) FILTER (WHERE carrier_name = 'Airtel' AND radio = 'LTE')  AS airtel_lte_count,
    COUNT(*) FILTER (WHERE carrier_name = 'Airtel' AND radio = 'NR')   AS airtel_5g_count,

    -- Glo
    COUNT(*) FILTER (WHERE carrier_name = 'Glo'    AND radio = 'GSM')  AS glo_gsm_count,
    COUNT(*) FILTER (WHERE carrier_name = 'Glo'    AND radio = 'UMTS') AS glo_3g_count,
    COUNT(*) FILTER (WHERE carrier_name = 'Glo'    AND radio = 'LTE')  AS glo_lte_count,
    COUNT(*) FILTER (WHERE carrier_name = 'Glo'    AND radio = 'NR')   AS glo_5g_count,

    -- 9mobile (formerly Etisalat)
    COUNT(*) FILTER (WHERE carrier_name = '9mobile' AND radio = 'GSM')  AS nine_mobile_gsm_count,
    COUNT(*) FILTER (WHERE carrier_name = '9mobile' AND radio = 'UMTS') AS nine_mobile_3g_count,
    COUNT(*) FILTER (WHERE carrier_name = '9mobile' AND radio = 'LTE')  AS nine_mobile_lte_count,
    COUNT(*) FILTER (WHERE carrier_name = '9mobile' AND radio = 'NR')   AS nine_mobile_5g_count,

    -- Cross-carrier totals
    COUNT(*) FILTER (WHERE radio = 'GSM')  AS total_gsm,
    COUNT(*) FILTER (WHERE radio = 'UMTS') AS total_3g,
    COUNT(*) FILTER (WHERE radio = 'LTE')  AS total_lte,
    COUNT(*) FILTER (WHERE radio = 'NR')   AS total_5g,

    COUNT(*)                               AS tower_count,

    -- Confidence score (0–100): data quality metric only, not a signal rating.
    LEAST(100, ROUND(
        -- Tower density contribution (up to 60 pts)
        (LEAST(COUNT(*), 50)::numeric / 50.0) * 60.0
        +
        -- Sample quality contribution (up to 20 pts)
        (LEAST(COALESCE(AVG(NULLIF(samples, 0)), 0), 20)::numeric / 20.0) * 20.0
        +
        -- Freshness contribution (up to 20 pts)
        CASE
            WHEN MAX(updated_timestamp) >= NOW() - INTERVAL '730 days'
            THEN 20
            ELSE 0
        END
    ))::SMALLINT                           AS confidence_score,

    NOW()                                  AS last_updated

FROM opencellid_raw
GROUP BY h3_r9

ON CONFLICT (h3_index) DO UPDATE SET
    mtn_gsm_count           = EXCLUDED.mtn_gsm_count,
    mtn_3g_count            = EXCLUDED.mtn_3g_count,
    mtn_lte_count           = EXCLUDED.mtn_lte_count,
    mtn_5g_count            = EXCLUDED.mtn_5g_count,

    airtel_gsm_count        = EXCLUDED.airtel_gsm_count,
    airtel_3g_count         = EXCLUDED.airtel_3g_count,
    airtel_lte_count        = EXCLUDED.airtel_lte_count,
    airtel_5g_count         = EXCLUDED.airtel_5g_count,

    glo_gsm_count           = EXCLUDED.glo_gsm_count,
    glo_3g_count            = EXCLUDED.glo_3g_count,
    glo_lte_count           = EXCLUDED.glo_lte_count,
    glo_5g_count            = EXCLUDED.glo_5g_count,

    nine_mobile_gsm_count   = EXCLUDED.nine_mobile_gsm_count,
    nine_mobile_3g_count    = EXCLUDED.nine_mobile_3g_count,
    nine_mobile_lte_count   = EXCLUDED.nine_mobile_lte_count,
    nine_mobile_5g_count    = EXCLUDED.nine_mobile_5g_count,

    total_gsm               = EXCLUDED.total_gsm,
    total_3g                = EXCLUDED.total_3g,
    total_lte               = EXCLUDED.total_lte,
    total_5g                = EXCLUDED.total_5g,

    tower_count             = EXCLUDED.tower_count,
    confidence_score        = EXCLUDED.confidence_score,
    last_updated            = EXCLUDED.last_updated;
