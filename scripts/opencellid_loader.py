"""
OpenCellID Loader — Raw Import Pipeline
========================================
Reads the OpenCellID CSV, computes H3 R9 per tower, normalises carrier names,
and bulk-inserts into `opencellid_raw`.

Idempotent: ON CONFLICT on (mcc, mnc, lac, cid) performs an UPDATE so
running the script multiple times does not create duplicate rows.

Usage:
    python scripts/opencellid_loader.py --input "path/to/opencellid_data.csv"

Environment:
    DATABASE_URL — Neon / PostgreSQL connection string (or pass --db-url)

Official Nigerian MNC assignments (MCC 621):
    mnc=20 → Airtel   (formerly Zain / Econet)
    mnc=30 → MTN
    mnc=50 → Glo
    mnc=60 → 9mobile  (formerly Etisalat)
"""

import os
import sys
import argparse
from datetime import datetime, timezone

import pandas as pd
import h3
from sqlalchemy import create_engine, text

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
# Carrier map — official Nigerian MNC assignments (MCC 621)
# Source: ITU / NCC Nigeria operator registry
# ---------------------------------------------------------------------------
# MCC 621 = Nigeria
CARRIER_MAP: dict[int, str] = {
    20: "Airtel",    # Airtel (formerly Zain / Econet)
    30: "MTN",
    50: "Glo",
    60: "9mobile",   # 9mobile (formerly Etisalat)
}

# OpenCellID radio values → canonical technology strings stored in DB
RADIO_NORMALISE: dict[str, str] = {
    "GSM":  "GSM",
    "UMTS": "UMTS",
    "LTE":  "LTE",
    "NR":   "NR",   # 5G New Radio
}

