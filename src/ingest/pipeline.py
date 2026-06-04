import sys
import psycopg2.extras
from src.core.config import config
from src.core.db import get_connection, release_connection
from src.ingest.overpass_client import fetch_osm_data
from src.ingest.normalizer import normalize_poi, normalize_building, normalize_road

def insert_pois(conn, pois):
    query = """
    INSERT INTO osm_pois (id, name, category, subcategory, lat, lng, h3_r10, h3_r9, tags_json)
    VALUES %s
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        subcategory = EXCLUDED.subcategory,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        h3_r10 = EXCLUDED.h3_r10,
        h3_r9 = EXCLUDED.h3_r9,
        tags_json = EXCLUDED.tags_json,
        updated_at = CURRENT_TIMESTAMP
    """
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, query, pois, template="(%(id)s, %(name)s, %(category)s, %(subcategory)s, %(lat)s, %(lng)s, %(h3_r10)s, %(h3_r9)s, %(tags_json)s)")
    conn.commit()

def insert_buildings(conn, buildings):
    query = """
    INSERT INTO osm_buildings (id, building_type, lat, lng, area, h3_r10, h3_r9)
    VALUES %s
    ON CONFLICT (id) DO UPDATE SET
        building_type = EXCLUDED.building_type,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        area = EXCLUDED.area,
        h3_r10 = EXCLUDED.h3_r10,
        h3_r9 = EXCLUDED.h3_r9,
        updated_at = CURRENT_TIMESTAMP
    """
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, query, buildings, template="(%(id)s, %(building_type)s, %(lat)s, %(lng)s, %(area)s, %(h3_r10)s, %(h3_r9)s)")
    conn.commit()

def insert_roads(conn, roads):
    query = """
    INSERT INTO osm_roads (id, road_type, name, length, lat, lng, h3_r10, h3_r9)
    VALUES %s
    ON CONFLICT (id) DO UPDATE SET
        road_type = EXCLUDED.road_type,
        name = EXCLUDED.name,
        length = EXCLUDED.length,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        h3_r10 = EXCLUDED.h3_r10,
        h3_r9 = EXCLUDED.h3_r9,
        updated_at = CURRENT_TIMESTAMP
    """
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, query, roads, template="(%(id)s, %(road_type)s, %(name)s, %(length)s, %(lat)s, %(lng)s, %(h3_r10)s, %(h3_r9)s)")
    conn.commit()

def run_ingestion():
    conn = get_connection()
    try:
        for region, bbox in config.TARGET_BBOXES.items():
            print(f"Ingesting region: {region}")
            
            # 1. POIs
            print("  Fetching POIs...")
            poi_data = fetch_osm_data(bbox, "pois")
            pois = [normalize_poi(el) for el in poi_data.get('elements', [])]
            pois = [p for p in pois if p is not None]
            if pois:
                insert_pois(conn, pois)
            
            # 2. Buildings
            print("  Fetching Buildings...")
            bldg_data = fetch_osm_data(bbox, "buildings")
            bldgs = [normalize_building(el) for el in bldg_data.get('elements', [])]
            bldgs = [b for b in bldgs if b is not None]
            if bldgs:
                insert_buildings(conn, bldgs)
                
            # 3. Roads
            print("  Fetching Roads...")
            road_data = fetch_osm_data(bbox, "roads")
            roads = [normalize_road(el) for el in road_data.get('elements', [])]
            roads = [r for r in roads if r is not None]
            if roads:
                insert_roads(conn, roads)
                
        print("Ingestion complete!")
    finally:
        release_connection(conn)

if __name__ == "__main__":
    run_ingestion()
