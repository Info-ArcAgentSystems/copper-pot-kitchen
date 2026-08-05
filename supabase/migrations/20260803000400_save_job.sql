-- Save a job and its dishes, dietaries and extras in ONE transaction.
--
-- WHY, beyond the obvious
-- A job spans four tables and supabase-js has no transactions. A partial save
-- would leave a half-edited job, but the worse consequence is the audit trail:
-- the triggers on job_dishes, job_dietaries and job_extras fire per statement, so
-- four separate round trips record one edit as several unrelated changes. Rules
-- 10 and 14 want the trail to read like what actually happened.
--
-- Inside one transaction the triggers still fire — every change is still logged —
-- but they land together, and a failure rolls the whole edit back rather than
-- leaving a trail of an edit that only half happened.
--
-- SECURITY INVOKER, DELIBERATELY: this runs as the caller so RLS still applies,
-- and auth.uid() inside the triggers is still the real user. A `security definer`
-- function here would both bypass the policy and attribute every change to the
-- function owner.
--
-- kitchen_id comes from my_kitchen_id(), never from the payload, so a forged id
-- cannot redirect the write.

create or replace function save_job(
  p_job        jsonb,
  p_dishes     jsonb default '[]'::jsonb,
  p_dietaries  jsonb default '[]'::jsonb,
  p_extras     jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kitchen uuid := my_kitchen_id();
  v_id      uuid := nullif(p_job->>'id', '')::uuid;
begin
  if v_kitchen is null then
    raise exception 'no kitchen for this user';
  end if;

  if v_id is null then
    insert into jobs (
      kitchen_id, customer_id, property_id, job_group, service_date, service_time,
      service_type, guests, guests_confirmed, meat_eating_guests, price, price_source,
      status, notes
    ) values (
      v_kitchen,
      nullif(p_job->>'customer_id', '')::uuid,
      nullif(p_job->>'property_id', '')::uuid,
      nullif(p_job->>'job_group', '')::uuid,
      nullif(p_job->>'service_date', '')::date,
      nullif(p_job->>'service_time', '')::time,
      nullif(p_job->>'service_type', ''),
      -- Rule 8: a guest count is null, never a guess and never 0.
      (nullif(p_job->>'guests', ''))::integer,
      coalesce((p_job->>'guests_confirmed')::boolean, false),
      (nullif(p_job->>'meat_eating_guests', ''))::integer,
      (nullif(p_job->>'price', ''))::numeric,
      nullif(p_job->>'price_source', ''),
      coalesce(nullif(p_job->>'status', ''), 'enquiry'),
      nullif(p_job->>'notes', '')
    ) returning id into v_id;
  else
    -- Rule 15: status is a state, not a lock. A completed or cancelled job stays
    -- correctable; the jobs_audit trigger logs the correction like any other.
    update jobs set
      customer_id        = nullif(p_job->>'customer_id', '')::uuid,
      property_id        = nullif(p_job->>'property_id', '')::uuid,
      job_group          = nullif(p_job->>'job_group', '')::uuid,
      service_date       = nullif(p_job->>'service_date', '')::date,
      service_time       = nullif(p_job->>'service_time', '')::time,
      service_type       = nullif(p_job->>'service_type', ''),
      guests             = (nullif(p_job->>'guests', ''))::integer,
      guests_confirmed   = coalesce((p_job->>'guests_confirmed')::boolean, false),
      meat_eating_guests = (nullif(p_job->>'meat_eating_guests', ''))::integer,
      price              = (nullif(p_job->>'price', ''))::numeric,
      price_source       = nullif(p_job->>'price_source', ''),
      status             = coalesce(nullif(p_job->>'status', ''), 'enquiry'),
      notes              = nullif(p_job->>'notes', ''),
      updated_at         = now()
    where id = v_id;

    if not found then
      raise exception 'job % not found in this kitchen', v_id;
    end if;
  end if;

  -- Replace the children wholesale. Safe here in a way it is not from the client:
  -- if any insert below fails, the deletes roll back with it.
  delete from job_dishes    where job_id = v_id;
  delete from job_dietaries where job_id = v_id;
  delete from job_extras    where job_id = v_id;

  insert into job_dishes (kitchen_id, job_id, recipe_id, portions, note, position)
  select
    v_kitchen, v_id,
    (d->>'recipe_id')::uuid,
    -- Null portions is meaningful: applyBuffetSplit derives them from the guest
    -- count. A zero here would mean "make none of this dish".
    (nullif(d->>'portions', ''))::integer,
    nullif(d->>'note', ''),
    coalesce((d->>'position')::integer, 0)
  from jsonb_array_elements(p_dishes) as d;

  -- Rule 16: no count column exists, and none is written. An allocated dietary
  -- names ONE guest; two guests with the same requirement are two rows.
  insert into job_dietaries (
    kitchen_id, job_id, diet_type, severity, guest_ref, excludes_meat,
    guests_unresolved, unresolved_note, details, assigned_recipe_id
  )
  select
    v_kitchen, v_id,
    x->>'diet_type',
    coalesce(nullif(x->>'severity', ''), 'moderate'),
    nullif(x->>'guest_ref', ''),
    coalesce((x->>'excludes_meat')::boolean, false),
    coalesce((x->>'guests_unresolved')::boolean, false),
    -- Rule 12: the owner's wording, verbatim, never parsed into a number.
    nullif(x->>'unresolved_note', ''),
    nullif(x->>'details', ''),
    nullif(x->>'assigned_recipe_id', '')::uuid
  from jsonb_array_elements(p_dietaries) as x;

  insert into job_extras (kitchen_id, job_id, label, amount_each, quantity, position)
  select
    v_kitchen, v_id,
    e->>'label',
    -- Rule 8 again: a named but unpriced extra is null, which makes revenue null
    -- rather than silently free.
    (nullif(e->>'amount_each', ''))::numeric,
    coalesce((e->>'quantity')::integer, 1),
    coalesce((e->>'position')::integer, 0)
  from jsonb_array_elements(p_extras) as e;

  return v_id;
end $$;
