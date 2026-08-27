-- Refuerzo posterior a la revisión de integración. También cubre bases que ya
-- hubieran aplicado la migración 012 desde una rama de trabajo anterior.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_breaches_affected_people_check'
  ) THEN
    ALTER TABLE data_breaches
      ADD CONSTRAINT data_breaches_affected_people_check
      CHECK (affected_people IS NULL OR affected_people >= 0);
  END IF;
END $$;
