-- Rules 16 and 12 — per-guest dietary identity.
--
-- The `guests` column was a per-category count. One guest can be coeliac AND
-- vegetarian, so those counts must never be summed and must never be subtracted
-- from the guest count as a total — Rule 16. A count column is the operand that
-- makes the wrong arithmetic writable, so it goes.
--
-- In its place, guest_ref identifies one guest WITHIN one job. It is not a person
-- record; the kitchen stores no guest identities. It exists so that two
-- requirements can be attributed to the same guest, which makes counting distinct
-- guests correct by construction.
--
-- excludes_meat is an EXPLICIT flag the owner sets. It is deliberately not inferred
-- from diet_type text: a hardcoded list of which diets exclude meat would be
-- business data in the app, which Rule 1 forbids.

alter table job_dietaries
  drop column guests,
  add  column guest_ref     text,
  add  column excludes_meat boolean not null default false;

-- Enforces the discriminated union at the database level, mirroring the
-- AllocatedDietary | UnresolvedDietary split in src/engine/types.ts. An allocated
-- record names its guest; an unresolved one keeps the owner's verbatim wording
-- ("a few vegetarians") and no number. Neither can be half-formed.
alter table job_dietaries add constraint job_dietaries_allocation_ck check (
     (guests_unresolved = false and guest_ref       is not null)
  or (guests_unresolved = true  and unresolved_note is not null)
);

comment on column job_dietaries.guest_ref is
  'Identifies one guest within one job. Two rows sharing a guest_ref are one person with two requirements (Rule 16).';

comment on column job_dietaries.excludes_meat is
  'Owner-set. Never inferred from diet_type — that would be business data in code (Rule 1).';
