# Refactored OpenCellID Loader with H3 aggregation and clean schema
import os
import sys
import argparse
from datetime import datetime
import pandas as pd
import h3
# import modifications
from sqlalchemy import create_engine, Column, String, Integer, DateTime, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
Base = declarative_base()


# -----------------------------------------------------------------------------
# Load environment variables from .env.local or .env (if present)
# -----------------------------------------------------------------------------
def load_env_files():
    for filename in [".env.local", ".env"]:
        if os.path.exists(filename):
            print(f"Loading environment variables from {filename}")
            try:
                with open(filename, "r") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, value = line.split("=", 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key and value:
                            os.environ[key] = value
            except Exception as e:
                print(f"Warning: Failed to load {filename}: {e}")

load_env_files()

# -----------------------------------------------------------------------------
# SQLAlchemy model – one row per H3 index (Resolution 9, ~100 m)
# -----------------------------------------------------------------------------
class H3StagingInternet(Base):
    __tablename__ = "h3_staging_internet"
    # Primary key – the H3 index string (15 characters)
    h3_index = Column(String, primary_key=True)
    # Signal quality per carrier – defaults to 'Poor'
    mtn_signal = Column(String, nullable=False, default='Poor')
    airtel_signal = Column(String, nullable=False, default='Poor')
    glo_signal = Column(String, nullable=False, default='Poor')
    nine_mobile_signal = Column(String, nullable=False, default='Poor')
    # Highest generation available in this block (e.g., 4G, 3G, 2G)
    max_generation_available = Column(String, nullable=False, default='2G')
    # Composite internet score (0‑100)
    internet_score = Column(Integer, nullable=False, default=30)

    def __repr__(self):
        return f"<H3StagingInternet({self.h3_index})>"


# -----------------------------------------------------------------------------
# Helper: convert lat/lon to H3 Resolution 9 hexagon ID
# -----------------------------------------------------------------------------
def latlng_to_h3_res9(lat, lng):
    try:
        return h3.geo_to_h3(lat, lng, 9)
    except AttributeError:
        return h3.latlng_to_cell(lat, lng, 9)

# -----------------------------------------------------------------------------
# Main loader – reads raw OpenCellID CSV, aggregates, and writes to Neon DB
# -----------------------------------------------------------------------------
def run_loader(input_file: str, db_url: str):
    print("=== Starting Refactored OpenCellID Loader ===")
    print(f"Input file: {input_file}")

    # ---------------------------------------------------------------------
    # 1️⃣ Load CSV – no header, keep everything as string for safe processing
    # ---------------------------------------------------------------------
    try:
        df = pd.read_csv(input_file, header=None, dtype=str)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    # ---------------------------------------------------------------------
    # 2️⃣ Filter to Lagos region and MCC 621 (Nigeria)
    #    Expected column indexes:
    #    0 = radio, 1 = mcc, 2 = mnc, 6 = lon, 7 = lat
    # ---------------------------------------------------------------------
    try:
        df = df[(df[1] == "621")]
        df = df[(df[7].astype(float).between(6.35, 6.70)) & (df[6].astype(float).between(3.10, 3.60))]
    except Exception as e:
        print(f"Error during Lagos/MCC filtering: {e}")
        return

    if df.empty:
        print("No rows match Lagos boundaries – exiting.")
        return

    # ---------------------------------------------------------------------
    # 3️⃣ Compute H3 index for each row (Resolution 9 ≈ 100 m)
    # ---------------------------------------------------------------------
    def compute_h3(row):
        try:
            lat = float(row[7])
            lng = float(row[6])
            return latlng_to_h3_res9(lat, lng)
        except Exception:
            return None

    df['h3_index'] = df.apply(compute_h3, axis=1)
    df = df.dropna(subset=['h3_index'])

    # ---------------------------------------------------------------------
    # 4️⃣ Aggregate towers per H3 block – keep best signal per carrier
    # ---------------------------------------------------------------------
    signal_rank = {"Excellent": 3, "Good": 2, "Poor": 1}
    gen_map = {"LTE": "4G", "UMTS": "3G", "GSM": "2G"}

    agg_dict = {}
    for _, row in df.iterrows():
        h3_idx = row['h3_index']
        # Clean and normalize values
        mnc_raw = row[2]
        mnc = int(float(mnc_raw)) if pd.notnull(mnc_raw) else 0
        radio_raw = row[0]
        radio = str(radio_raw).upper().strip() if pd.notnull(radio_raw) else ""

        # Ensure entry exists with all carriers
        entry = agg_dict.setdefault(h3_idx, {
            "mtn_signal": "Poor",
            "airtel_signal": "Poor",
            "glo_signal": "Poor",
            "nine_mobile_signal": "Poor",
            "max_generation_available": "2G",
        })

        # Determine signal tier and generation
        if "LTE" in radio:
            current_tier = "Excellent"
            generation = "4G"
        elif "UMTS" in radio or "WCDMA" in radio:
            current_tier = "Good"
            generation = "3G"
        else:
            current_tier = "Poor"
            generation = "2G"

        # Map carrier tokens accurately (20=Airtel, 60=9mobile, 50=Glo, 30=Mtn)
        if mnc == 20:
            carrier_key = "airtel_signal"
        elif mnc == 60:
            carrier_key = "nine_mobile_signal"
        elif mnc == 50:
            carrier_key = "glo_signal"
        elif mnc == 30:
            carrier_key = "mtn_signal"
        else:
            carrier_key = None

        if carrier_key:
            # Keep the best signal for the carrier
            if signal_rank[current_tier] > signal_rank[entry[carrier_key]]:
                entry[carrier_key] = current_tier

        # Update max generation if higher
        gen_rank = {"2G": 1, "3G": 2, "4G": 3}
        if gen_rank[generation] > gen_rank[entry["max_generation_available"]]:
            entry["max_generation_available"] = generation

    # ---------------------------------------------------------------------
    # 5️⃣ Compute internet_score per aggregated block
    # ---------------------------------------------------------------------
    for entry in agg_dict.values():
        if "Excellent" in (entry["mtn_signal"], entry["airtel_signal"], entry["glo_signal"]):
            entry["internet_score"] = 85
        elif "Good" in (entry["mtn_signal"], entry["airtel_signal"], entry["glo_signal"]):
            entry["internet_score"] = 65
        else:
            entry["internet_score"] = 30

    # ---------------------------------------------------------------------
    # 6️⃣ Recreate clean database table (drop old, create new)
    # ---------------------------------------------------------------------
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS h3_staging_internet"))
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # ---------------------------------------------------------------------
    # 7️⃣ Bulk insert aggregated rows
    # ---------------------------------------------------------------------
    objects = []
    for h3_idx, data in agg_dict.items():
        obj = H3StagingInternet(
            h3_index=h3_idx,
            mtn_signal=data.get("mtn_signal", "Poor"),
            airtel_signal=data.get("airtel_signal", "Poor"),
            glo_signal=data.get("glo_signal", "Poor"),
            max_generation_available=data.get("max_generation_available", "2G"),
            internet_score=data.get("internet_score", 30),
        )
        objects.append(obj)

    try:
        session.bulk_save_objects(objects)
        session.commit()
        print(f"Aggregated insert complete – {len(objects)} H3 rows written.")
    except Exception as e:
        session.rollback()
        print(f"Error during bulk insert: {e}")
    finally:
        session.close()

# -----------------------------------------------------------------------------
# CLI entry point
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load and aggregate OpenCellID data into Neon DB")
    parser.add_argument("--input", required=True, help="Path to raw OpenCellID CSV file (no header)")
    parser.add_argument("--db-url", default=None, help="Database URL (fallback to DATABASE_URL env var)")
    args = parser.parse_args()
    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("Database URL not provided – set DATABASE_URL env or pass --db-url")
        sys.exit(1)
    run_loader(args.input, db_url)
