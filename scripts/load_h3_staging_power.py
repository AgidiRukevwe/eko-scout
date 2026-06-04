import os
import csv
import time
import logging
from dotenv import load_dotenv
from pathlib import Path
from typing import Tuple, Optional, Dict

# Load environment variables from .env (project root or .env.local)
load_dotenv()


import requests
# Import h3 cell conversion function with fallback for library versions
try:
    from h3 import latlng_to_cell
except ImportError:
    # Older versions expose geo_to_h3; alias it for compatibility
    from h3 import geo_to_h3 as latlng_to_cell
from sqlalchemy import create_engine, Column, String, Integer, DateTime, text, PrimaryKeyConstraint
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# CSV input path – update if needed
CSV_PATH = Path(__file__).resolve().parents[1] / "src" / "lib" / "csv files" / "eletricity_supply_data.csv"

# Database URL – can be passed via env var DATABASE_URL or edited here
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable not set. Ensure .env contains DATABASE_URL or set the env var.")

# User‑Agent for Nominatim (required by OSM policy)
NOMINATIM_USER_AGENT = "eko-scout-data-loader/1.0 (+https://github.com/yourorg/eko-scout)"

# Google Maps API key (optional – used as fallback)
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

# H3 resolution (≈100 m)
H3_RESOLUTION = 9

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# SQLAlchemy model – matches h3_staging_power table definition
# ---------------------------------------------------------------------------
Base = declarative_base()

class H3StagingPower(Base):
    __tablename__ = "h3_staging_power"
    feeder_code_raw = Column(String, nullable=False)
    h3_index = Column(String, nullable=False)
    business_unit = Column(String, nullable=False)
    feeder_name_clean = Column(String, nullable=False)
    service_band = Column(String, nullable=False)
    power_score = Column(Integer, nullable=False)
    last_updated = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        PrimaryKeyConstraint("feeder_code_raw", "h3_index", name="h3_staging_power_pkey"),
    )

    def __repr__(self):
        return f"<H3StagingPower {self.feeder_code_raw}-{self.h3_index}>"

# ---------------------------------------------------------------------------
# Helper: clean feeder name (words after the dash)
# ---------------------------------------------------------------------------
def extract_clean_name(feeder_name: str) -> str:
    """Return the substring after the last dash, stripped of whitespace.
    Example: "ABULE IROKOINJ-T1-ABULE IROKO" -> "ABULE IROKO".
    """
    parts = feeder_name.rsplit("-", 1)
    return parts[1].strip() if len(parts) == 2 else feeder_name.strip()

# ---------------------------------------------------------------------------
# Geocoding utilities
# ---------------------------------------------------------------------------
def geocode_osm(query: str) -> Optional[Tuple[float, float]]:
    """Use OSM Nominatim to obtain (lat, lon). Returns None on failure.
    Rate‑limited to 1 request per second as per policy.
    """
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": f"{query}, Lagos, Nigeria",
        "format": "json",
        "limit": 5,
    }
    headers = {"User-Agent": NOMINATIM_USER_AGENT}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if not data:
            return None
        # Choose the first result – Nominatim orders by relevance
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        return lat, lon
    except Exception as e:
        logger.debug(f"OSM geocode error for '{query}': {e}")
        return None

def geocode_google(query: str) -> Optional[Tuple[float, float]]:
    """Fallback to Google Maps Geocoding API (requires API key).
    Returns None if key missing or request fails.
    """
    if not GOOGLE_MAPS_API_KEY:
        logger.debug("Google Maps API key not set; skipping fallback.")
        return None
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {
        "address": f"{query}, Lagos, Nigeria",
        "key": GOOGLE_MAPS_API_KEY,
    }
    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "OK" or not data.get("results"):
            return None
        location = data["results"][0]["geometry"]["location"]
        return location["lat"], location["lng"]
    except Exception as e:
        logger.debug(f"Google geocode error for '{query}': {e}")
        return None

def geocode_location(name: str) -> Optional[Tuple[float, float]]:
    """Try OSM first, then Google Maps as fallback."""
    result = geocode_osm(name)
    if result:
        return result
    return geocode_google(name)

# ---------------------------------------------------------------------------
# Core loading logic
# ---------------------------------------------------------------------------
def load_csv_and_prepare() -> list:
    """Read the CSV, clean feeder names, and resolve coordinates.
    Returns a list of dicts ready for DB insertion.
    """
    records = []
    cache: Dict[str, Tuple[float, float]] = {}
    with open(CSV_PATH, newline="", encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            feeder_name_raw = row.get("FEEDER NAME")
            business_unit = row.get("BUSINESS UNIT") or ""
            service_band = row.get("NON-MD SERVICE BAND") or ""
            power_score_raw = row.get("CAP (kWh)") or "0"
            power_score = int(power_score_raw.replace(",", "")) if power_score_raw.replace(",", "").isdigit() else 0

            if not feeder_name_raw:
                logger.warning("Missing FEEDER NAME; skipping row.")
                continue

            feeder_name_clean = extract_clean_name(feeder_name_raw)

            # Use the full feeder name as the raw code
            feeder_code_raw = feeder_name_raw

            # Resolve location (cache by clean name to avoid duplicate API calls)
            if feeder_name_clean in cache:
                lat_lon = cache[feeder_name_clean]
            else:
                # Respect OSM usage policy: at most 1 request per second
                lat_lon = geocode_location(feeder_name_clean)
                cache[feeder_name_clean] = lat_lon
                if lat_lon:
                    time.sleep(1)

            if not lat_lon:
                logger.warning(f"Could not geocode '{feeder_name_clean}'; using default Lagos location.")
                # Default coordinates for Lagos, Nigeria
                lat_lon = (6.5244, 3.3792)

            h3_index = latlng_to_cell(lat_lon[0], lat_lon[1], H3_RESOLUTION)

            records.append(
                {
                    "feeder_code_raw": feeder_code_raw,
                    "h3_index": str(h3_index),
                    "business_unit": business_unit,
                    "feeder_name_clean": feeder_name_clean,
                    "service_band": service_band,
                    "power_score": power_score,
                }
            )
    return records

def bulk_insert(records: list):
    engine = create_engine(DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        objects = [
            H3StagingPower(**rec) for rec in records
        ]
        session.bulk_save_objects(objects)
        session.commit()
        logger.info(f"Inserted {len(objects)} rows into h3_staging_power.")
    except Exception as e:
        session.rollback()
        logger.error(f"Database insert failed: {e}")
    finally:
        session.close()

def main():
    logger.info("Starting load into h3_staging_power...")
    records = load_csv_and_prepare()
    if records:
        bulk_insert(records)
    else:
        logger.info("No records to insert.")

if __name__ == "__main__":
    main()
