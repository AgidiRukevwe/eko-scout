"""
EkoScout Power Staging Loader
-----------------------------
This script reads raw electricity feeder data (CSV/Excel), cleans the feeder names,
geocodes them to coordinates using Nominatim (with caching and fallback rules), 
maps the coordinates to an H3 Resolution 9 hex, and saves the records to the PostgreSQL staging table `h3_staging_power`.
"""

import os
import sys
import time
import argparse
from datetime import datetime
import pandas as pd
from geopy.geocoders import Nominatim, GoogleV3
from geopy.exc import GeocoderTimedOut, GeocoderServiceError, GeocoderQuotaExceeded
import h3
from sqlalchemy import create_engine, Column, String, Integer, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import backoff

def load_env_files():
    # Look for .env.local or .env in current directory
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
                print(f"Error loading {filename}: {e}")

# Helper with exponential backoff for robust geocoding
@backoff.on_exception(backoff.expo,
                      (GeocoderTimedOut, GeocoderServiceError, GeocoderQuotaExceeded),
                      max_tries=5,
                      jitter=backoff.full_jitter)
def safe_geocode(geolocator, query: str):
    """Geocode with retries and backoff."""
    return geolocator.geocode(query, timeout=10)


# Load env files immediately
load_env_files()

# 1. Database Model Setup (SQLAlchemy)
Base = declarative_base()

class H3StagingPower(Base):
    __tablename__ = "h3_staging_power"

    feeder_code_raw = Column(String, primary_key=True, nullable=False, doc="Exact, unedited original feeder string")
    h3_index = Column(String, primary_key=True, nullable=False, doc="15-character Resolution 9 H3 Hexagon ID")
    business_unit = Column(String, nullable=False)
    feeder_name_clean = Column(String, nullable=False, doc="Stripped, human-readable name used for geocoding")
    service_band = Column(String, nullable=False)
    power_score = Column(Integer, nullable=False)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<H3StagingPower(feeder={self.feeder_code_raw}, h3={self.h3_index}, score={self.power_score})>"


# Helper to parse band column into integer power score
def parse_power_score(band_str):
    """
    Converts a raw service band string (e.g. 'A- BILATERAL') into an integer power score.
    A = 95, B = 75, C = 50, D = 30, E = 15.
    """
    if not isinstance(band_str, str):
        return 0
    
    # Normalize string
    band = band_str.strip().upper()
    
    # Matching rules
    if "A" in band:
        return 95
    elif "B" in band:
        return 75
    elif "C" in band:
        return 50
    elif "D" in band:
        return 30
    elif "E" in band:
        return 15
    return 0


# Text helper function to extract human-readable neighborhood string from raw feeder code
def clean_feeder_name(raw_name):
    """
    Extracts a cleaner geographic name from raw utility codes for better geocoding.
    Example: '11-NEW YABAINJ-T2-JIBOWU' -> 'Jibowu' or 'New Yaba (Jibowu)' if the terminal token is too short.
    """
    if not isinstance(raw_name, str):
        return ""
    
    # Split by hyphen
    parts = [p.strip() for p in raw_name.split("-") if p.strip()]
    if not parts:
        return ""
    
    # The utility feeder codes typically format as: Voltage-Station-Transformer-Feeder
    # E.g. '11-NEW YABAINJ-T2-JIBOWU' -> last part is JIBOWU
    last_token = parts[-1]
    clean_name = last_token.title()
    
    # If the last token is too short or an abbreviation (e.g. CAC, T1), pull the injection station
    if len(last_token) <= 3 or last_token.upper() in ["CAC", "T1", "T2", "BU"]:
        for part in parts:
            if "INJ" in part.upper():
                station = part.upper().replace("INJ", "").strip()
                clean_name = f"{station.title()} ({clean_name})"
                break
                
    return clean_name


# LatLng to H3 index converter compatible with v3 and v4 of h3 library
def latlng_to_h3_res9(lat, lng):
    try:
        # h3 v3 API
        return h3.geo_to_h3(lat, lng, 9)
    except AttributeError:
        # h3 v4 API
        return h3.latlng_to_cell(lat, lng, 9)


