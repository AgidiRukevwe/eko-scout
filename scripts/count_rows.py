import sqlalchemy
from sqlalchemy import text

# Connection string (ensure credentials are correct)
conn_str = "postgresql://neondb_owner:npg_hVKSq3L7OmZg@ep-quiet-firefly-aqjnsyty.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require"

engine = sqlalchemy.create_engine(conn_str)

with engine.connect() as conn:
    result = conn.execute(text('SELECT COUNT(*) FROM h3_staging_power'))
    count = result.scalar()
    print(f"Rows in h3_staging_power: {count}")
