"""
EkoScout OSM Area Scraper
--------------------------
Fetches POIs, buildings, and roads from the Overpass API for a named Lagos LGA,
inserts them into the production database, and logs the run to coverage_registry.

Usage:
    python scripts/scrape_osm_area.py --area "Lagos"
    python scripts/scrape_osm_area.py --area "Ikeja" --skip-pois
"""

import os
import sys
import json
import time
import argparse

import requests
import h3
import psycopg2

# Local utilities for chunking and retry logic
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from src.core.db import get_connection, release_connection, get_fresh_connection
from scripts.utils import chunk_bbox, retry_async, count_rows_in_bbox

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Lagos land bounding box — excludes lagoon, ocean, and areas outside Lagos state.
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

def get_fresh_connection_retry(max_tries: int = 10, delay: int = 5):
    """Attempt to get a fresh DB connection, retrying on network/DNS failure."""
    for attempt in range(1, max_tries + 1):
        try:
            return get_fresh_connection()
        except Exception as e:
            if attempt == max_tries:
                raise psycopg2.OperationalError(f"Unable to obtain fresh DB connection after retries: {e}")
            print(f"Fresh DB connection attempt {attempt} failed ({e}), retrying in {delay}s…")
            time.sleep(delay)

def _do_overpass_request(query_str: str) -> dict:
    response = requests.post(
        OVERPASS_URL,
        data=query_str.encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "eko-scout-app/1.0",
            "Accept": "*/*",
        },
        timeout=600,
    )
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Overpass API returned {response.status_code}: {response.text[:200]}")
        raise RuntimeError(f"Overpass HTTP {response.status_code}")

def run_overpass_query(query_str: str) -> dict | None:
    """Execute an Overpass QL query with retries and return the parsed JSON response."""
    print("Executing Overpass query… (this may take a few minutes)")
    try:
        return retry_async(_do_overpass_request, query_str, retries=5, backoff=2)
    except Exception as e:
        print(f"All retry attempts failed for Overpass query: {e}")
        return None

# ---------------------------------------------------------------------------
# Overpass fetch functions
# ---------------------------------------------------------------------------

def fetch_pois(area_name: str, bbox: dict = None) -> dict | None:
    bbox_str = f"({bbox['lat_min']},{bbox['lng_min']},{bbox['lat_max']},{bbox['lng_max']})" if bbox else ""
    query = f"""
    [out:json][timeout:180];
    area["name"="{area_name}"]->.searchArea;
    (
      nwr["amenity"](area.searchArea){bbox_str};
      nwr["shop"](area.searchArea){bbox_str};
      nwr["office"](area.searchArea){bbox_str};
      nwr["leisure"](area.searchArea){bbox_str};
      nwr["healthcare"](area.searchArea){bbox_str};
    );
    out center;
    """
    return run_overpass_query(query)

def fetch_buildings(area_name: str, bbox: dict = None) -> dict | None:
    bbox_str = f"({bbox['lat_min']},{bbox['lng_min']},{bbox['lat_max']},{bbox['lng_max']})" if bbox else ""
    query = f"""
    [out:json][timeout:180];
    area["name"="{area_name}"]->.searchArea;
    way["building"](area.searchArea){bbox_str};
    out center;
    """
    return run_overpass_query(query)

def fetch_roads(area_name: str, bbox: dict = None) -> dict | None:
    bbox_str = f"({bbox['lat_min']},{bbox['lng_min']},{bbox['lat_max']},{bbox['lng_max']})" if bbox else ""
    query = f"""
    [out:json][timeout:90];
    area["name"="{area_name}"]->.searchArea;
    way["highway"](area.searchArea){bbox_str};
    out center;
    """
    return run_overpass_query(query)

# ---------------------------------------------------------------------------
# Coverage registry
# ---------------------------------------------------------------------------

