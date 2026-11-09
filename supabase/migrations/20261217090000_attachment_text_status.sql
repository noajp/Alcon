-- A file's words, and the state of getting them: attachment_texts gains
-- `status` — ok (words stored) · empty (read, and there are genuinely
-- none: an image, a PDF with no text layer) · failed (could not be read:
-- damaged, password-protected, the tab went away mid-read) · too_large
-- (over the size the indexing reads). Until now a failed extraction and
-- a wordless file both landed as body = '' with nothing to tell them
-- apart, and attachments_to_index returned only files with no row, so a
-- failure was terminal. The backfill now also returns the failed (the
-- browser retries them on the usual Files-view / search visits, 20 at a
-- time as before); empty and too_large are terminal — stated by the
-- state, not retried forever. No OCR arrives with this: a scanned PDF
-- stays empty, honestly.
--
-- Existing rows classify by what they hold: words → ok, none → empty.
-- A past failure therefore reads as empty until a retry pass
-- reclassifies it (accepted; the design's §7.1). Retry semantics are
-- pinned by this header and the writers' tests — the disposable-fixture
-- SQL suite has no attachments fixture to extend (migration-review
-- note, per the design's test plan).
do $$
begin
  if to_regclass('public.attachment_texts') is null then
    raise notice 'attachment_text_status skipped: attachment_texts not present'; return;
  end if;

  execute 'alter table public.attachment_texts add column if not exists status text';
  execute $u$
    update public.attachment_texts
    set status = case when body <> '' then 'ok' else 'empty' end
    where status is null
  $u$;
  execute 'alter table public.attachment_texts alter column status set default ''empty''';
  execute 'alter table public.attachment_texts alter column status set not null';

  if not exists (
    select 1 from pg_constraint
    where conname = 'attachment_texts_status_check'
      and conrelid = 'public.attachment_texts'::regclass
  ) then
    execute 'alter table public.attachment_texts add constraint attachment_texts_status_check check (status in (''ok'', ''empty'', ''failed'', ''too_large''))';
  end if;

  if to_regprocedure('public.space_attachments(uuid,boolean)') is null then
    raise notice 'attachments_to_index retry skipped: space_attachments not present'; return;
  end if;

  -- Files in a Space whose words have not been taken out, or whose read
  -- failed (the browser reads them in the background and writes
  -- attachment_texts; a failed read is tried again, the rest are final).
  execute $f$
    create or replace function public.attachments_to_index(p_space uuid, p_limit int default 20)
    returns table (id uuid, path text, name text, mime_type text, size bigint)
    language sql stable security invoker set search_path = public as $body$
      select s.id, s.path, s.name, s.mime_type, s.size
      from public.space_attachments(p_space) s
      where not exists (select 1 from public.attachment_texts t where t.attachment_id = s.id)
         or exists (select 1 from public.attachment_texts t where t.attachment_id = s.id and t.status = 'failed')
      order by s.created_at desc
      limit greatest(1, least(p_limit, 50))
    $body$
  $f$;
  execute 'grant execute on function public.attachments_to_index(uuid, int) to authenticated';
end $$;
