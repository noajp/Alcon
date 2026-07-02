-- Enforce the Space > Domain > Object > Element boundary in row-level security.
--
-- BEFORE this migration, SELECT on domains/objects and full access on
-- elements/element_objects were open to ANY authenticated user — the
-- membership boundary lived only in client code, so the API leaked every
-- org's data. This wires the existing SECURITY DEFINER membership helpers
-- into RLS so the server enforces visibility:
--
--   Domain  visible  ⇔ creator OR domain_member
--                       OR (privacy='workspace' AND Space member)
--   Object  visible  ⇔ object_member OR any of its Domains visible
--   Element visible  ⇔ owner OR any Object it belongs to is visible
--                       OR it is an unscoped Domain-direct element (object_id &
--                       owner_id both null — a pre-existing global bucket that
--                       has no Domain FK to gate on; left broad until elements
--                       gain a Domain scope column)
--
-- Two subtleties baked into the shapes below:
--   * SELECT policies must reference the ROW'S OWN COLUMNS, not re-query the
--     same table through a helper — INSERT .. RETURNING evaluates the SELECT
--     policy against a statement snapshot in which the new row doesn't exist
--     yet, so a self-table helper (user_can_see_domain(id) on domains) fails
--     every insert that returns data. Helpers are fine when they look at a
--     *different* (pre-existing) table: user_can_see_domain(domain_id) inside
--     the objects policy, user_can_see_object(object_id) inside elements.
--   * Helpers are SECURITY DEFINER, so they bypass RLS internally and cannot
--     recurse into these policies.
--
-- user_can_see_domain/_object/_element are also the single source of truth
-- for RPC-level filtering (see explorer_visibility migration).
--
-- Guarded so a preview branch replaying on an empty DB is a no-op.

do $mig$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.elements') is null then
    raise notice 'boundary RLS skipped: base tables absent (preview replay?)';
    return;
  end if;

  -- ── visibility helpers (for RPCs and cross-table policies) ───────────────
  execute $fn$
    create or replace function public.user_can_see_domain(_domain_id uuid)
    returns boolean language sql stable security definer set search_path = public as $body$
      select exists (
        select 1 from domains d
        where d.id = _domain_id
          and (
            d.user_id = auth.uid()
            or public.user_is_domain_member(d.id)
            or (d.privacy = 'workspace'
                and d.activity_space_id is not null
                and public.is_activity_space_member(d.activity_space_id))
          )
      );
    $body$;
  $fn$;

  execute $fn$
    create or replace function public.user_can_see_object(_object_id uuid)
    returns boolean language sql stable security definer set search_path = public as $body$
      select
        public.user_is_object_member(_object_id)
        or exists (select 1 from objects o
                   where o.id = _object_id and o.domain_id is not null
                     and public.user_can_see_domain(o.domain_id))
        or exists (select 1 from object_domains od
                   where od.object_id = _object_id
                     and public.user_can_see_domain(od.domain_id));
    $body$;
  $fn$;

  execute $fn$
    create or replace function public.user_can_see_element(_element_id uuid)
    returns boolean language sql stable security definer set search_path = public as $body$
      select
        exists (
          select 1 from elements e
          where e.id = _element_id
            and (
              e.owner_id = auth.uid()
              or (e.object_id is not null and public.user_can_see_object(e.object_id))
              or (e.object_id is null and e.owner_id is null
                  and not exists (select 1 from element_objects eo where eo.element_id = e.id))
            )
        )
        or exists (
          select 1 from element_objects eo
          where eo.element_id = _element_id and public.user_can_see_object(eo.object_id)
        );
    $body$;
  $fn$;

  -- ── domains: SELECT gated by visibility (insert/update/delete unchanged) ──
  drop policy if exists "domains select authenticated" on public.domains;
  drop policy if exists "domains select visible" on public.domains;
  create policy "domains select visible" on public.domains
    for select using (
      user_id = auth.uid()
      or public.user_is_domain_member(id)
      or (privacy = 'workspace'
          and activity_space_id is not null
          and public.is_activity_space_member(activity_space_id))
    );

  -- ── objects: SELECT gated by visibility (insert/update/delete unchanged) ──
  drop policy if exists "objects select authenticated" on public.objects;
  drop policy if exists "objects select visible" on public.objects;
  create policy "objects select visible" on public.objects
    for select using (
      public.user_is_object_member(id)
      or (domain_id is not null and public.user_can_see_domain(domain_id))
      or exists (select 1 from public.object_domains od
                 where od.object_id = objects.id and public.user_can_see_domain(od.domain_id))
    );

  -- ── elements: replace the single ALL policy with granular gated policies ──
  drop policy if exists "Authenticated full access" on public.elements;
  drop policy if exists "elements select visible" on public.elements;
  create policy "elements select visible" on public.elements
    for select using (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_see_object(object_id))
      or exists (select 1 from public.element_objects eo
                 where eo.element_id = elements.id and public.user_can_see_object(eo.object_id))
      or (object_id is null and owner_id is null
          and not exists (select 1 from public.element_objects eo where eo.element_id = elements.id))
    );
  drop policy if exists "elements insert allowed" on public.elements;
  create policy "elements insert allowed" on public.elements
    for insert with check (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_see_object(object_id))
      or (object_id is null and owner_id is null)   -- Domain-direct bucket
    );
  drop policy if exists "elements update visible" on public.elements;
  create policy "elements update visible" on public.elements
    for update using (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_see_object(object_id))
      or exists (select 1 from public.element_objects eo
                 where eo.element_id = elements.id and public.user_can_see_object(eo.object_id))
      or (object_id is null and owner_id is null
          and not exists (select 1 from public.element_objects eo where eo.element_id = elements.id))
    )
    with check (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_see_object(object_id))
      or (object_id is null and owner_id is null)
    );
  drop policy if exists "elements delete visible" on public.elements;
  create policy "elements delete visible" on public.elements
    for delete using (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_see_object(object_id))
      or exists (select 1 from public.element_objects eo
                 where eo.element_id = elements.id and public.user_can_see_object(eo.object_id))
      or (object_id is null and owner_id is null
          and not exists (select 1 from public.element_objects eo where eo.element_id = elements.id))
    );

  -- ── element_objects: junction follows the visibility of its Object ────────
  drop policy if exists "Authenticated full access" on public.element_objects;
  drop policy if exists "element_objects via visible object" on public.element_objects;
  create policy "element_objects via visible object" on public.element_objects
    for all using (public.user_can_see_object(object_id))
        with check (public.user_can_see_object(object_id));
end
$mig$;
