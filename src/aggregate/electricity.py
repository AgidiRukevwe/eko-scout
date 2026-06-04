"""
Electricity Infrastructure Aggregator Pipeline
----------------------------------------------
This script orchestrates the execution of `aggregate_electricity.sql`.
It establishes a connection to the database and recalculates the dominant bands 
and confidence labels for electricity infrastructure across all H3 cells.
"""

import os, sys
from pathlib import Path
# Ensure project root is in PYTHONPATH when script is executed directly
project_root = Path(__file__).resolve().parents[2]
if str(project_root) not in sys.path:
    sys.path.append(str(project_root))

from src.core.config import config
from sqlalchemy import create_engine, text

import h3

def trigger_electricity_aggregation():
    # Use SQLAlchemy engine for reliable connection handling
    db_url = config.DATABASE_URL
    engine = create_engine(db_url)
    query_path = os.path.join(os.path.dirname(__file__), '../../db/queries/aggregate_electricity.sql')
    with open(query_path, 'r') as f:
        query = f.read()
    print("Running Electricity SQL Aggregation via SQLAlchemy...")
    with engine.begin() as conn:
        conn.execute(text(query))
        # Populate centroid columns for each h3_index using the h3 library
        rows = conn.execute(text('SELECT h3_index FROM electricity_h3_features')).fetchall()
        for row in rows:
            h3_index = row[0]
            lat, lng = h3.cell_to_latlng(h3_index)
            conn.execute(
                text('UPDATE electricity_h3_features SET centroid_lat = :lat, centroid_lng = :lng WHERE h3_index = :h3'),
                {'lat': lat, 'lng': lng, 'h3': h3_index}
            )
    print("Electricity Aggregation complete!")

if __name__ == "__main__":
    trigger_electricity_aggregation()
