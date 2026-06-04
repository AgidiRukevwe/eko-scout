/*
 * Migration: add centroid columns to electricity_h3_features
 */
ALTER TABLE electricity_h3_features
  ADD COLUMN IF NOT EXISTS centroid_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS centroid_lng DOUBLE PRECISION;
