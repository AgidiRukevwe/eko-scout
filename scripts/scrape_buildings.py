import os
import sys
import requests
import h3
import json
import time

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from src.core.db import get_connection, release_connection
from psycopg2.extras import execute_values

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

def run_query(query_str):
    print("Executing Overpass query... (this may take a few minutes)")
    try:
        response = requests.post(
            OVERPASS_URL, 
            data=query_str.encode('utf-8'), 
            headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'eko-scout-app/1.0', 'Accept': '*/*'},
            timeout=900
        )
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Overpass API returned {response.status_code}: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"Request failed: {e}")
        return None

def fetch_buildings():
    # Using the bounding box for Lagos Mainland roughly (Yaba, Ebute Metta, Surulere borders)
    # Bbox format: (south, west, north, east)
    query = """
    [out:json][timeout:900];
    (
      way["building"](6.4600, 3.3500, 6.5400, 3.4100);
    );
    out center;
    """
    return run_query(query)

def process_and_insert():
    conn = get_connection()
    if not conn:
        print("Could not connect to DB.")
        return

    try:
        print("\n--- Fetching Buildings (via Bounding Box) ---")
        bldg_data = fetch_buildings()
        if bldg_data and 'elements' in bldg_data:
            bldgs = bldg_data['elements']
            print(f"Found {len(bldgs)} Buildings. Preparing bulk insert...")
            
            records = []
            for b in bldgs:
                b_id = b.get('id')
                lat = b.get('center', {}).get('lat') or b.get('lat')
                lon = b.get('center', {}).get('lon') or b.get('lon')
                tags = b.get('tags', {})
                btype = tags.get('building', 'yes')
                
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
                    
                records.append((b_id, btype[:100], lat, lon, 0, h3_r10, h3_r9))
            
            if records:
                with conn.cursor() as cur:
                    # Bulk insert is much faster for thousands of rows
                    insert_query = """
                        INSERT INTO osm_buildings (id, building_type, lat, lng, area, h3_r10, h3_r9)
                        VALUES %s
                        ON CONFLICT (id) DO NOTHING
                    """
                    execute_values(cur, insert_query, records, page_size=1000)
                conn.commit()
                print(f"Successfully bulk-inserted {len(records)} buildings!")
            else:
                print("No valid building records to insert.")

    except Exception as e:
        print(f"Database error: {e}")
        conn.rollback()
    finally:
        release_connection(conn)

if __name__ == "__main__":
    process_and_insert()
