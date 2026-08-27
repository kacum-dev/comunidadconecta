ALTER TABLE private_units ADD COLUMN site_name text;
ALTER TABLE private_units ADD COLUMN block_name text;
ALTER TABLE private_units ADD COLUMN staircase text;

CREATE INDEX private_units_directory_idx
  ON private_units (community_id, site_name, block_name, staircase, floor, door, code)
  WHERE status = 'active';

CREATE INDEX private_units_type_directory_idx
  ON private_units (community_id, unit_type, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX unit_relations_directory_lookup_idx
  ON unit_relations (community_id, unit_id, relation_type, status, valid_to);

COMMENT ON COLUMN private_units.site_name IS 'Manzana, sector, urbanizacion o conjunto superior';
COMMENT ON COLUMN private_units.block_name IS 'Bloque o edificio dentro del conjunto';
COMMENT ON COLUMN private_units.staircase IS 'Escalera, portal o acceso vertical';
