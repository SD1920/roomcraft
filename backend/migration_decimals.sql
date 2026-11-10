-- Room sizes and wall height with up to 4 decimals (they were 2).
-- Safe to run twice. Run by: npm run setup-db
ALTER TABLE designs ALTER COLUMN room_width  TYPE DECIMAL(9,4);
ALTER TABLE designs ALTER COLUMN room_length TYPE DECIMAL(9,4);
ALTER TABLE designs ALTER COLUMN wall_height TYPE DECIMAL(9,4);