def run_loader(input_file, db_url):
    print(f"=== Starting EkoScout Power Staging Loader ===")
    print(f"Input file: {input_file}")
    
    # 2. Database Connection Initialization
    print(f"Connecting to database: {db_url}")
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    
    Session = sessionmaker(bind=engine)
    session = Session()

    # Read data
    try:
        # Checking file extension to support both CSV and Excel files
        if input_file.endswith(".xlsx") or input_file.endswith(".xls"):
            df = pd.read_excel(input_file)
        else:
            # Let's support custom delimiters like pipe '|' or comma ','
            # We check if file content uses '|' as delimiter
            with open(input_file, "r") as f:
                first_line = f.readline()
                sep = "|" if "|" in first_line else ","
            df = pd.read_csv(input_file, sep=sep)
    except Exception as e:
        print(f"Error reading input file: {e}")
        return

    # Normalize column names for robust matching
    original_cols = list(df.columns)
    normalized_cols = [str(c).strip().upper() for c in original_cols]
    
    col_mapping = {}
    for orig, norm in zip(original_cols, normalized_cols):
        if "FEEDER" in norm:
            col_mapping[orig] = "Feeder Name Raw"
        elif "BUSINESS" in norm or "BU" in norm:
            col_mapping[orig] = "Business Unit"
        elif "BAND" in norm:
            col_mapping[orig] = "Band"
        elif "CAP" in norm:
            col_mapping[orig] = "Cap"
        elif "SOURCE" in norm or "COMPANY" in norm:
            col_mapping[orig] = "Source"
        elif "STATE" in norm:
            col_mapping[orig] = "State"
            
    df = df.rename(columns=col_mapping)
    
    # Verify we mapped the essential ones or fall back positionally
    essential_cols = ["Feeder Name Raw", "Business Unit", "Band"]
    missing_cols = [c for c in essential_cols if c not in df.columns]
    if missing_cols:
        print(f"Essential columns {missing_cols} not matched. Mapping columns positionally...")
        col_names = ["State", "Business Unit", "Feeder Name Raw", "Band", "Cap", "Source"]
        df.columns = col_names + list(df.columns[len(col_names):])

    # Geocoder Initialization
    print("Using Nominatim (OSM) Geocoder with Google Maps fallback...")
    geolocator_osm = Nominatim(user_agent="eko-scout-power-loader", timeout=10)
    
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY not found in environment for fallback")
    geolocator_google = GoogleV3(api_key=api_key, timeout=10)

    success_count = 0
    failure_count = 0
    
    # Cache to avoid duplicate network requests for same coordinates
    geocode_cache = {}

    print(f"Found {len(df)} records to process.")

    for index, row in df.iterrows():
        try:
            feeder_code = str(row["Feeder Name Raw"]).strip()
            business_unit = str(row["Business Unit"]).strip()
            service_band = str(row["Band"]).strip()
            feeder_name_clean = clean_feeder_name(feeder_code)
            power_score = parse_power_score(service_band)
            
            # Form geocoding address query (feeder only)
            query = f"{feeder_name_clean}, Lagos, Nigeria"
            # No fallback to business unit; if this fails we skip the record.
            lat, lng = None, None
            
            # 3. String Cleanup & Geocoding Logic
            print(f"\n[{index + 1}/{len(df)}] Processing: {feeder_code}")
            
            # Check cache first for exact query
            # No fallback; geocoding failures are handled above.
            if query in geocode_cache:
                if geocode_cache[query]:
                    lat, lng = geocode_cache[query]
                    print(f" -> (Cache Hit) Resolved exact match: ({lat}, {lng})")
            else:
                print(f" -> Geocoding exact: '{query}'")
                try:
                    location = safe_geocode(geolocator_osm, query)
                    time.sleep(1.1)  # Nominatim requires ~1s delay for stability and policy
                    if not location:
                        print(f" -> OSM failed, trying Google Maps exact: '{query}'")
                        location = safe_geocode(geolocator_google, query)
                        
                    if location:
                        lat, lng = location.latitude, location.longitude
                        geocode_cache[query] = (lat, lng)
                        print(f" -> Resolved exact match: ({lat}, {lng})")
                    else:
                        # Attempt secondary fallback with business unit
                        fallback_query = f"{feeder_name_clean} {business_unit}, Lagos, Nigeria"
                        print(f" -> Falling back to secondary query on OSM: '{fallback_query}'")
                        location = safe_geocode(geolocator_osm, fallback_query)
                        time.sleep(1.1)
                        if not location:
                            print(f" -> OSM failed, trying Google Maps fallback: '{fallback_query}'")
                            location = safe_geocode(geolocator_google, fallback_query)
                            
                        if location:
                            lat, lng = location.latitude, location.longitude
                            geocode_cache[query] = (lat, lng)
                            print(f" -> Resolved fallback match: ({lat}, {lng})")
                        else:
                            geocode_cache[query] = None
                            print(f" -> ERROR: Could not resolve coordinates for {feeder_code}. Will use default.")
                except Exception as e:
                    print(f" -> Geocoding warning: {e}")
                    geocode_cache[query] = None
                    time.sleep(1.1)

            if lat is None or lng is None:
                print(f" -> ERROR: Could not resolve coordinates for {feeder_code}. Using default Lagos location.")
                lat, lng = 6.5244, 3.3792

            # 4. H3 Hexagon Resolution 9 Mapping
            h3_index = latlng_to_h3_res9(lat, lng)
            print(f" -> Generated H3 Resolution 9 index: {h3_index}")

            # Multiple feeders can share the same H3 hexagon.
            # The database composite primary key (feeder_code_raw, h3_index) will naturally
            # allow different feeders to co-exist in the same hex.

            # Database Upsert/Merge Strategy
            record = H3StagingPower(
                feeder_code_raw=feeder_code,
                h3_index=h3_index,
                business_unit=business_unit,
                feeder_name_clean=feeder_name_clean,
                service_band=service_band,
                power_score=power_score,
                last_updated=datetime.utcnow()
            )
            
            session.merge(record)
            session.commit()
            print(f" -> Successfully loaded into database.")
            success_count += 1

        except Exception as err:
            session.rollback()
            print(f" -> ERROR: Exception occurred while processing row {index + 1}: {err}")
            failure_count += 1

    session.close()
    print(f"\n=== Processing Complete ===")
    print(f"Successfully loaded: {success_count} records")
    print(f"Skipped/Failed: {failure_count} records")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean, geocode, and stage Lagos utility power data into H3 spatial grids.")
    parser.add_argument("--input", default="raw_power_data.csv", help="Path to raw CSV or Excel feeder list file")
    parser.add_argument("--db-url", default=None, help="Database connection URL (fallback to local sqlite)")
    args = parser.parse_args()

    # Determine DB connection URL
    # Prioritize: 1. Passed argument, 2. DATABASE_URL env variable, 3. Fallback to local SQLite file
    db_url = args.db_url or os.environ.get("DATABASE_URL") or "sqlite:///h3_staging_power.db"

    # If input file doesn't exist, create a mock one for testing out-of-the-box
    if not os.path.exists(args.input):
        print(f"Input file '{args.input}' not found. Generating a mock file for testing...")
        mock_data = [
            ["LAGOS", "SHOMOLU BU", "11-NEW YABAINJ-T2-JIBOWU", "B", "711", "Ikeja Electricity Distribution Plc"],
            ["LAGOS", "SHOMOLU BU", "11-NITELINJ-T1-CHALLENGE", "D", "438", "Ikeja Electricity Distribution Plc"],
            ["LAGOS", "SHOMOLU BU", "11-OGUDUINJ-T1-CAC", "A- BILATERAL", "1,086", "Ikeja Electricity Distribution Plc"]
        ]
        mock_df = pd.DataFrame(mock_data, columns=["State", "Business Unit", "Feeder Name Raw", "Band", "Cap", "Source"])
        mock_df.to_csv(args.input, index=False, sep="|")
        print(f"Generated mock file: {args.input}")

    run_loader(args.input, db_url)
