-- Cover every public foreign key with an index whose leading columns are the
-- FK's columns (joins and ON DELETE cascades otherwise scan the child table),
-- and drop the two indexes that duplicate another one exactly.
do $$
declare
  fk record;
  idx_name text;
begin
  for fk in
    select c.conrelid, c.conrelid::regclass as tbl, cl.relname, c.conkey,
      (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
      (select string_agg(a.attname, '_' order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as col_names
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
          and (i.indpred is null
               or pg_get_expr(i.indpred, i.indrelid) ~ '^\(*\w+ IS NOT NULL\)*$')
      )
  loop
    idx_name := fk.relname || '_' || fk.col_names || '_fk_idx';
    if length(idx_name) > 63 then
      idx_name := left(fk.relname || '_' || fk.col_names, 48) || '_' || left(md5(idx_name), 6) || '_fk_idx';
    end if;
    execute format('create index if not exists %I on %s (%s)', idx_name, fk.tbl, fk.cols);
  end loop;
end $$;

drop index if exists public.agent_runs_element_idx;   -- same as agent_runs_element_created_idx
drop index if exists public.attachments_path_key;     -- same as the element_files_path_key constraint
