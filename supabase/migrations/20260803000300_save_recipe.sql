-- Save a recipe and its lines in ONE transaction.
--
-- WHY THIS EXISTS
-- A recipe spans three tables: recipes, recipe_ingredients, recipe_unquantified.
-- supabase-js has no transactions, so saving from the client means delete the old
-- children, then insert the new ones. A failure between those two leaves a recipe
-- with NO components at all.
--
-- That is worse than it sounds. scaleRecipe on a component-less recipe returns
-- empty lines and NO gaps, so it would contribute silently nothing to a shopping
-- list — the exact silent under-ordering this repo is built to prevent. A
-- function runs in a single implicit transaction, so either every write lands or
-- none does.
--
-- SECURITY INVOKER, DELIBERATELY
-- This runs as the CALLER, so RLS still applies: the same my_kitchen_id() policy
-- the integration suite proved works. A `security definer` function here would
-- quietly bypass it, which is how an audited, scoped system grows a hole.
--
-- The kitchen is resolved from my_kitchen_id() rather than trusted from the
-- payload, so a client cannot write into another kitchen even by mistake.

create or replace function save_recipe(
  p_recipe       jsonb,
  p_components   jsonb default '[]'::jsonb,
  p_unquantified jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kitchen uuid := my_kitchen_id();
  v_id      uuid := nullif(p_recipe->>'id', '')::uuid;
begin
  if v_kitchen is null then
    raise exception 'no kitchen for this user';
  end if;

  if v_id is null then
    insert into recipes (
      kitchen_id, name, course, yield_type, portions_per_batch, batch_unit,
      confidence, make_ahead_days, same_day_only, freezable, onsite_finish, method, note
    ) values (
      v_kitchen,
      p_recipe->>'name',
      nullif(p_recipe->>'course', ''),
      p_recipe->>'yield_type',
      (nullif(p_recipe->>'portions_per_batch', ''))::integer,
      nullif(p_recipe->>'batch_unit', ''),
      coalesce(nullif(p_recipe->>'confidence', ''), 'confirm'),
      coalesce((nullif(p_recipe->>'make_ahead_days', ''))::integer, 0),
      coalesce((p_recipe->>'same_day_only')::boolean, true),
      coalesce((p_recipe->>'freezable')::boolean, false),
      coalesce((p_recipe->>'onsite_finish')::boolean, false),
      nullif(p_recipe->>'method', ''),
      nullif(p_recipe->>'note', '')
    ) returning id into v_id;
  else
    update recipes set
      name               = p_recipe->>'name',
      course             = nullif(p_recipe->>'course', ''),
      yield_type         = p_recipe->>'yield_type',
      portions_per_batch = (nullif(p_recipe->>'portions_per_batch', ''))::integer,
      batch_unit         = nullif(p_recipe->>'batch_unit', ''),
      confidence         = coalesce(nullif(p_recipe->>'confidence', ''), 'confirm'),
      make_ahead_days    = coalesce((nullif(p_recipe->>'make_ahead_days', ''))::integer, 0),
      same_day_only      = coalesce((p_recipe->>'same_day_only')::boolean, true),
      freezable          = coalesce((p_recipe->>'freezable')::boolean, false),
      onsite_finish      = coalesce((p_recipe->>'onsite_finish')::boolean, false),
      method             = nullif(p_recipe->>'method', ''),
      note               = nullif(p_recipe->>'note', ''),
      updated_at         = now()
    where id = v_id;

    -- RLS already scopes this, so no row means the caller may not see it.
    if not found then
      raise exception 'recipe % not found in this kitchen', v_id;
    end if;
  end if;

  -- Replace the lines wholesale. Safe here in a way it is not from the client:
  -- if any insert below fails, the delete rolls back with it.
  delete from recipe_ingredients where recipe_id = v_id;
  delete from recipe_unquantified where recipe_id = v_id;

  insert into recipe_ingredients (
    kitchen_id, recipe_id, ingredient_id, sub_recipe_id, display_name, qty, unit, position
  )
  select
    v_kitchen, v_id,
    nullif(c->>'ingredient_id', '')::uuid,
    nullif(c->>'sub_recipe_id', '')::uuid,
    c->>'display_name',
    -- Rule 13: ONE number. qty_min and qty_max are never written here; there is
    -- no range in the domain and picking an end of one would invent owner data.
    (nullif(c->>'qty', ''))::numeric,
    nullif(c->>'unit', ''),
    coalesce((c->>'position')::integer, 0)
  from jsonb_array_elements(p_components) as c;

  insert into recipe_unquantified (kitchen_id, recipe_id, item, reason)
  select v_kitchen, v_id, u->>'item', nullif(u->>'reason', '')
  from jsonb_array_elements(p_unquantified) as u;

  return v_id;
end $$;
