ALTER TABLE private_units
  ADD COLUMN built_area_m2 numeric(10,2),
  ADD COLUMN usable_area_m2 numeric(10,2),
  ADD COLUMN bedrooms smallint,
  ADD COLUMN bathrooms smallint,
  ADD COLUMN quota_method text NOT NULL DEFAULT 'participation_coefficient',
  ADD COLUMN fixed_quota_cents bigint,
  ADD COLUMN quota_frequency text NOT NULL DEFAULT 'monthly';

ALTER TABLE private_units
  ADD CONSTRAINT private_units_built_area_check
    CHECK (built_area_m2 IS NULL OR built_area_m2 > 0),
  ADD CONSTRAINT private_units_usable_area_check
    CHECK (usable_area_m2 IS NULL OR usable_area_m2 > 0),
  ADD CONSTRAINT private_units_area_order_check
    CHECK (built_area_m2 IS NULL OR usable_area_m2 IS NULL OR usable_area_m2 <= built_area_m2),
  ADD CONSTRAINT private_units_bedrooms_check
    CHECK (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 99),
  ADD CONSTRAINT private_units_bathrooms_check
    CHECK (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 99),
  ADD CONSTRAINT private_units_quota_method_check
    CHECK (quota_method IN ('fixed_amount', 'participation_coefficient')),
  ADD CONSTRAINT private_units_fixed_quota_check
    CHECK (fixed_quota_cents IS NULL OR fixed_quota_cents >= 0),
  ADD CONSTRAINT private_units_fixed_quota_required_check
    CHECK (quota_method <> 'fixed_amount' OR fixed_quota_cents IS NOT NULL),
  ADD CONSTRAINT private_units_quota_frequency_check
    CHECK (quota_frequency IN ('monthly', 'quarterly', 'semiannual', 'annual'));

COMMENT ON COLUMN private_units.built_area_m2 IS 'Superficie construida privativa en metros cuadrados';
COMMENT ON COLUMN private_units.usable_area_m2 IS 'Superficie util privativa en metros cuadrados';
COMMENT ON COLUMN private_units.participation_coefficient IS 'Cuota de participacion del titulo constitutivo, expresada como porcentaje';
COMMENT ON COLUMN private_units.quota_method IS 'Criterio de la cuota ordinaria: importe fijo o coeficiente de participacion';
COMMENT ON COLUMN private_units.fixed_quota_cents IS 'Importe ordinario por periodo cuando quota_method es fixed_amount';
COMMENT ON COLUMN private_units.quota_frequency IS 'Periodicidad de la cuota ordinaria';
