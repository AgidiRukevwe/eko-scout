"""
Electricity Infrastructure Aggregator Pipeline
----------------------------------------------
This script orchestrates the execution of `aggregate_electricity.sql`.
It establishes a connection to the database and recalculates the dominant bands 
and confidence labels for electricity infrastructure across all H3 cells.
"""

import os
from src.core.config import config
from sqlalchemy import create_engine, text

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
    print("Electricity Aggregation complete!")

if __name__ == "__main__":
    trigger_electricity_aggregation()