def log_coverage(area_name: str, dataset: str, status: str, row_count: int = 0, notes: str = ""):
    """Write a run record to coverage_registry using a fresh connection (best-effort)."""
    try:
        conn = get_fresh_connection_retry()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO coverage_registry (area_name, dataset, status, row_count, finished_at, notes)
                VALUES (%s, %s, %s, %s, NOW(), %s)
                """,
                (area_name, dataset, status, row_count, notes),
            )
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"[coverage_registry] Could not log run: {e}")

# ---------------------------------------------------------------------------
# Ingestion functions
# ---------------------------------------------------------------------------

def ingest_pois(area_name: str) -> int:
    print("\n--- Fetching POIs ---")
    tiles = chunk_bbox(LAGOS_BBOX, 0.1)
    total_count = 0
    
    for i, tile in enumerate(tiles, 1):
        print(f"\nPOIs chunk {i}/{len(tiles)}...")
        
        # Idempotency check removed for POIs to force a full re-fetch of polygons
        conn = get_fresh_connection_retry()
        existing = count_rows_in_bbox(conn, "osm_pois", tile)
        conn.close()
            
        data = fetch_pois(area_name, tile)
        if not data or "elements" not in data:
            continue
            
        pois = data["elements"]
        conn = get_fresh_connection_retry()
        try:
            with conn.cursor() as cur:
                for p in pois:
                    lat = (p.get("center") or {}).get("lat") or p.get("lat")
                    lon = (p.get("center") or {}).get("lon") or p.get("lon")
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
                    total_count += 1
                conn.commit()
        finally:
            conn.close()

    print(f"Inserted/updated {total_count} POIs.")
    return total_count


def ingest_buildings(area_name: str) -> int:
    print("\n--- Fetching Buildings ---")
    tiles = chunk_bbox(LAGOS_BBOX, 0.1)
    total_inserted = 0
    BATCH_SIZE = 5000

    def flush_batch(records: list) -> int:
        if not records:
            return 0
        conn = get_fresh_connection_retry()
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
        finally:
            conn.close()
        return inserted

    for i, tile in enumerate(tiles, 1):
        print(f"\nBuildings chunk {i}/{len(tiles)}...")
        
        # Idempotency check
        conn = get_fresh_connection_retry()
        existing = count_rows_in_bbox(conn, "osm_buildings", tile)
        conn.close()
        
        if existing > 1000:
            print(f"Skipping chunk {i}: {existing} buildings already in DB.")
            continue
            
        data = fetch_buildings(area_name, tile)
        if not data or "elements" not in data:
            continue
            
        bldgs = data["elements"]
        batch = []
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
    print("\n--- Fetching Roads ---")
    tiles = chunk_bbox(LAGOS_BBOX, 0.1)
    total_count = 0
    
    for i, tile in enumerate(tiles, 1):
        print(f"\nRoads chunk {i}/{len(tiles)}...")
        
        # Idempotency check
        conn = get_fresh_connection_retry()
        existing = count_rows_in_bbox(conn, "osm_roads", tile)
        conn.close()
        
        if existing > 100:
            print(f"Skipping chunk {i}: {existing} roads already in DB.")
            continue
            
        time.sleep(2)  # Brief pause between Overpass requests
        data = fetch_roads(area_name, tile)
        if not data or "elements" not in data:
            continue
            
        roads = data["elements"]
        conn = get_fresh_connection_retry()
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
                    total_count += 1
                conn.commit()
        finally:
            conn.close()

    print(f"Inserted {total_count} roads.")
    return total_count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_and_insert(area_name: str, skip_pois: bool, skip_buildings: bool, skip_roads: bool):
    print(f"\n=== EkoScout OSM Scraper: {area_name} ===\n")

    if not skip_pois:
        try:
            poi_count = ingest_pois(area_name)
            log_coverage(area_name, "osm_pois", "complete", poi_count)
        except Exception as e:
            print(f"POI ingestion failed: {e}")
            log_coverage(area_name, "osm_pois", "failed", notes=str(e))

    if not skip_buildings:
        try:
            bldg_count = ingest_buildings(area_name)
            log_coverage(area_name, "osm_buildings", "complete", bldg_count)
        except Exception as e:
            print(f"Building ingestion failed: {e}")
            log_coverage(area_name, "osm_buildings", "failed", notes=str(e))

    if not skip_roads:
        try:
            road_count = ingest_roads(area_name)
            log_coverage(area_name, "osm_roads", "complete", road_count)
        except Exception as e:
            print(f"Road ingestion failed: {e}")
            log_coverage(area_name, "osm_roads", "failed", notes=str(e))

    print("\n=== Ingestion complete. Run aggregate_features.sql to update h3_r9_features. ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape OSM data for a Lagos LGA and insert into the database."
    )
    parser.add_argument(
        "--area",
        default="Lagos",
        help='OSM area name to query, e.g. "Ikeja", "Eti-Osa", "Lagos" (default)',
    )
    parser.add_argument("--skip-pois", action="store_true")
    parser.add_argument("--skip-buildings", action="store_true")
    parser.add_argument("--skip-roads", action="store_true")
    
    args = parser.parse_args()
    process_and_insert(args.area, args.skip_pois, args.skip_buildings, args.skip_roads)
