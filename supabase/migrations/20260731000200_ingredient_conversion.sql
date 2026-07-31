-- Rule 4 — the missing piece of the three unit systems.
--
-- recipe unit (g)  ->  stock unit (kg)  ->  purchase unit (1 kg pack)
--
-- pack_size / pack_unit already covered purchase -> stock. Nothing held recipe ->
-- stock, and it is not always derivable: g -> kg is dimensional, but "each" -> kg
-- for eggs is not. Without this the conversion had to be guessed, which Rule 8
-- forbids, so units.ts could not be written.
--
-- recipe_unit                 how recipes measure this ingredient (g, ml, each)
-- recipe_units_per_stock_unit needed ONLY where the pair is not dimensionally
--                             derivable. Null plus a non-dimensional pair is an
--                             unresolved conversion: surfaced, never guessed.

alter table ingredients
  add column recipe_unit                 text,
  add column recipe_units_per_stock_unit numeric(14,6);

comment on column ingredients.recipe_unit is
  'How recipes measure this ingredient. Null until the owner sets it.';

comment on column ingredients.recipe_units_per_stock_unit is
  'Recipe units in one stock unit, where not dimensionally derivable (e.g. eggs: each -> kg). Null = derive dimensionally, or unresolved. Never assume 1.';