# Lagos bounding box (lat_min, lat_max, lng_min, lng_max)
# Adjust if you want to import towers outside this window.
LAGOS_BOUNDS = {
    "lat_min": 6.35,
    "lat_max": 6.70,
    "lng_min": 3.10,
    "lng_max": 3.60,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_h3(lat: float, lng: float) -> str | None:
    try:
        return h3.latlng_to_cell(lat, lng, 9)
    except AttributeError:
        return h3.geo_to_h3(lat, lng, 9)
    except Exception:
        return None


def _epoch_to_ts(value) -> datetime | None:
    try:
        epoch = int(float(str(value)))
        if epoch <= 0:
            return None
        return datetime.fromtimestamp(epoch, tz=timezone.utc)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# CSV column positions (OpenCellID export — no header row)
# ---------------------------------------------------------------------------
CSV_COLS = {
    "radio":         0,
    "mcc":           1,
    "mnc":           2,
    "lac":           3,
    "cid":           4,
    # column 5 = unit (unused)
    "longitude":     6,
    "latitude":      7,
    "range":         8,
    "samples":       9,
    # column 10 = changeable (unused)
    "created":       11,
    "updated":       12,
    "avg_signal":    13,
}


# ---------------------------------------------------------------------------
# Main loader
# ---------------------------------------------------------------------------

def run_loader(input_file: str, db_url: str, dry_run: bool = False):
    print("=== OpenCellID Raw Loader ===")
    print(f"Input:   {input_file}")
    print(f"Dry-run: {dry_run}")

    # ------------------------------------------------------------------
    # 1. Load CSV
    # ------------------------------------------------------------------
    try:
        df = pd.read_csv(input_file, header=None, dtype=str, low_memory=False)
    except FileNotFoundError:
        print(f"ERROR: file not found — {input_file}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR reading CSV: {e}")
        sys.exit(1)

    print(f"Rows loaded:  {len(df):,}")

    # ------------------------------------------------------------------
    # 2. Filter: Nigeria MCC + Lagos bounds
    # ------------------------------------------------------------------
    df = df[df[CSV_COLS["mcc"]] == "621"].copy()

    lats = pd.to_numeric(df[CSV_COLS["latitude"]],  errors="coerce")
    lngs = pd.to_numeric(df[CSV_COLS["longitude"]], errors="coerce")

    mask = (
        lats.between(LAGOS_BOUNDS["lat_min"], LAGOS_BOUNDS["lat_max"]) &
        lngs.between(LAGOS_BOUNDS["lng_min"], LAGOS_BOUNDS["lng_max"])
    )
    df = df[mask].copy()
    print(f"After Lagos filter: {len(df):,} rows")

    if df.empty:
        print("No rows match bounds — exiting.")
        return

    # ------------------------------------------------------------------
    # 3. Parse + enrich
    # ------------------------------------------------------------------
    records = []
    skipped = 0

    for _, row in df.iterrows():
        try:
            radio_raw = str(row[CSV_COLS["radio"]]).strip().upper()
            radio = RADIO_NORMALISE.get(radio_raw)
            if radio is None:
                skipped += 1
                continue

            mnc = int(float(row[CSV_COLS["mnc"]]))
            carrier_name = CARRIER_MAP.get(mnc)
            if carrier_name is None:
                # Unknown carrier for this MCC — skip silently
                skipped += 1
                continue

            lat = float(row[CSV_COLS["latitude"]])
            lng = float(row[CSV_COLS["longitude"]])
            h3_r9 = _to_h3(lat, lng)
            if h3_r9 is None:
                skipped += 1
                continue

            def _int(col):
                try: return int(float(row[col]))
                except: return None

            records.append({
                "radio":              radio,
                "mcc":                621,
                "mnc":                mnc,
                "carrier_name":       carrier_name,
                "lac":                _int(CSV_COLS["lac"]),
                "cid":                _int(CSV_COLS["cid"]),
                "latitude":           lat,
                "longitude":          lng,
                "range":              _int(CSV_COLS["range"]),
                "samples":            _int(CSV_COLS["samples"]),
                "average_signal":     _int(CSV_COLS["avg_signal"]),
                "created_timestamp":  _epoch_to_ts(row[CSV_COLS["created"]]),
                "updated_timestamp":  _epoch_to_ts(row[CSV_COLS["updated"]]),
                "h3_r9":              h3_r9,
            })
        except Exception:
            skipped += 1
            continue

    print(f"Parsed: {len(records):,} valid rows | skipped: {skipped:,}")

    if dry_run:
        print("[dry-run] Would insert the above rows. No DB changes made.")
        return

    # ------------------------------------------------------------------
    # 4. Connect + migrate schema
    # ------------------------------------------------------------------
    engine = create_engine(db_url, pool_pre_ping=True)

    migration_path = os.path.join(
        os.path.dirname(__file__), "..", "db", "migrations", "006_network.sql"
    )
    migration_path = os.path.normpath(migration_path)

    with engine.begin() as conn:
        # Apply schema migration (idempotent — uses IF NOT EXISTS)
        if os.path.exists(migration_path):
            with open(migration_path) as f:
                conn.execute(text(f.read()))
            print("Schema migration applied.")
        else:
            print(f"WARNING: migration file not found at {migration_path}")

        # Drop old table if still present
        conn.execute(text("DROP TABLE IF EXISTS h3_staging_internet"))
        print("Dropped h3_staging_internet (if it existed).")

    # ------------------------------------------------------------------
    # 5. Idempotent bulk insert
    #    Conflict key: (mcc, mnc, lac, cid)  — uniquely identifies a cell.
    #    On conflict: update mutable fields (range, samples, signal, h3_r9, timestamps).
    # ------------------------------------------------------------------
    BATCH = 2000
    inserted = 0
    updated = 0

    with engine.begin() as conn:
        # Ensure unique constraint exists for idempotency
        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_opencellid_tower
            ON opencellid_raw (mcc, mnc, lac, cid)
        """))

    for i in range(0, len(records), BATCH):
        batch = records[i : i + BATCH]
        with engine.begin() as conn:
            result = conn.execute(
                text("""
                    INSERT INTO opencellid_raw
                        (radio, mcc, mnc, carrier_name, lac, cid,
                         latitude, longitude, range, samples, average_signal,
                         created_timestamp, updated_timestamp, h3_r9)
                    VALUES
                        (:radio, :mcc, :mnc, :carrier_name, :lac, :cid,
                         :latitude, :longitude, :range, :samples, :average_signal,
                         :created_timestamp, :updated_timestamp, :h3_r9)
                    ON CONFLICT (mcc, mnc, lac, cid) DO UPDATE SET
                        radio              = EXCLUDED.radio,
                        latitude           = EXCLUDED.latitude,
                        longitude          = EXCLUDED.longitude,
                        range              = EXCLUDED.range,
                        samples            = EXCLUDED.samples,
                        average_signal     = EXCLUDED.average_signal,
                        updated_timestamp  = EXCLUDED.updated_timestamp,
                        h3_r9              = EXCLUDED.h3_r9
                """),
                batch
            )
        inserted += len(batch)
        print(f"  Batch {i // BATCH + 1}: {len(batch)} rows upserted")

    print(f"\n✓ Done — {inserted:,} rows upserted into opencellid_raw.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Import OpenCellID tower data into opencellid_raw"
    )
    parser.add_argument(
        "--input",
        required=True,
        help='Path to raw OpenCellID CSV (no header). '
             r'Example: "src/lib/csv files/opencellid_data copy.csv"'
    )
    parser.add_argument(
        "--db-url",
        default=None,
        help="PostgreSQL connection string (fallback: DATABASE_URL env var)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate the CSV without writing to the database"
    )
    args = parser.parse_args()

    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url and not args.dry_run:
        print("ERROR: DATABASE_URL not set. Pass --db-url or set the environment variable.")
        sys.exit(1)

    run_loader(args.input, db_url or "", args.dry_run)
