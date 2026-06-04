"""
Environment Features Aggregator Pipeline
----------------------------------------
This script acts as the orchestrator to trigger the execution of `aggregate_features.sql`.
It establishes a connection using the central DB pool, reads the SQL query, and executes 
it to recalculate the environment spatial grid.
"""

import os
import sys
# Add project root to sys.path for package imports
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)
from src.core.db import get_connection, release_connection

def trigger_aggregation():
    conn = get_connection()
    try:
        # We read the SQL file instead of hardcoding
        query_path = os.path.join(os.path.dirname(__file__), '../../db/queries/aggregate_features.sql')
        with open(query_path, 'r') as f:
            query = f.read()
            
        print("Running SQL Aggregation...")
        with conn.cursor() as cur:
            cur.execute(query)
        conn.commit()
        print("Aggregation complete!")
    finally:
        release_connection(conn)

if __name__ == "__main__":
    trigger_aggregation()
