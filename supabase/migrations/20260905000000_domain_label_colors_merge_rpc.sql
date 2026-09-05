-- domains.label_colors has two independent writers: Settings > Elements >
-- Labels (bulk rename/delete/recolor, ELE_QLT-027) and an Element detail
-- panel's inline colour pick (ElementDetailView.tsx). Both did
-- read-then-merge-then-write on the client — Settings by replacing the
-- whole jsonb column with a snapshot it read at page load, the detail
-- panel by reading, merging one key, and writing the result back. Either
-- one landing between the other's read and write throws the other's pick
-- away silently: no error, no conflict, just a colour that reverts itself
-- (ELE_QLT-032).
--
-- The fix is the same one Postgres offers for any "add this key to a jsonb
-- column" problem: do it in the database, in one statement, so there is no
-- read to go stale. `label_colors || p_set` layers the new/changed keys on
-- without needing to have read the old ones first; `- p_remove` (Postgres's
-- jsonb-minus-text[] operator) drops renamed-away or deleted keys in the
-- same statement. A concurrent caller doing the same never has a window to
-- race in — Postgres's own row lock during the UPDATE serializes them, and
-- each one's own keys are unaffected by what the other touches.
--
-- security invoker (the implicit default, named for clarity): this doesn't
-- need to bypass anything, since the caller already has whatever
-- permission plain UPDATE on domains would require — the RLS UPDATE policy
-- on `domains` applies exactly as it would to `supabase.from('domains').
-- update(...)`, so this is a correctness fix for the race, not a change in
-- who can move a Domain's colours. search_path is still pinned, matching
-- every other function in this file's neighbourhood, as cheap insurance
-- against a caller-controlled search_path regardless of definer/invoker.
do $migration$
begin
  if to_regclass('public.domains') is null then
    raise notice 'domain_label_colors_merge_rpc migration skipped: domains not present';
    return;
  end if;

  execute $fn$
    create or replace function public.merge_domain_label_colors(
      p_domain_id uuid,
      p_set jsonb,
      p_remove text[]
    )
    returns jsonb
    language plpgsql
    security invoker
    set search_path = public, pg_catalog
    as $body$
    declare
      v_result jsonb;
    begin
      update domains
      set label_colors = (coalesce(label_colors, '{}'::jsonb) || coalesce(p_set, '{}'::jsonb))
                          - coalesce(p_remove, '{}'::text[]),
          updated_at = now()
      where id = p_domain_id
      returning label_colors into v_result;

      if v_result is null then
        raise exception 'Domain not found or not accessible'
          using errcode = 'P0002';
      end if;

      return v_result;
    end
    $body$;
  $fn$;
end
$migration$;
