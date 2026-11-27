-- CLIENT GROUPS — the one place a group is named.
--
-- A rate is found by (client group, service type) and a customer carries a
-- group. Until now the group was only ever a string typed on the rate card,
-- so Paul could not set up "Holiday rentals" before writing its first rate.
-- This table owns the names; the Rate card and Customers pick from it.
--
-- Customers and rates keep their group AS TEXT, as before. Rates already match
-- on letters and digits (rateFor); a foreign key would mean rewriting every
-- price lookup, backup and import for no gain at one user's scale. The text
-- is kept true instead, structurally:
--   - names are unique on letters and digits ("Priority" / "priority." clash)
--   - rename_client_group() renames the group AND every customer and rate using
--     it, in one transaction
--   - delete_client_group() refuses while anything still uses it

create or replace function client_group_key(p text)
returns text
language sql
immutable
as $$ select lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]]', '', 'g')) $$;

create table client_groups (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references kitchens(id) on delete cascade,
  name        text not null check (client_group_key(name) <> ''),
  created_at  timestamptz not null default now()
);

create unique index client_groups_kitchen_key
  on client_groups (kitchen_id, client_group_key(name));

alter table client_groups enable row level security;

create policy client_groups_rw on client_groups
  for all
  using (kitchen_id = my_kitchen_id())
  with check (kitchen_id = my_kitchen_id());


