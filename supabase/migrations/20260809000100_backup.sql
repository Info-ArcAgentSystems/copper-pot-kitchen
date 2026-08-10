-- Clear a kitchen, and restore one from a backup.
--
-- WHY THESE ARE FUNCTIONS AND NOT CLIENT CODE
--
-- Two reasons, and the second is the one that matters.
--
--   1. supabase-js has no transactions. An import is a delete followed by twenty
--      inserts, and a failure halfway through leaves the kitchen holding neither
--      the backup nor what was there before. That is worse than no import at all,
--      because the owner reaches for a backup precisely when he cannot afford a
--      third outcome. Inside one function the whole thing rolls back.
--
--   2. Deleting every row for a kitchen from the client would mean naming
--      kitchen_id in a filter, which no repository does — RLS is the single
--      definition of scope, and `tests/data/purity.test.ts` enforces that. Here,
--      my_kitchen_id() IS that definition.
--
-- SECURITY INVOKER, deliberately: RLS still applies, so neither function can touch
-- another kitchen even if someone found a way to call it.

-- ---------------------------------------------------------------------------
-- clear_kitchen
-- ---------------------------------------------------------------------------

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
  delete from service_templates where kitchen_id = v_kitchen;
  delete from customers         where kitchen_id = v_kitchen;
  delete from properties        where kitchen_id = v_kitchen;
  delete from suppliers         where kitchen_id = v_kitchen;

  -- The kitchen row and its members are NOT touched. A restore fills an existing
  -- kitchen; it does not create one, and it never rewrites who may see it
  -- (Rule 17 — access is granted per person, not restored from a file).

  return v_counts;
end $$;

-- ---------------------------------------------------------------------------
-- import_kitchen
-- ---------------------------------------------------------------------------

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
    'suppliers', 'properties', 'customers', 'client_rates', 'service_templates',
    'ingredients', 'ingredient_price_history', 'stock',
    'recipes', 'recipe_ingredients', 'recipe_unquantified',
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

  return v_written;
end $$;
