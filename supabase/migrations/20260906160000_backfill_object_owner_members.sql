-- Backfill object_members for Objects created before createObject() started
-- auto-enrolling its creator as 'owner'.
--
-- Why this is a bug and not just missing data: the RLS pair on `objects` is
-- deliberately asymmetric — SELECT allows object membership OR domain
-- visibility, while UPDATE requires `user_is_object_member(id)` alone. An
-- Object with no member rows is therefore visible to everyone who can see
-- its Domain and writable by nobody. Every updateObject() against one fails
-- with PGRST116 (0 rows returned by .select().single()), which surfaces as
-- a silent no-op in the UI — linking a Note, renaming, setting a lead.
--
-- Only rows whose creator is known are backfilled. Objects seeded straight
-- through SQL (the exercise domains) have no user_id, so there is nobody to
-- promote; those need a separate decision about who owns them, and widening
-- the UPDATE policy to domain members would be a permission-boundary change,
-- not a backfill.
--
-- Idempotent: re-running inserts nothing. Guarded for preview/shadow-DB
-- replay, where the base schema doesn't exist.
do $$
begin
  if to_regclass('public.objects') is null or to_regclass('public.object_members') is null then
    raise notice 'object_members backfill skipped: tables not present';
    return;
  end if;
  execute $sql$
    insert into public.object_members (object_id, user_id, role)
    select o.id, o.user_id, 'owner'
      from public.objects o
     where o.user_id is not null
       and not exists (
             select 1 from public.object_members m
              where m.object_id = o.id and m.user_id = o.user_id
           )
  $sql$;
end
$$;
