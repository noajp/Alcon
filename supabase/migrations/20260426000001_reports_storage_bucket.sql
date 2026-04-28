-- Reports bucket for AI-generated artifacts (docx / xlsx / pdf etc.)
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

-- Authenticated users can read any report (signed URLs are issued by the Edge Function).
create policy "reports_authenticated_read"
on storage.objects
for select
to authenticated
using (bucket_id = 'reports');

-- Only the service role uploads (via Edge Function); no INSERT/UPDATE/DELETE for end users.
create policy "reports_service_role_write"
on storage.objects
for all
to service_role
using (bucket_id = 'reports')
with check (bucket_id = 'reports');
