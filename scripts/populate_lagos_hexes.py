import os
import h3
import psycopg2
from psycopg2.extras import execute_values

# Adjust these bounds to roughly cover Lagos Mainland (approx.)
# South, West, North, East in decimal degrees
BOUNDING_BOX = (6.45, 3.25, 6.70, 3.55)

# Database connection – reuse same pool settings as other scripts
# Assuming environment variables for DB URL are set (e.g., DATABASE_URL)

def get_connection():
    # Simple direct connection for this one‑off script
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL environment variable not set")
    return psycopg2.connect(db_url)


def generate_h3_cells(resolution: int = 9):
    south, west, north, east = BOUNDING_BOX
    # Simple rectangle polygon in (lat, lon) order
    polygon = [
        (south, west),
        (south, east),
        (north, east),
        (north, west),
        (south, west),
    ]
    # h3.polyfill expects a list of (lat, lon) tuples
    cells = h3.polyfill(polygon, resolution)
    return cells


def insert_hexes(cells):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # Prepare rows with default values
            rows = []
            for h3_r9 in cells:
                rows.append((h3_r9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, None))
            sql = """
                INSERT INTO h3_r9_features (
                    h3_r9, building_density, poi_density, road_density,
                    activity_score, mobility_score, calm_score,
                    residential_score, commercial_score,
                    confidence_score, congestion_score, land_use_type, updated_at
                ) VALUES %s
                ON CONFLICT (h3_r9) DO NOTHING
            """
            execute_values(cur, sql, rows, page_size=1000)
        conn.commit()
        print(f"Inserted {len(rows)} hex cells into h3_r9_features.")
    finally:
        conn.close()

if __name__ == "__main__":
    cells = generate_h3_cells()
    print(f"Generated {len(cells)} H3 R9 cells for Lagos Mainland bounding box.")
    insert_hexes(cells)
