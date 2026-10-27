-- The private 'reports' bucket let every signed-in account list and download
-- every object in it, whichever Space the report described: its read policy
-- checked only bucket_id. The report generators that wrote there are gone,
-- and reports were meant to be handed out as signed URLs, which the service
-- role issues without any policy. Drop the shared read; the bucket stays
-- private and reachable only through the service role.
do $m$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'reports shared read drop skipped: storage.objects not present'; return;
  end if;
  execute 'drop policy if exists reports_authenticated_read on storage.objects';
end $m$;
