import os
import sys
import requests
import h3
import json
import time

# Ensure we can import from src
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from src.core.db import get_connection, release_connection
import psycopg2

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Helper to obtain a DB connection with retry
def get_connection_retry(max_tries: int = 3, delay: int = 2):
    """Attempt to get a DB connection, retrying on failure.

    Args:
        max_tries: Number of attempts before giving up.
        delay: Seconds to wait between attempts.
    """
    for attempt in range(1, max_tries + 1):
        conn = get_connection()
        if conn:
            return conn
        print(f"DB connection attempt {attempt} failed, retrying in {delay}s…")
        time.sleep(delay)
    raise psycopg2.OperationalError("Unable to obtain DB connection after retries")

def run_query(query_str):
    print("Executing Overpass query... (this may take a few minutes)")
    try:
        # Overpass API requires the body to be the raw query string or a key-value pair 'data=...'
        # Sending as raw UTF-8 string with appropriate headers.
        response = requests.post(
            OVERPASS_URL, 
            data=query_str.encode('utf-8'), 
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'eko-scout-app/1.0',
                'Accept': '*/*'
            },
            timeout=300
        )
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Overpass API returned {response.status_code}: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"Request failed: {e}")
        return None

def fetch_pois():
    query = """
    [out:json][timeout:90];
    area["name"="Lagos Mainland"]->.searchArea;
    (
      node["amenity"](area.searchArea);
      node["shop"](area.searchArea);
      node["office"](area.searchArea);
      node["leisure"](area.searchArea);
      node["healthcare"](area.searchArea);
    );
    out center;
    """
    return run_query(query)

def fetch_buildings():
    query = """
    [out:json][timeout:180];
    area["name"="Lagos Mainland"]->.searchArea;
    way["building"](area.searchArea);
    out center;
    """
    return run_query(query)

def fetch_roads():
    query = """
    [out:json][timeout:90];
    area["name"="Lagos Mainland"]->.searchArea;
    way["highway"](area.searchArea);
    out center;
    """
    return run_query(query)

