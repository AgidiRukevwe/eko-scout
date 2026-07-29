"""
EkoScout OSM Area Scraper
--------------------------
Fetches POIs, buildings, and roads from the Overpass API for a named Lagos LGA,
inserts them into the production database, and logs the run to coverage_registry.

Usage:
    python scripts/scrape_osm_area.py --area "Lagos Mainland"
    python scripts/scrape_osm_area.py --area "Ikeja"
    python scripts/scrape_osm_area.py --area "Eti-Osa"

Design:
    - POIs: Upserted permanently (ON CONFLICT DO UPDATE). Named amenities have user-facing value.
    - Buildings: Inserted as staging data (ON CONFLICT DO NOTHING). 
      Run aggregate_features.sql after this script — it will TRUNCATE osm_buildings when done.
    - Roads: Upserted permanently (ON CONFLICT DO NOTHING).
    - All coordinates are validated against the Lagos land bounding box before H3 assignment.
"""

import os
import sys
import json
import time
import argparse

import requests
import h3
import psycopg2

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from src.core.db import get_connection, release_connection

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Lagos land bounding box — excludes lagoon, ocean, and areas outside Lagos state.
# Coordinates are deliberately conservative to avoid clipping mainland fringe areas.
LAGOS_BBOX = {
    "lat_min": 6.35,
    "lat_max": 6.70,
    "lng_min": 3.05,
    "lng_max": 3.75,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_within_lagos(lat: float, lng: float) -> bool:
    """Return True if the coordinate falls within the Lagos land bounding box."""
    return (
        LAGOS_BBOX["lat_min"] <= lat <= LAGOS_BBOX["lat_max"]
        and LAGOS_BBOX["lng_min"] <= lng <= LAGOS_BBOX["lng_max"]
    )


def latlng_to_h3(lat: float, lng: float, resolution: int = 9) -> str:
    """Convert lat/lng to H3 index, compatible with h3-py v3 and v4."""
    try:
        return h3.geo_to_h3(lat, lng, resolution)
    except AttributeError:
        return h3.latlng_to_cell(lat, lng, resolution)


def get_connection_retry(max_tries: int = 3, delay: int = 2):
    """Attempt to get a DB connection, retrying on failure."""
    for attempt in range(1, max_tries + 1):
        conn = get_connection()
        if conn:
            return conn
        print(f"DB connection attempt {attempt} failed, retrying in {delay}s…")
        time.sleep(delay)
    raise psycopg2.OperationalError("Unable to obtain DB connection after retries")


def run_overpass_query(query_str: str) -> dict | None:
    """Execute an Overpass QL query and return the parsed JSON response."""
    print("Executing Overpass query… (this may take a few minutes)")
    try:
        response = requests.post(
            OVERPASS_URL,
            data=query_str.encode("utf-8"),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "eko-scout-app/1.0",
                "Accept": "*/*",
            },
            timeout=300,
        )
        if response.status_code == 200:
            return response.json()
        print(f"Overpass API returned {response.status_code}: {response.text[:200]}")
        return None
    except Exception as e:
        print(f"Request failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Overpass fetch functions
# ---------------------------------------------------------------------------

def fetch_pois(area_name: str) -> dict | None:
    query = f"""
    [out:json][timeout:90];
    area["name"="{area_name}"]->.searchArea;
    (
      node["amenity"](area.searchArea);
      node["shop"](area.searchArea);
      node["office"](area.searchArea);
      node["leisure"](area.searchArea);
      node["healthcare"](area.searchArea);
    );
    out center;
    """
    return run_overpass_query(query)


def fetch_buildings(area_name: str) -> dict | None:
    query = f"""
    [out:json][timeout:180];
    area["name"="{area_name}"]->.searchArea;
    way["building"](area.searchArea);
    out center;
    """
    return run_overpass_query(query)


def fetch_roads(area_name: str) -> dict | None:
    query = f"""
    [out:json][timeout:90];
    area["name"="{area_name}"]->.searchArea;
    way["highway"](area.searchArea);
    out center;
    """
    return run_overpass_query(query)


# ---------------------------------------------------------------------------
# Coverage registry
# ---------------------------------------------------------------------------

def log_coverage(conn, area_name: str, dataset: str, status: str, row_count: int = 0, notes: str = ""):
    """Write a run record to coverage_registry (best-effort, never raises)."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO coverage_registry (area_name, dataset, status, row_count, finished_at, notes)
                VALUES (%s, %s, %s, %s, NOW(), %s)
                """,
                (area_name, dataset, status, row_count, notes),
            )
            conn.commit()
    except Exception as e:
        print(f"[coverage_registry] Could not log run: {e}")


# ---------------------------------------------------------------------------
# Ingestion functions
# ---------------------------------------------------------------------------

