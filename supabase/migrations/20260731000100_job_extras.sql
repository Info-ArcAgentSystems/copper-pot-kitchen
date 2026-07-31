-- Rule 11 — extras and surcharges as named line items.
--
-- They are separate rows, never folded into the rate. The fixtures show they are
-- per-EACH with a quantity ("Bistro steak surcharge €10 each", "Birthday cake €30
-- each"), not flat amounts, so quantity is carried explicitly.
--
-- No seed data. The table is created empty and stays empty until the owner enters
-- something (Rule 1).

create table job_extras (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  label       text not null,
  amount_each numeric(10,2),               -- null = named but unpriced. Rule 8: never 0.
  quantity    integer not null default 1,
  position    integer not null default 0
);

create index on job_extras (kitchen_id, job_id);

alter table job_extras enable row level security;

create policy job_extras_rw on job_extras
  for all
  using (kitchen_id = my_kitchen_id())
  with check (kitchen_id = my_kitchen_id());
