# Utility helpers for the OSM scraper

import time
from typing import List, Dict, Any


def chunk_bbox(bbox: Dict[str, float], size: float) -> List[Dict[str, float]]:
    """Split a bounding box into a grid of sub‑boxes.

    Args:
        bbox: dict with keys 'lat_min', 'lat_max', 'lng_min', 'lng_max'.
        size: approximate side length (in decimal degrees) for each tile.

    Returns:
        List of sub‑bbox dictionaries with the same keys.
    """
    lat_min, lat_max = bbox["lat_min"], bbox["lat_max"]
    lng_min, lng_max = bbox["lng_min"], bbox["lng_max"]
    tiles: List[Dict[str, float]] = []
    lat = lat_min
    while lat < lat_max:
        next_lat = min(lat + size, lat_max)
        lng = lng_min
        while lng < lng_max:
            next_lng = min(lng + size, lng_max)
            tiles.append({
                "lat_min": lat,
                "lat_max": next_lat,
                "lng_min": lng,
                "lng_max": next_lng,
            })
            lng = next_lng
        lat = next_lat
    return tiles


def retry_async(func, *args, retries: int = 5, backoff: int = 2, **kwargs):
    """Execute *func* with exponential backoff.
    Returns the function's result or raises the last exception.
    """
    for attempt in range(1, retries + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if attempt == retries:
                raise
            sleep_time = backoff ** attempt
            print(f"Retry {attempt}/{retries} after error: {e} – sleeping {sleep_time}s")
            time.sleep(sleep_time)
    raise RuntimeError("Retry loop exhausted without returning")

def count_rows_in_bbox(conn, table: str, bbox: Dict[str, float]) -> int:
    """Counts the number of rows in the given table within the given bbox.
    Assumes the table has `lat` and `lng` columns.
    """
    query = f"""
        SELECT COUNT(*) FROM {table}
        WHERE lat >= %s AND lat <= %s
          AND lng >= %s AND lng <= %s
    """
    try:
        with conn.cursor() as cur:
            cur.execute(query, (bbox["lat_min"], bbox["lat_max"], bbox["lng_min"], bbox["lng_max"]))
            return cur.fetchone()[0]
    except Exception as e:
        print(f"Error counting rows in {table}: {e}")
        return 0
