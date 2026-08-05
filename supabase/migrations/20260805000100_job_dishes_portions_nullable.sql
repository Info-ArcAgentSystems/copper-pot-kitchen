-- job_dishes.portions: allow null.
--
-- WHY THIS IS NOT COSMETIC
-- The column is `integer not null default 0`. Rule 8 wants null for "not yet
-- allocated", and here the difference is operational rather than philosophical:
--
--   null = the owner has not set portions, so applyBuffetSplit derives them from
--          the guest count. The dish scales with the job.
--   0    = make none of this dish.
--
-- These are opposite instructions, and `not null default 0` silently turns the
-- first into the second. The whole live impact preview rests on the first: a
-- guest-count change moves ingredients ONLY for dishes whose portions are null,
-- so with the column as it stands, every dish would be pinned at zero portions
-- and a guest change would move revenue and nothing else. The preview would be
-- correct about a cascade that had been quietly disabled at the column level.
--
-- `JobDishRow` in src/data/rows.ts already types this `number | null`, and
-- save_job already inserts null for an unset dish. This is the schema catching up
-- with the code, not a new idea.
--
-- EXISTING ROWS ARE LEFT ALONE. A blanket 0 -> null would be inventing meaning
-- for rows whose author is not here to ask, which is precisely what Rule 8
-- forbids. The tables hold no owner data yet, so there is nothing to migrate;
-- should a genuine 0 ever exist, it keeps meaning "make none".

alter table job_dishes alter column portions drop default;
alter table job_dishes alter column portions drop not null;
