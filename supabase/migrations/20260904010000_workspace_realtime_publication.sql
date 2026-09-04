-- One delta stream for the workspace.
--
-- The client subscribes to every workspace-shaped table on one channel and
-- applies each change to its normalised caches (alcon/sync/deltaStream). A
-- table that is not in the supabase_realtime publication never delivers, so
-- every table the stream reads is added here. Idempotent: each is checked
-- against pg_publication_tables first, and a table absent from this database
-- (preview replay of an empty schema) is skipped.

do $mig$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'workspace realtime skipped: publication not present';
    return;
  end if;

  foreach t in array array[
    'elements', 'subelements', 'element_assignees', 'element_objects',
    'custom_column_values', 'custom_columns', 'custom_column_placements',
    'element_comments', 'element_reactions', 'element_edges',
    'objects', 'workers',
    'strategies', 'strategy_objects', 'strategy_children', 'strategy_comments',
    'phases',
    'intents', 'intent_bindings', 'intent_lineage', 'intent_next_actions',
    'intent_escalations', 'intent_alignments', 'intent_audits', 'intent_predictions', 'intent_resources'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$mig$;
