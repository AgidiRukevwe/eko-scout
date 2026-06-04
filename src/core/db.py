"""
Database Connection Manager
---------------------------
Provides a centralized PostgreSQL connection pool using `psycopg2`. 
This is used by the Python aggregation scripts to execute SQL pipelines efficiently without
constantly opening/closing raw connections.
"""

import psycopg2
from psycopg2 import pool
from .config import config

# Initialize a connection pool
try:
    db_pool = psycopg2.pool.SimpleConnectionPool(
        1, 10,
        config.DATABASE_URL
    )
    if db_pool:
        print("Connection pool created successfully")
except Exception as e:
    print(f"Error connecting to database: {e}")
    db_pool = None

def get_connection():
    if db_pool:
        return db_pool.getconn()
    raise Exception("Database connection pool is not initialized")

def release_connection(conn):
    if db_pool and conn:
        db_pool.putconn(conn)
