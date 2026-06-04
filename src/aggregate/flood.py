"""
Flood Risk Intelligence Aggregator Pipeline
-------------------------------------------
This script orchestrates the execution of `aggregate_flood.sql`.
It connects to the database pool and evaluates the deterministic 2-layer flood scoring model
across all H3 cells.
"""

import os
from src.core.db import get_connection, release_connection

def trigger_flood_aggregation():
    conn = get_connection()
    try:
        query_path = os.path.join(os.path.dirname(__file__), '../../db/queries/aggregate_flood.sql')
        with open(query_path, 'r') as f:
            query = f.read()
            
        print("Running Flood SQL Aggregation...")
        with conn.cursor() as cur:
            cur.execute(query)
        conn.commit()
        print("Flood Aggregation complete!")
    finally:
        release_connection(conn)

if __name__ == "__main__":
    trigger_flood_aggregation()
