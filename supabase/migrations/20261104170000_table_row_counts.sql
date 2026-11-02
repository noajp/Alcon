-- The Table list counted rows by downloading every row's table_id
-- (ELE_OBJ-013). This counts them in the database, as the caller, so row
-- visibility is the same as reading the rows.
do $mig$
begin
  if to_regclass('public.table_rows') is null then
    raise notice 'table_row_counts skipped: table_rows not present'; return;
  end if;
  execute $f$
    create or replace function public.table_row_counts(p_table_ids uuid[])
    returns table (table_id uuid, row_count bigint)
    language sql stable security invoker set search_path = public as $b$
      select r.table_id, count(*) from public.table_rows r
      where r.table_id = any(p_table_ids)
      group by r.table_id
    $b$
  $f$;
  execute 'revoke all on function public.table_row_counts(uuid[]) from public, anon';
  execute 'grant execute on function public.table_row_counts(uuid[]) to authenticated';
end $mig$;