def ingest_pois(area_name: str) -> int:
    """Fetch POIs from Overpass and upsert into osm_pois. Returns count inserted."""
    print("\n--- Fetching POIs ---")
    data = fetch_pois(area_name)
    if not data or "elements" not in data:
        print("No POI data returned.")
        return 0

    pois = data["elements"]
    print(f"Found {len(pois)} POI elements. Filtering and inserting…")

    conn = get_connection_retry()
    count = 0
    try:
        with conn.cursor() as cur:
            for p in pois:
                lat = p.get("lat")
                lon = p.get("lon")
                if not lat or not lon:
                    continue
                if not is_within_lagos(lat, lon):
                    continue

                tags = p.get("tags", {})
                name = tags.get("name", "")
                cat = subcat = ""
                for t in ["amenity", "shop", "office", "leisure", "healthcare"]:
                    if t in tags:
                        cat = t
                        subcat = tags[t]
                        break

                h3_r9 = latlng_to_h3(lat, lon, 9)
                h3_r10 = latlng_to_h3(lat, lon, 10)

                cur.execute(
                    """
                    INSERT INTO osm_pois (id, name, category, subcategory, lat, lng, h3_r10, h3_r9, tags_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        category = EXCLUDED.category,
                        subcategory = EXCLUDED.subcategory,
                        tags_json = EXCLUDED.tags_json,
                        updated_at = NOW()
                    """,
                    (p["id"], name[:255], cat[:100], subcat[:100], lat, lon, h3_r10, h3_r9, json.dumps(tags)),
                )
                count += 1

            conn.commit()
    finally:
        release_connection(conn)

    print(f"Inserted/updated {count} POIs.")
    return count


def ingest_buildings(area_name: str) -> int:
    """Fetch buildings from Overpass and insert into osm_buildings staging table. Returns count inserted."""
    print("\n--- Fetching Buildings ---")
    data = fetch_buildings(area_name)
    if not data or "elements" not in data:
        print("No building data returned.")
        return 0

    bldgs = data["elements"]
    print(f"Found {len(bldgs)} building elements. Filtering and inserting in batches…")

    BATCH_SIZE = 5000
    batch = []
    total_inserted = 0

    def flush_batch(records: list) -> int:
        if not records:
            return 0
        conn = get_connection_retry()
        inserted = 0
        try:
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO osm_buildings (id, building_type, lat, lng, area, h3_r10, h3_r9)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    records,
                )
                conn.commit()
                inserted = len(records)
        except Exception as e:
            print(f"Batch insert error: {e}")
            conn.rollback()
        finally:
            release_connection(conn)
        return inserted

    for b in bldgs:
        lat = (b.get("center") or {}).get("lat") or b.get("lat")
        lon = (b.get("center") or {}).get("lon") or b.get("lon")
        if not lat or not lon:
            continue
        if not is_within_lagos(lat, lon):
            continue

        tags = b.get("tags", {})
        btype = tags.get("building", "yes")
        h3_r9 = latlng_to_h3(lat, lon, 9)
        h3_r10 = latlng_to_h3(lat, lon, 10)
        batch.append((b["id"], btype[:100], lat, lon, 0.0, h3_r10, h3_r9))

        if len(batch) >= BATCH_SIZE:
            total_inserted += flush_batch(batch)
            batch.clear()

    total_inserted += flush_batch(batch)
    print(f"Inserted {total_inserted} buildings.")
    return total_inserted


def ingest_roads(area_name: str) -> int:
    """Fetch roads from Overpass and insert into osm_roads. Returns count inserted."""
    print("\n--- Fetching Roads ---")
    time.sleep(2)  # Brief pause between Overpass requests
    data = fetch_roads(area_name)
    if not data or "elements" not in data:
        print("No road data returned.")
        return 0

    roads = data["elements"]
    print(f"Found {len(roads)} road elements. Filtering and inserting…")

    conn = get_connection_retry()
    count = 0
    try:
        with conn.cursor() as cur:
            for r in roads:
                lat = (r.get("center") or {}).get("lat") or r.get("lat")
                lon = (r.get("center") or {}).get("lon") or r.get("lon")
                if not lat or not lon:
                    continue
                if not is_within_lagos(lat, lon):
                    continue

                tags = r.get("tags", {})
                rtype = tags.get("highway", "unknown")
                name = tags.get("name", "")
                h3_r9 = latlng_to_h3(lat, lon, 9)
                h3_r10 = latlng_to_h3(lat, lon, 10)

                cur.execute(
                    """
                    INSERT INTO osm_roads (id, road_type, name, length, lat, lng, h3_r10, h3_r9)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (r["id"], rtype[:100], name[:255], 0.0, lat, lon, h3_r10, h3_r9),
                )
                count += 1

            conn.commit()
    finally:
        release_connection(conn)

    print(f"Inserted {count} roads.")
    return count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_and_insert(area_name: str):
    print(f"\n=== EkoScout OSM Scraper: {area_name} ===\n")

    reg_conn = get_connection_retry()

    try:
        poi_count = ingest_pois(area_name)
        log_coverage(reg_conn, area_name, "osm_pois", "complete", poi_count)
    except Exception as e:
        print(f"POI ingestion failed: {e}")
        log_coverage(reg_conn, area_name, "osm_pois", "failed", notes=str(e))

    try:
        bldg_count = ingest_buildings(area_name)
        log_coverage(reg_conn, area_name, "osm_buildings", "complete", bldg_count)
    except Exception as e:
        print(f"Building ingestion failed: {e}")
        log_coverage(reg_conn, area_name, "osm_buildings", "failed", notes=str(e))

    try:
        road_count = ingest_roads(area_name)
        log_coverage(reg_conn, area_name, "osm_roads", "complete", road_count)
    except Exception as e:
        print(f"Road ingestion failed: {e}")
        log_coverage(reg_conn, area_name, "osm_roads", "failed", notes=str(e))

    release_connection(reg_conn)
    print("\n=== Ingestion complete. Run aggregate_features.sql to update h3_r9_features. ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape OSM data for a Lagos LGA and insert into the database."
    )
    parser.add_argument(
        "--area",
        default="Lagos Mainland",
        help='OSM area name to query, e.g. "Ikeja", "Eti-Osa", "Lagos Mainland" (default)',
    )
    args = parser.parse_args()
    process_and_insert(args.area)
