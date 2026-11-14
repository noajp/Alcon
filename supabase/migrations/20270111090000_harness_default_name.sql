-- The built-in Strategy harness carried the product's former name:
-- 'Strategy の進め方（Alcon の既定）'. The catalog entry is renamed, and so
-- are the copies Spaces took from it while they still carry that exact
-- name (a name a Space chose itself is left alone). A replay seeds the old
-- name in 20261117090000 and lands here, on the same result.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.catalog_items') is not null then
    execute $sql$
      update public.catalog_items
      set name = 'Strategy の進め方（Clayware の既定）', updated_at = now()
      where id = 'def.strategy-default' and name = 'Strategy の進め方（Alcon の既定）'
    $sql$;
  else
    raise notice 'catalog_items rename skipped: table not present';
  end if;

  if to_regclass('public.definitions') is not null then
    execute $sql$
      update public.definitions
      set name = 'Strategy の進め方（Clayware の既定）'
      where name = 'Strategy の進め方（Alcon の既定）'
    $sql$;
  else
    raise notice 'definitions rename skipped: table not present';
  end if;
end $$;
