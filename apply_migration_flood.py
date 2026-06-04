import os
from src.core.db import get_connection, release_connection

def apply_migration():
    conn = get_connection()
    try:
        query_path = os.path.join(os.path.dirname(__file__), 'db/migrations/003_flood.sql')
        with open(query_path, 'r') as f:
            query = f.read()
            
        print("Running Migration 003 (Flood)...")
        with conn.cursor() as cur:
            cur.execute(query)
        conn.commit()
        print("Migration 003 complete!")
    finally:
        release_connection(conn)

if __name__ == "__main__":
    apply_migration()
