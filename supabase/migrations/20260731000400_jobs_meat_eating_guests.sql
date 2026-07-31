-- The BBQ meat-eater resolution.
--
-- CALC-NUCELLA-BBQ-SPLIT expects 22 meat eaters from 27 guests, 4 salmon
-- vegetarians and 1 vegan. Deriving that as 27 - (4 + 1) sums dietary counts and
-- subtracts them from the guest count, which Rule 16 forbids.
--
-- So the count becomes something the owner states rather than something the engine
-- infers. The historical fixture already records it explicitly
-- (guest_split.meat_eaters: 22, confidence "confirmed"), so this matches how the
-- data was always captured.
--
-- Null means fall back to the single derivation in src/engine/rules.ts, which
-- counts DISTINCT guests flagged excludes_meat and returns null rather than a guess
-- when anything is unresolved.

alter table jobs add column meat_eating_guests integer;

comment on column jobs.meat_eating_guests is
  'Owner-set meat-eating guest count. Null = fall back to meatEatingGuests() in src/engine/rules.ts. Pending owner confirmation of this approach.';
