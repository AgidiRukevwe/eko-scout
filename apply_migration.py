import os
from src.core.db import get_connection, release_connection

def apply_migration():
    conn = get_connection()
    try:
        query_path = os.path.join(os.path.dirname(__file__), 'db/migrations/002_electricity.sql')
        with open(query_path, 'r') as f:
            query = f.read()
            
        print("Running Migration 002...")
        with conn.cursor() as cur:
            cur.execute(query)
        conn.commit()
        print("Migration 002 complete!")
    finally:
        release_connection(conn)

if __name__ == "__main__":
    apply_migration()
