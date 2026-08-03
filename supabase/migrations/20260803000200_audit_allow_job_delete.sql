-- Fix: the child audit triggers make it impossible to delete a job.
--
-- THE DEFECT
-- `delete from jobs where id = ...` cascades to job_dishes, job_dietaries and
-- job_extras. Their AFTER DELETE trigger then inserts a row into job_changes
-- carrying the job_id — but the jobs row has already gone in the same statement,
-- so `job_changes_job_id_fkey` rejects the insert and the whole delete fails:
--
--   insert or update on table "job_changes" violates foreign key constraint
--   "job_changes_job_id_fkey"
--
-- A job with no children deletes fine; a job with a single dish cannot be deleted
-- at all. CLAUDE.md section 4 lists "Jobs — create, edit, delete (with confirm)"
-- as a shipping feature, so this would have surfaced the first time the owner
-- tried to remove a mistaken booking.
--
-- Found by an integration-test cleanup step that verified its own work instead of
-- assuming it, on the first run where the triggers were exercised end to end.
--
-- THE FIX
-- When the parent job no longer exists, the child change is not a meaningful
-- event to record: the job itself is going, and every job_changes row for it is
-- cascading away at the same moment. So the trigger returns without logging.
--
-- This does not weaken Rules 10 or 14. Every change to a LIVING job is still
-- logged, including a dish removed from a job that stays. What is skipped is only
-- the bookkeeping of a child disappearing because its parent did.

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
    -- The parent job is being deleted too: there is nothing to attach an entry
    -- to, and the job's existing job_changes rows are cascading away regardless.
    if not exists (select 1 from jobs where id = v_job) then
      return old;
    end if;

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
