-- ============================================================
-- COPPER POT KITCHEN — schema
-- Run in the Supabase SQL editor, top to bottom, once.
--
-- Single owner (Paul) plus named collaborators (the dev team).
-- Every row is scoped to a kitchen. No seed data lives here:
-- the tables are created empty and stay empty until the owner
-- enters something. Test fixtures live in /tests only.
-- ============================================================

-- ---------- 1. KITCHEN + ACCESS ----------

create table kitchens (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  currency    text not null default '€',
  timezone    text not null default 'Europe/Dublin',
  created_at  timestamptz not null default now()
);

-- Who may read/write a kitchen. Owner plus any dev accounts added
-- for support. This is how the team debugs Paul's data without
-- sharing a login.
create table kitchen_members (
  user_id     uuid not null references auth.users(id) on delete cascade,
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','member','support')),
  joined_at   timestamptz not null default now(),
  primary key (user_id, kitchen_id)
);

-- Resolves the caller's kitchen once, for every policy below.
create or replace function my_kitchen_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select kitchen_id from kitchen_members where user_id = auth.uid() limit 1;
$$;

-- ---------- 2. PEOPLE AND PLACES ----------

create table properties (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references kitchens(id) on delete cascade,
  name          text not null,
  eircode       text,
  address       text,
  access_notes  text,
  facilities    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table customers (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references kitchens(id) on delete cascade,
  name          text not null,
  phone         text,
  email         text,
  client_group  text,          -- e.g. Tranquillity, Visit Carlingford. Drives rates.
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- 3. PRICING ----------

-- Owner-entered rate card. Nothing is assumed: if a rate is absent
-- the app leaves revenue blank rather than inventing one.
create table client_rates (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references kitchens(id) on delete cascade,
  client_group  text not null,
  service_type  text not null,
  rate_per_head numeric(10,2),
  flat_fee      numeric(10,2),
  created_at    timestamptz not null default now(),
  unique (kitchen_id, client_group, service_type)
);

-- ---------- 4. INGREDIENTS AND SUPPLIERS ----------

create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  name        text not null,
  notes       text,
  unique (kitchen_id, name)
);

-- Three unit systems, held apart on purpose:
--   recipe unit  (g)      how a recipe measures it
--   stock unit   (kg)     how it is counted on hand
--   purchase unit (1 kg pack) how a supplier sells it
create table ingredients (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references kitchens(id) on delete cascade,
  name           text not null,
  category       text,
  stock_unit     text not null,               -- kg | L | each | jar | box | bag | pack | loaf
  recipe_unit    text,                        -- how recipes measure it: g | ml | each
  -- Recipe units in one stock unit, where the pair is NOT dimensionally derivable.
  -- g -> kg is derivable; "each" -> kg for eggs is not. Null = derive, or unresolved.
  -- Never assume 1. Rule 8.
  recipe_units_per_stock_unit numeric(14,6),
  pack_size      numeric(12,4),
  pack_unit      text,
  pack_assumed   boolean not null default true, -- true until the owner confirms it
  supplier_id    uuid references suppliers(id) on delete set null,
  price_per_pack numeric(10,2),               -- null = unpriced, never 0 as a stand-in
  previous_price numeric(10,2),
  price_checked  date,
  allergens      text[] default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (kitchen_id, name)
);

-- Every price change kept, so "has beef gone up" is answerable.
create table ingredient_price_history (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references kitchens(id) on delete cascade,
  ingredient_id  uuid not null references ingredients(id) on delete cascade,
  price_per_pack numeric(10,2) not null,
  pack_size      numeric(12,4),
  pack_unit      text,
  supplier_id    uuid references suppliers(id) on delete set null,
  source         text,                        -- 'manual' | 'invoice_scan'
  invoice_id     uuid,
  recorded_at    timestamptz not null default now()
);

create table stock (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references kitchens(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  qty           numeric(12,4) not null default 0,
  unit          text not null,
  use_by        date,
  counted_at    timestamptz not null default now(),
  unique (kitchen_id, ingredient_id)
);

-- ---------- 5. RECIPES ----------

create table recipes (
  id                  uuid primary key default gen_random_uuid(),
  kitchen_id          uuid not null references kitchens(id) on delete cascade,
  name                text not null,
  course              text,                    -- breakfast | main | side | dessert
  yield_type          text not null check (yield_type in ('per_person','batch')),
  portions_per_batch  integer,
  batch_unit          text,                    -- tray | batch | cake
  confidence          text not null default 'confirm'
                        check (confidence in ('locked','confirm','missing')),
  make_ahead_days     integer not null default 0,
  same_day_only       boolean not null default true,
  freezable           boolean not null default false,
  onsite_finish       boolean not null default false,
  method              text,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (kitchen_id, name)
);

-- A line is either a raw ingredient OR another recipe (sub-recipe).
-- qty_min/qty_max carry a genuine range (orange juice 150-200 ml)
-- without pretending it is a single number.
create table recipe_ingredients (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references kitchens(id) on delete cascade,
  recipe_id      uuid not null references recipes(id) on delete cascade,
  ingredient_id  uuid references ingredients(id) on delete restrict,
  sub_recipe_id  uuid references recipes(id) on delete restrict,
  display_name   text not null,
  qty            numeric(12,4),
  qty_min        numeric(12,4),
  qty_max        numeric(12,4),
  unit           text,
  position       integer not null default 0,
  check (ingredient_id is not null or sub_recipe_id is not null),
  check (ingredient_id is null or sub_recipe_id is null)
);

-- Named components with no locked quantity. They appear on the
-- shopping list as "check this yourself", never as a number.
create table recipe_unquantified (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  recipe_id   uuid not null references recipes(id) on delete cascade,
  item        text not null,
  reason      text
);

-- ---------- 6. JOBS ----------

create table jobs (
  id                uuid primary key default gen_random_uuid(),
  kitchen_id        uuid not null references kitchens(id) on delete cascade,
  customer_id       uuid references customers(id) on delete set null,
  property_id       uuid references properties(id) on delete set null,
  job_group         uuid,                      -- links canapes 6pm + dinner 8pm
  service_date      date,
  service_time      time,
  service_type      text,                      -- Buffet | BBQ | Breakfast | ...
  guests            integer,
  guests_confirmed  boolean not null default false,
  -- Owner-set. Null = fall back to meatEatingGuests() in src/engine/rules.ts, which
  -- counts DISTINCT guests flagged excludes_meat rather than summing categories
  -- (Rule 16), and returns null rather than guessing when anything is unresolved.
  meat_eating_guests integer,
  price             numeric(10,2),             -- null until known; never 0 as a stand-in
  price_source      text,                      -- 'manual' | 'rate_card'
  status            text not null default 'enquiry'
                      check (status in ('enquiry','confirmed','in_prep','delivered','invoiced','paid','cancelled')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table job_dishes (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  recipe_id   uuid not null references recipes(id) on delete restrict,
  portions    integer not null default 0,
  note        text,
  position    integer not null default 0
);

-- One row per guest per requirement. There is deliberately NO count column:
-- one guest can be coeliac AND vegetarian, so category counts must never be
-- summed, nor subtracted from the guest count as a total (Rule 16). A count is
-- the operand that makes that arithmetic writable, so there isn't one.
--
-- guest_ref identifies one guest WITHIN one job. It is not a person record —
-- no guest identities are stored. It exists so two requirements can be pinned
-- to the same guest, making a distinct-guest count correct by construction.
--
-- guests_unresolved holds "a few vegetarians": the requirement is recorded, the
-- number is not invented, and shopping stays blocked.
create table job_dietaries (
  id                  uuid primary key default gen_random_uuid(),
  kitchen_id          uuid not null references kitchens(id) on delete cascade,
  job_id              uuid not null references jobs(id) on delete cascade,
  diet_type           text not null,
  severity            text not null default 'moderate'
                        check (severity in ('info','moderate','severe')),
  guest_ref           text,
  -- Owner-set. Never inferred from diet_type — a hardcoded list of which diets
  -- exclude meat would be business data in the app (Rule 1).
  excludes_meat       boolean not null default false,
  guests_unresolved   boolean not null default false,
  unresolved_note     text,                    -- verbatim: "a few vegetarians"
  details             text,
  assigned_recipe_id  uuid references recipes(id) on delete set null,
  -- Mirrors the AllocatedDietary | UnresolvedDietary union in src/engine/types.ts.
  -- An allocated row names its guest; an unresolved one keeps the owner's wording
  -- and no number. Neither can be half-formed.
  constraint job_dietaries_allocation_ck check (
       (guests_unresolved = false and guest_ref       is not null)
    or (guests_unresolved = true  and unresolved_note is not null)
  )
);

-- Rule 11 — extras and surcharges as named line items, never folded into the
-- rate. Per-each with a quantity, matching how they are actually quoted.
create table job_extras (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  label       text not null,
  amount_each numeric(10,2),               -- null = named but unpriced. Rule 8: never 0.
  quantity    integer not null default 1,
  position    integer not null default 0
);

-- Every field-level change, so a corrected eircode leaves a trail.
create table job_changes (
  id           uuid primary key default gen_random_uuid(),
  kitchen_id   uuid not null references kitchens(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  field        text not null,
  old_value    text,
  new_value    text,
  changed_by   uuid references auth.users(id) on delete set null,
  changed_at   timestamptz not null default now(),
  source       text                            -- 'ui' | 'ask_sous' | 'scan'
);

-- ---------- 7. OPERATIONAL STATE ----------
-- Shopping, prep and packing are DERIVED, never stored as lists.
-- Only the owner's ticks are persisted.

create table purchase_state (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references kitchens(id) on delete cascade,
  ingredient_id  uuid not null references ingredients(id) on delete cascade,
  window_from    date not null,
  window_to      date not null,
  qty_bought     numeric(12,4) not null default 0,
  unit           text,
  done           boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (kitchen_id, ingredient_id, window_from, window_to)
);

create table prep_state (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  recipe_id   uuid not null references recipes(id) on delete cascade,
  prep_date   date not null,
  done        boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (kitchen_id, recipe_id, prep_date)
);

create table packing_state (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  item        text not null,
  done        boolean not null default false,
  unique (kitchen_id, job_id, item)
);

-- Owner-defined equipment list per service type. Empty until filled in.
create table service_templates (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references kitchens(id) on delete cascade,
  service_type  text not null,
  item          text not null,
  kind          text not null default 'equipment' check (kind in ('equipment','task')),
  position      integer not null default 0,
  unique (kitchen_id, service_type, item)
);

-- ---------- 8. INVOICES ----------

create table invoices (
  id           uuid primary key default gen_random_uuid(),
  kitchen_id   uuid not null references kitchens(id) on delete cascade,
  supplier_id  uuid references suppliers(id) on delete set null,
  supplier_raw text,
  invoice_date date,
  total        numeric(10,2),
  source       text default 'manual',          -- 'manual' | 'scan'
  created_at   timestamptz not null default now()
);

create table invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references kitchens(id) on delete cascade,
  invoice_id     uuid not null references invoices(id) on delete cascade,
  ingredient_id  uuid references ingredients(id) on delete set null,
  raw_name       text not null,
  qty            numeric(12,4),
  unit           text,
  line_total     numeric(10,2),
  matched        boolean not null default false,
  position       integer not null default 0
);

-- ---------- 9. INDEXES ----------

create index on properties      (kitchen_id);
create index on customers       (kitchen_id);
create index on ingredients     (kitchen_id);
create index on recipes         (kitchen_id);
create index on recipe_ingredients (kitchen_id, recipe_id);
create index on jobs            (kitchen_id, service_date);
create index on job_dishes      (kitchen_id, job_id);
create index on job_dietaries   (kitchen_id, job_id);
create index on job_extras      (kitchen_id, job_id);
create index on job_changes     (kitchen_id, job_id, changed_at desc);
create index on invoice_lines   (kitchen_id, invoice_id);
create index on ingredient_price_history (kitchen_id, ingredient_id, recorded_at desc);

-- ---------- 10. ROW LEVEL SECURITY ----------

do $$
declare t text;
begin
  foreach t in array array[
    'kitchens','kitchen_members','properties','customers','client_rates','suppliers',
    'ingredients','ingredient_price_history','stock','recipes','recipe_ingredients',
    'recipe_unquantified','jobs','job_dishes','job_dietaries','job_extras','job_changes',
    'purchase_state','prep_state','packing_state','service_templates',
    'invoices','invoice_lines'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Kitchen-scoped tables: one policy each, driven by my_kitchen_id().
do $$
declare t text;
begin
  foreach t in array array[
    'properties','customers','client_rates','suppliers','ingredients',
    'ingredient_price_history','stock','recipes','recipe_ingredients',
    'recipe_unquantified','jobs','job_dishes','job_dietaries','job_extras','job_changes',
    'purchase_state','prep_state','packing_state','service_templates',
    'invoices','invoice_lines'
  ]
  loop
    execute format($f$
      create policy %I_rw on %I
        for all
        using (kitchen_id = my_kitchen_id())
        with check (kitchen_id = my_kitchen_id())
    $f$, t || '_rw', t);
  end loop;
end $$;

create policy kitchens_rw on kitchens
  for all using (id = my_kitchen_id()) with check (id = my_kitchen_id());

create policy members_read on kitchen_members
  for select using (kitchen_id = my_kitchen_id());

-- ---------- 11. FIRST RUN ----------
-- Create the kitchen and attach the owner. Replace the email with
-- the account Paul signs up with. Run AFTER he has signed up once.
--
--   insert into kitchens (name) values ('Copper Pot Kitchen')
--     returning id;   -- note the id
--
--   insert into kitchen_members (user_id, kitchen_id, role)
--   select id, '<kitchen-id>', 'owner' from auth.users where email = 'paul@example.com';
--
-- To give a developer support access, repeat with their email and role 'support'.
-- No other data is inserted. The app starts empty by design.