def process_and_insert():
    conn = get_connection_retry()
    if not conn:
        print("Could not connect to DB after retries.")
        return

    try:
        with conn.cursor() as cur:
            # 1. POIs
            print("\n--- Fetching POIs ---")
            poi_data = fetch_pois()
            if poi_data and 'elements' in poi_data:
                pois = poi_data['elements']
                print(f"Found {len(pois)} POIs. Inserting...")
                for p in pois:
                    p_id = p.get('id')
                    lat = p.get('lat')
                    lon = p.get('lon')
                    tags = p.get('tags', {})
                    name = tags.get('name', '')
                    
                    # Determine category
                    cat = ''
                    subcat = ''
                    for t in ['amenity', 'shop', 'office', 'leisure', 'healthcare']:
                        if t in tags:
                            cat = t
                            subcat = tags[t]
                            break
                            
                    if not lat or not lon: continue
                    
                    try:
                        # Depending on h3 library version
                        if hasattr(h3, 'geo_to_h3'):
                            h3_r9 = h3.geo_to_h3(lat, lon, 9)
                            h3_r10 = h3.geo_to_h3(lat, lon, 10)
                        else:
                            h3_r9 = h3.latlng_to_cell(lat, lon, 9)
                            h3_r10 = h3.latlng_to_cell(lat, lon, 10)
                    except AttributeError:
                        h3_r9 = h3.latlng_to_cell(lat, lon, 9)
                        h3_r10 = h3.latlng_to_cell(lat, lon, 10)
                    
                    cur.execute("""
                        INSERT INTO osm_pois (id, name, category, subcategory, lat, lng, h3_r10, h3_r9, tags_json)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET 
                            name = EXCLUDED.name, category = EXCLUDED.category, 
                            subcategory = EXCLUDED.subcategory, tags_json = EXCLUDED.tags_json
                    """, (p_id, name[:255], cat[:100], subcat[:100], lat, lon, h3_r10, h3_r9, json.dumps(tags)))
                conn.commit()

                # Fetch building data without DB interaction
                bldg_data = fetch_buildings()
                if not (bldg_data and 'elements' in bldg_data):
                    print('No building data returned.')
                    bldgs = []
                else:
                    bldgs = bldg_data['elements']
                print(f"Found {len(bldgs)} Buildings. Preparing batch inserts...")
                # Close the current DB connection before heavy insertion work
                conn.rollback()
                release_connection(conn)
                conn = None
                
                batch = []
                batch_size = 5000
                for b in bldgs:
                    b_id = b.get('id')
                    lat = b.get('center', {}).get('lat') or b.get('lat')
                    lon = b.get('center', {}).get('lon') or b.get('lon')
                    tags = b.get('tags', {})
                    btype = tags.get('building', 'yes')
                    if not lat or not lon:
                        continue
                    try:
                        if hasattr(h3, 'geo_to_h3'):
                            h3_r9 = h3.geo_to_h3(lat, lon, 9)
                            h3_r10 = h3.geo_to_h3(lat, lon, 10)
                        else:
                            h3_r9 = h3.latlng_to_cell(lat, lon, 9)
                            h3_r10 = h3.latlng_to_cell(lat, lon, 10)
                    except Exception:
                        continue
                    batch.append((b_id, btype[:100], lat, lon, 0, h3_r10, h3_r9))
                    if len(batch) >= batch_size:
                        conn = get_connection_retry()
                        with conn.cursor() as cur:
                            try:
                                cur.executemany("""
                                    INSERT INTO osm_buildings (id, building_type, lat, lng, area, h3_r10, h3_r9)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                                    ON CONFLICT (id) DO NOTHING
                                """, batch)
                                conn.commit()
                            except psycopg2.OperationalError as e:
                                print(f"Batch insert failed: {e}")
                                conn.rollback()
                            finally:
                                release_connection(conn)
                                release_connection(conn_batch)
                        batch.clear()

                # Insert any remaining records
                if batch:
                    conn_batch = get_connection_retry()
                    try:
                        with conn_batch.cursor() as cur_batch:
                            cur_batch.executemany("""
                                INSERT INTO osm_buildings (id, building_type, lat, lng, area, h3_r10, h3_r9)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (id) DO NOTHING
                            """, batch)
                            conn_batch.commit()
                    except Exception as e:
                        print(f"Final batch insert error: {e}")
                        conn_batch.rollback()
                    finally:
                        release_connection(conn_batch)
                    batch.clear()
                    
                # Re-establish connection for final section
                conn = get_connection_retry()
                cur = conn.cursor()
                
                # 3. Roads
                time.sleep(2)
                print("\n--- Fetching Roads ---")
                road_data = fetch_roads()
                if road_data and 'elements' in road_data:
                    roads = road_data['elements']
                    print(f"Found {len(roads)} Roads. Inserting...")
                    for r in roads:
                        r_id = r.get('id')
                        lat = r.get('center', {}).get('lat') or r.get('lat')
                        lon = r.get('center', {}).get('lon') or r.get('lon')
                        tags = r.get('tags', {})
                        rtype = tags.get('highway', 'unknown')
                        name = tags.get('name', '')
                        
                        if not lat or not lon: continue
                        
                        try:
                            conn.commit()
                        except psycopg2.OperationalError as e:
                            print(f"Final batch insert failed: {e}, attempting reconnect...")
                            conn.rollback()
                            release_connection(conn)
                            conn = get_connection_retry()
                            cur = conn.cursor()
                            cur.executemany("""
                                INSERT INTO osm_buildings (id, building_type, lat, lng, area, h3_r10, h3_r9)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (id) DO NOTHING
                            """, batch)
                            conn.commit()
                # End of Buildings
            # 3. Roads
            time.sleep(2)
            print("\n--- Fetching Roads ---")
            road_data = fetch_roads()
            if road_data and 'elements' in road_data:
                roads = road_data['elements']
                print(f"Found {len(roads)} Roads. Inserting...")
                for r in roads:
                    r_id = r.get('id')
                    lat = r.get('center', {}).get('lat') or r.get('lat')
                    lon = r.get('center', {}).get('lon') or r.get('lon')
                    tags = r.get('tags', {})
                    rtype = tags.get('highway', 'unknown')
                    name = tags.get('name', '')
                    
                    if not lat or not lon: continue
                    
                    try:
                        if hasattr(h3, 'geo_to_h3'):
                            h3_r9 = h3.geo_to_h3(lat, lon, 9)
                            h3_r10 = h3.geo_to_h3(lat, lon, 10)
                        else:
                            h3_r9 = h3.latlng_to_cell(lat, lon, 9)
                            h3_r10 = h3.latlng_to_cell(lat, lon, 10)
                    except AttributeError:
                        h3_r9 = h3.latlng_to_cell(lat, lon, 9)
                        h3_r10 = h3.latlng_to_cell(lat, lon, 10)
                        
                    cur.execute("""
                        INSERT INTO osm_roads (id, road_type, name, length, lat, lng, h3_r10, h3_r9)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """, (r_id, rtype[:100], name[:255], 0, lat, lon, h3_r10, h3_r9))
                conn.commit()

            print("\nAll data inserted successfully!")

    except Exception as e:
        print(f"Database error: {e}")
        conn.rollback()
    finally:
        release_connection(conn)

if __name__ == "__main__":
    process_and_insert()
