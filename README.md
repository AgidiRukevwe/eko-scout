# EkoScout Spatial Intelligence System

EkoScout is a spatial intelligence platform designed for urban analysis in Nigeria. It normalizes disparate urban datasets (OpenStreetMap Points of Interest, building footprints, road networks, and electricity infrastructure) into a unified H3 spatial grid (Resolution 9) to generate actionable insights and deterministic land-use classifications.

## Architecture

The system operates on a pipeline architecture:
1. **Raw Data Ingestion**: Python scripts (`scripts/`) load raw datasets (CSV/Excel) or APIs, geocode them if necessary, map them to H3 hexes using the `h3-py` library, and stage them in a PostgreSQL database (Neon).
2. **Deterministic Aggregation**: SQL queries (`db/queries/`) run against the staged data to aggregate features per H3 cell, strictly enforcing business logic, threshold rules, and deterministic classifications (no probabilistic ML models).
3. **Trigger Pipelines**: Orchestrator Python scripts (`src/aggregate/`) trigger the SQL aggregation pipelines against the database.
4. **API / UI**: Next.js (App Router) provides the backend API and frontend visualization layers.

## Key Layers

### 1. Environment Layer (`h3_r9_features`)
Aggregates OSM Buildings, Roads, and POIs. It computes raw intensity scores (Activity, Mobility, Calm) and classifies each hex into land-use categories (`residential`, `commercial`, `mixed-use`, `undeveloped`, `transitional`) based on strict absolute formulas (e.g., residential needs > 5 buildings and strong residential POI presence).

### 2. Electricity Infrastructure Layer (`electricity_h3_features`)
Maps electricity feeders to H3 cells. It calculates the dominant service band (A-E) using raw counts and a deterministic tie-breaker (`A > B > C > D > E`). It also assigns a confidence label (`High`, `Medium`, `Low`) based strictly on agreement percentages and total feeder counts per cell.

## Development Setup

### 1. Environment Variables
Create a `.env.local` file in the root with:
```bash
DATABASE_URL="postgresql://user:password@host/dbname"
```

### 2. Install Dependencies
Node dependencies for the Next.js app:
```bash
npm install
```

Python dependencies for the ingestion/aggregation pipelines:
```bash
pip install -r requirements-pipeline.txt
```

### 3. Database Migrations
Run the schema files sequentially against your database:
```bash
psql -d $DATABASE_URL -f db/migrations/001_init.sql
psql -d $DATABASE_URL -f db/migrations/002_electricity.sql
```

### 4. Running the Aggregation Pipelines
After data is loaded into the staging tables (`osm_buildings`, `osm_pois`, `osm_roads`, `h3_staging_power`), execute the aggregations:
```bash
python -m src.aggregate.features
python -m src.aggregate.electricity
```

### 5. Start the Web Server
```bash
npm run dev
```