-- Every group already in use, once each (first spelling wins), for one kitchen.
-- Used by this migration and after a restore from an older backup.
create or replace function backfill_client_groups(p_kitchen uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into client_groups (kitchen_id, name)
  select p_kitchen, min(btrim(g))
  from (
    select client_group as g from customers    where kitchen_id = p_kitchen and client_group is not null
    union all
    select client_group as g from client_rates where kitchen_id = p_kitchen and client_group is not null
  ) used
  where client_group_key(g) <> ''
  group by client_group_key(g)
  on conflict (kitchen_id, client_group_key(name)) do nothing;
$$;

do $$
declare k uuid;
begin
  for k in select id from kitchens loop
    perform backfill_client_groups(k);
  end loop;
end $$;


-- Rename a group and everything that names it, together or not at all.
create or replace function rename_client_group(p_id uuid, p_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kitchen uuid := my_kitchen_id();
  v_new     text := btrim(coalesce(p_name, ''));
  v_old     text;
begin
  if v_kitchen is null then
    raise exception 'no kitchen for this user';
  end if;
  if client_group_key(v_new) = '' then
    raise exception 'a client group needs a name with letters or numbers';
  end if;

  select name into v_old from client_groups
  where id = p_id and kitchen_id = v_kitchen
  for update;
  if not found then
    raise exception 'that client group no longer exists';
  end if;

  -- The unique index refuses a name another group already has.
  update client_groups set name = v_new where id = p_id;

  update customers set client_group = v_new
  where kitchen_id = v_kitchen and client_group_key(client_group) = client_group_key(v_old);

  update client_rates set client_group = v_new
  where kitchen_id = v_kitchen and client_group_key(client_group) = client_group_key(v_old);
end $$;


-- Delete a group only when nothing names it — checked here, not just on screen.
create or replace function delete_client_group(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kitchen   uuid := my_kitchen_id();
  v_name      text;
  v_customers integer;
  v_rates     integer;
begin
  if v_kitchen is null then
    raise exception 'no kitchen for this user';
  end if;

  select name into v_name from client_groups where id = p_id and kitchen_id = v_kitchen;
  if not found then
    return;
  end if;

  select count(*) into v_customers from customers
  where kitchen_id = v_kitchen and client_group_key(client_group) = client_group_key(v_name);
  select count(*) into v_rates from client_rates
  where kitchen_id = v_kitchen and client_group_key(client_group) = client_group_key(v_name);

  if v_customers + v_rates > 0 then
    raise exception '% is still used by % customer(s) and % rate(s) — move them to another group first',
      v_name, v_customers, v_rates;
  end if;

  delete from client_groups where id = p_id;
end $$;


-- clear_kitchen and import_kitchen re-created to include client_groups.

create or replace function clear_kitchen()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kitchen uuid := my_kitchen_id();
  v_counts  jsonb;
begin
  if v_kitchen is null then
    raise exception 'no kitchen for this user';
  end if;

  -- What was destroyed, returned so the app can report it rather than claiming
  -- success blindly.
  select jsonb_build_object(
    'jobs',        (select count(*) from jobs        where kitchen_id = v_kitchen),
    'recipes',     (select count(*) from recipes     where kitchen_id = v_kitchen),
    'ingredients', (select count(*) from ingredients where kitchen_id = v_kitchen),
    'customers',   (select count(*) from customers   where kitchen_id = v_kitchen)
  ) into v_counts;

  -- ORDER IS THE WHOLE DIFFICULTY.
  --
  -- Three `on delete restrict` edges point backwards, so a parent cannot go until
  -- the children referencing it are gone:
  --
  --   job_dishes.recipe_id            -> recipes
  --   recipe_ingredients.ingredient_id -> ingredients
  --   recipe_ingredients.sub_recipe_id -> recipes
  --
  -- The sub_recipe_id edge is the awkward one: recipes reference each other, so
  -- `delete from recipes` alone can fail on its own children. The lines go first,
  -- explicitly, rather than relying on cascade to resolve a cycle it cannot see.
  --
  -- This is the same ordering that broke the integration cleanup when it was
  -- guessed at rather than worked out.

  -- 1. Jobs first — frees every recipe referenced by a dish.
  delete from job_changes   where kitchen_id = v_kitchen;
  delete from jobs          where kitchen_id = v_kitchen;

  -- 2. Recipe lines before recipes, breaking the sub-recipe references.
  delete from recipe_ingredients  where kitchen_id = v_kitchen;
  delete from recipe_unquantified where kitchen_id = v_kitchen;
  delete from menu_templates      where kitchen_id = v_kitchen;  -- restricts recipes
  delete from prep_state          where kitchen_id = v_kitchen;
  delete from recipes             where kitchen_id = v_kitchen;

  -- 3. Now nothing points at an ingredient.
  delete from ingredient_price_history where kitchen_id = v_kitchen;
  delete from purchase_state           where kitchen_id = v_kitchen;
  delete from stock                    where kitchen_id = v_kitchen;
  delete from ingredients              where kitchen_id = v_kitchen;

  -- 4. The rest, which nothing restricts.
  delete from invoice_lines     where kitchen_id = v_kitchen;
  delete from invoices          where kitchen_id = v_kitchen;
  delete from client_rates      where kitchen_id = v_kitchen;
  delete from client_groups     where kitchen_id = v_kitchen;
  delete from service_templates where kitchen_id = v_kitchen;
  delete from customers         where kitchen_id = v_kitchen;
  delete from properties        where kitchen_id = v_kitchen;
  delete from suppliers         where kitchen_id = v_kitchen;

  -- The kitchen row and its members are NOT touched. A restore fills an existing
  -- kitchen; it does not create one, and it never rewrites who may see it
  -- (Rule 17 — access is granted per person, not restored from a file).

  return v_counts;
end $$;

create or replace function import_kitchen(p_backup jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kitchen uuid := my_kitchen_id();
  v_table   text;
  v_rows    jsonb;
  v_written jsonb := '{}'::jsonb;
  v_count   integer;

  -- Insert order: parents before children, so no foreign key is ever deferred.
  --
  -- job_changes is DELIBERATELY ABSENT and must stay absent. It is exported —
  -- it is the owner's history — but writing it back would forge audit rows with
  -- a changed_by that no longer means anything. Rule 10: the trail is not
  -- optional, and a trail that can be written from a file is not a trail.
  v_order text[] := array[
    'suppliers', 'properties', 'client_groups', 'customers', 'client_rates', 'service_templates',
    'ingredients', 'ingredient_price_history', 'stock',
    'recipes', 'recipe_ingredients', 'recipe_unquantified', 'menu_templates',
    'jobs', 'job_dishes', 'job_dietaries', 'job_extras',
    'purchase_state', 'prep_state', 'packing_state'
  ];
begin
  if v_kitchen is null then
    raise exception 'no kitchen for this user';
  end if;

  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'backup payload must be an object';
  end if;

  -- Refuse anything unrecognised BEFORE deleting a single row. The client
  -- validates too, but the client is not the last line of defence: restoring part
  -- of a file and reporting success is the failure that would cost the most.
  for v_table in select jsonb_object_keys(p_backup) loop
    if not (v_table = any(v_order)) then
      raise exception 'backup contains unknown table "%" — refusing to import part of it', v_table;
    end if;
  end loop;

  -- Everything from here is inside this function's transaction, so a failure at
  -- any point leaves the kitchen exactly as it was.
  perform clear_kitchen();

  foreach v_table in array v_order loop
    v_rows := p_backup -> v_table;
    if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
      continue;
    end if;

    -- kitchen_id is FORCED to the caller's own, overwriting whatever the file
    -- says. A backup taken from another kitchen, or an edited file, cannot
    -- redirect the write.
    execute format(
      'insert into %I select * from jsonb_populate_recordset(null::%I, $1)',
      v_table, v_table
    ) using (
      select coalesce(jsonb_agg(row || jsonb_build_object('kitchen_id', v_kitchen)), '[]'::jsonb)
      from jsonb_array_elements(v_rows) as row
    );

    get diagnostics v_count = row_count;
    v_written := v_written || jsonb_build_object(v_table, v_count);
  end loop;

  -- A backup taken before client groups existed has none, but its customers and
  -- rates still name groups. Rebuild the list from them, so the dropdowns are not
  -- left empty after a restore. Same carry-over as the migration's own backfill.
  perform backfill_client_groups(v_kitchen);

  return v_written;
end $$;
