-- Per-label colour catalogue, Domain-scoped: a map of label name -> palette
-- key (e.g. {"Bug":"red"}). Labels themselves stay free strings on
-- elements.labels; this just colours their mark consistently across the Domain.
-- Guarded with to_regclass for preview/shadow-DB replay.
do $$
begin
  if to_regclass('public.domains') is null then
    raise notice 'label_colors migration skipped: domains not present';
    return;
  end if;
  execute 'alter table public.domains add column if not exists label_colors jsonb not null default ''{}''::jsonb';
end
$$;
