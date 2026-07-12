"""
Network Features Aggregation
==============================
Reads `opencellid_raw` and populates `h3_network_features` with
per-carrier, per-technology tower counts.

Idempotent: ON CONFLICT (h3_index) DO UPDATE ensures re-running this script
updates existing rows rather than creating duplicates.

Confidence score formula
------------------------
Derived from three measurable data quality signals:

    tower_score    = min(tower_count,  50) / 50 * 60   → up to 60 pts
    sample_score   = min(avg_samples, 20)  / 20 * 20   → up to 20 pts
    freshness_score = 20 if most recent tower update within 730 days else 0
                                                        → up to 20 pts

    confidence_score = round(tower_score + sample_score + freshness_score)

These thresholds reflect data density, not telecom signal quality.
If you need different thresholds, adjust the constants at the top of
the file.

Usage:
    python scripts/aggregate_network.py [--db-url <url>]
"""

import os
import sys
from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine, text

# ---------------------------------------------------------------------------
# Confidence score constants — data quality thresholds only (not telecom)
# ---------------------------------------------------------------------------

# How many towers in one H3 cell represents "full" density coverage
TOWER_SCORE_CAP = 50        # caps the tower_count contribution
TOWER_SCORE_WEIGHT = 60     # max points from tower count

# What average sample count represents "well-observed" towers
SAMPLE_SCORE_CAP = 20       # caps the avg_samples contribution
SAMPLE_SCORE_WEIGHT = 20    # max points from sample quality

# If the most-recently-updated tower in the cell is older than this, no freshness bonus
FRESHNESS_DAYS = 730        # ~2 years
FRESHNESS_WEIGHT = 20       # max points from freshness

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

def load_env_files():
    for filename in [".env.local", ".env"]:
        if os.path.exists(filename):
            try:
                with open(filename) as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key:
                            os.environ[key] = value
            except Exception as e:
                print(f"Warning: failed to load {filename}: {e}")

load_env_files()

# ---------------------------------------------------------------------------
# Aggregation SQL
# ---------------------------------------------------------------------------

AGGREGATE_SQL = text("""
INSERT INTO h3_network_features (
    h3_index,

    mtn_gsm_count, mtn_3g_count, mtn_lte_count, mtn_5g_count,
    airtel_gsm_count, airtel_3g_count, airtel_lte_count, airtel_5g_count,
    glo_gsm_count, glo_3g_count, glo_lte_count, glo_5g_count,
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

    -- 9mobile
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

    -- Confidence score (0–100): data quality metric, not a telecom signal rating
    LEAST(100, ROUND(
        -- Tower density contribution (up to 60 pts)
        (LEAST(COUNT(*), :tower_cap)::numeric / :tower_cap) * :tower_weight
        +
        -- Sample quality contribution (up to 20 pts)
        (LEAST(COALESCE(AVG(NULLIF(samples, 0)), 0), :sample_cap)::numeric / :sample_cap) * :sample_weight
        +
        -- Freshness contribution (up to 20 pts)
        CASE
            WHEN MAX(updated_timestamp) >= NOW() - INTERVAL '1 day' * :freshness_days
            THEN :freshness_weight
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
    last_updated            = EXCLUDED.last_updated
""")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_aggregation(db_url: str):
    print("=== Network Features Aggregation ===")

    engine = create_engine(db_url, pool_pre_ping=True)

    with engine.begin() as conn:
        # Confirm source table exists
        exists = conn.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'opencellid_raw'
            )
        """)).scalar()

        if not exists:
            print("ERROR: opencellid_raw does not exist. Run opencellid_loader.py first.")
            sys.exit(1)

        source_count = conn.execute(
            text("SELECT COUNT(*) FROM opencellid_raw")
        ).scalar()
        print(f"Source rows in opencellid_raw: {source_count:,}")

        if source_count == 0:
            print("No data to aggregate — exiting.")
            return

        print("Running aggregation (this may take a moment)…")
        conn.execute(
            AGGREGATE_SQL,
            {
                "tower_cap":        TOWER_SCORE_CAP,
                "tower_weight":     TOWER_SCORE_WEIGHT,
                "sample_cap":       SAMPLE_SCORE_CAP,
                "sample_weight":    SAMPLE_SCORE_WEIGHT,
                "freshness_days":   FRESHNESS_DAYS,
                "freshness_weight": FRESHNESS_WEIGHT,
            }
        )

        h3_count = conn.execute(
            text("SELECT COUNT(*) FROM h3_network_features")
        ).scalar()

    print(f"✓ Done — {h3_count:,} H3 cells written to h3_network_features.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Aggregate opencellid_raw into h3_network_features"
    )
    parser.add_argument(
        "--db-url",
        default=None,
        help="PostgreSQL connection string (fallback: DATABASE_URL env var)"
    )
    args = parser.parse_args()

    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set. Pass --db-url or set the environment variable.")
        sys.exit(1)

    run_aggregation(db_url)
