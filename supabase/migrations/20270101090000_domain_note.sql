-- A Domain's Note: long-form text everyone in the Domain reads and its
-- members write — the Domain page's Note tab. Markdown, like a description.
do $$
begin
  if to_regclass('public.domains') is null then
    raise notice 'domains.note skipped: domains not present'; return;
  end if;
  alter table public.domains add column if not exists note text;
end $$;
