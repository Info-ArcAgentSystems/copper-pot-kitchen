-- Rules 10 and 14 — every meaningful change to a job, menu, dietary or price is
-- logged, with who, when, old and new.
--
-- WHY A TRIGGER AND NOT REPOSITORY CODE
-- Repository code cannot be unbypassable: anything importing the Supabase client
-- skips it, and so does the SQL editor. A trigger cannot be bypassed, and it is
-- atomic — there is no window in which a change lands unlogged because the second
-- of two round trips failed.
--
-- ON `source`
-- The trigger reads a transaction-local setting and falls back to 'ui'. PostgREST
-- runs each request in its own transaction, so a separate set_config() call from
-- the client does NOT carry into the following statement. Writes that must be
-- attributed to 'ask_sous' or 'scan' therefore have to go through an RPC that sets
-- the value and performs the write in one transaction. Until those RPCs exist,
-- everything logs as 'ui'. Recorded in ARCHITECTURE.md as a known gap.

create or replace function app_change_source() returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.source', true), ''), 'ui');
$$;

-- ---------- jobs: one row per CHANGED FIELD ----------
--
-- Fields are compared explicitly rather than by diffing to_jsonb, so `updated_at`
-- and other bookkeeping columns never generate audit noise. Rule 14 is explicit
-- that "meaningful" excludes UI state.

create or replace function log_jobs_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_source text := app_change_source();
begin
  if new.customer_id is distinct from old.customer_id then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'customer_id', old.customer_id::text, new.customer_id::text, v_actor, v_source);
  end if;

  if new.property_id is distinct from old.property_id then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'property_id', old.property_id::text, new.property_id::text, v_actor, v_source);
  end if;

  if new.service_date is distinct from old.service_date then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'service_date', old.service_date::text, new.service_date::text, v_actor, v_source);
  end if;

  if new.service_time is distinct from old.service_time then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'service_time', old.service_time::text, new.service_time::text, v_actor, v_source);
  end if;

  if new.service_type is distinct from old.service_type then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'service_type', old.service_type, new.service_type, v_actor, v_source);
  end if;

  if new.guests is distinct from old.guests then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'guests', old.guests::text, new.guests::text, v_actor, v_source);
  end if;

  if new.guests_confirmed is distinct from old.guests_confirmed then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'guests_confirmed', old.guests_confirmed::text, new.guests_confirmed::text, v_actor, v_source);
  end if;

  if new.meat_eating_guests is distinct from old.meat_eating_guests then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'meat_eating_guests', old.meat_eating_guests::text, new.meat_eating_guests::text, v_actor, v_source);
  end if;

  -- Rule 11: an override is recorded AS an override, not as an ordinary edit.
  if new.price is distinct from old.price then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (
      new.kitchen_id, new.id,
      case when new.price_source = 'manual' then 'price_override' else 'price' end,
      old.price::text, new.price::text, v_actor, v_source
    );
  end if;

  if new.price_source is distinct from old.price_source then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'price_source', old.price_source, new.price_source, v_actor, v_source);
  end if;

  if new.status is distinct from old.status then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'status', old.status, new.status, v_actor, v_source);
  end if;

  if new.notes is distinct from old.notes then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (new.kitchen_id, new.id, 'notes', old.notes, new.notes, v_actor, v_source);
  end if;

  return new;
end $$;

create trigger jobs_audit
  after update on jobs
  for each row execute function log_jobs_change();

-- ---------- menu, dietaries and extras ----------
--
-- These have no bookkeeping columns, so a whole-row comparison is safe here and
-- keeps the trigger short. A dish added or removed is a meaningful change to the
-- menu under Rule 14.

create or replace function log_job_child_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_source  text := app_change_source();
  v_kitchen uuid := coalesce(new.kitchen_id, old.kitchen_id);
  v_job     uuid := coalesce(new.job_id, old.job_id);
begin
  if tg_op = 'INSERT' then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (v_kitchen, v_job, tg_table_name || '.added', null, to_jsonb(new)::text, v_actor, v_source);
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (v_kitchen, v_job, tg_table_name || '.removed', to_jsonb(old)::text, null, v_actor, v_source);
    return old;
  end if;

  if to_jsonb(new) is distinct from to_jsonb(old) then
    insert into job_changes (kitchen_id, job_id, field, old_value, new_value, changed_by, source)
    values (v_kitchen, v_job, tg_table_name || '.changed', to_jsonb(old)::text, to_jsonb(new)::text, v_actor, v_source);
  end if;

  return new;
end $$;

create trigger job_dishes_audit
  after insert or update or delete on job_dishes
  for each row execute function log_job_child_change();

create trigger job_dietaries_audit
  after insert or update or delete on job_dietaries
  for each row execute function log_job_child_change();

create trigger job_extras_audit
  after insert or update or delete on job_extras
  for each row execute function log_job_child_change();
