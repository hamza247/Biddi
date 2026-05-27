-- Align live currencies.rate_from_usd column type with the Drizzle
-- schema (doublePrecision). The original 0021 migration accidentally
-- created the column as numeric(18,8); this ALTER reconciles deployments
-- that already ran 0021 so node-postgres returns numbers (not strings)
-- when reading the column.
ALTER TABLE "currencies"
  ALTER COLUMN "rate_from_usd" TYPE double precision
  USING "rate_from_usd"::double precision;
