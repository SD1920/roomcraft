-- Run once on your existing database (safe to run twice):
--   psql -U postgres -d roomcraft -f migration_wall_height.sql
-- Old designs automatically get 8 ft, which is what the walls were before.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS wall_height DECIMAL(5,2) NOT NULL DEFAULT 8;
