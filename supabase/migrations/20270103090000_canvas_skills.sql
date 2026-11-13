-- What a Space's canvases can draw with, imported by its members: a guide
-- (a skill document — how to draw something, read by the AI that writes the
-- canvas) or a library (a script from a pinned CDN address the canvas loads
-- into its sandbox, with notes on how to use it).
do $$
begin
  if to_regclass('public.activity_spaces') is null then
    raise notice 'canvas_skills skipped: activity_spaces not present'; return;
  end if;

  create table if not exists public.canvas_skills (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    kind text not null check (kind in ('guide', 'library')),
    name text not null check (char_length(name) between 1 and 80),
    -- A guide's text, or a library's usage notes.
    body text not null default '' check (char_length(body) <= 40000),
    -- A library's script (pinned on jsDelivr), or where a guide came from.
    url text check (url is null or char_length(url) <= 500),
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    constraint canvas_skills_library_url check (
      kind <> 'library' or url ~ '^https://cdn\.jsdelivr\.net/npm/(@[a-z0-9._-]+/)?[a-z0-9._-]+@[0-9]+\.[0-9]+\.[0-9]+[a-z0-9.-]*/[A-Za-z0-9._/-]+\.js$'
    )
  );
  create index if not exists canvas_skills_space_idx on public.canvas_skills (activity_space_id, created_at);

  alter table public.canvas_skills enable row level security;
  drop policy if exists canvas_skills_member on public.canvas_skills;
  create policy canvas_skills_member on public.canvas_skills for all
    using (public.is_activity_space_member(activity_space_id) or public.is_activity_space_owner(activity_space_id))
    with check (public.is_activity_space_member(activity_space_id) or public.is_activity_space_owner(activity_space_id));
  grant select, insert, update, delete on public.canvas_skills to authenticated;
end $$;
