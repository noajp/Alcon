-- Code changes: the pull requests that carry out an Element, and the team's
-- check that the software matches the intent it was built for.
--
--   code_changes          one pull request linked to an Element — by an agent
--                         run that opened it, or by a person pasting its URL.
--                         The diff itself stays on GitHub and is read through
--                         the code-changes Edge Function; this row keeps what
--                         the lists show and the AI's intent check.
--   code_change_reviews   a person's verdict: matches the intent / needs
--                         changes / a comment, against one head commit.
--   code_change_comments  a comment on one line of the diff.
--
-- Everyone who can see the Element reads all three. Rows in code_changes are
-- written only by the Edge Functions (service role), which check that the
-- caller can see the Element first — so the PR metadata and the AI's verdict
-- are what GitHub and the model said, not what a client typed. A person may
-- unlink one. Reviews and comments are written by their author.
-- Guarded for preview replay: the base schema may be absent.
do $$
begin
  if to_regclass('public.elements') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.element_space(uuid)') is null then
    raise notice 'code_changes skipped: elements / user_can_see_element / element_space not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.code_changes (
      id uuid primary key default gen_random_uuid(),
      element_id uuid not null references public.elements(id) on delete cascade,
      activity_space_id uuid,
      provider text not null default 'github' check (provider = 'github'),
      repo text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
      number integer not null check (number > 0),
      url text not null check (url like 'https://github.com/%'),
      title text not null default '' check (char_length(title) <= 500),
      body text check (char_length(body) <= 20000),
      state text not null default 'open' check (state in ('open', 'draft', 'merged', 'closed')),
      base_ref text,
      head_ref text,
      head_sha text,
      author_login text,
      additions integer,
      deletions integer,
      changed_files integer,
      intent_check jsonb check (intent_check is null or jsonb_typeof(intent_check) = 'object'),
      linked_via text not null default 'manual' check (linked_via in ('manual', 'agent')),
      run_id uuid,
      linked_by uuid default auth.uid(),
      synced_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (element_id, repo, number)
    )
  $ddl$;
  execute 'create index if not exists code_changes_element on public.code_changes (element_id, created_at desc)';
  execute 'create index if not exists code_changes_space on public.code_changes (activity_space_id, updated_at desc)';
  execute 'alter table public.code_changes enable row level security';
  execute 'drop policy if exists code_changes_select on public.code_changes';
  execute 'create policy code_changes_select on public.code_changes for select to authenticated using (public.user_can_see_element(element_id))';
  execute 'drop policy if exists code_changes_delete on public.code_changes';
  execute 'create policy code_changes_delete on public.code_changes for delete to authenticated using (public.user_can_see_element(element_id))';

  -- The Space follows the Element, as agent_runs does.
  execute $fn$
    create or replace function public.code_changes_stamp_space()
    returns trigger language plpgsql security definer set search_path = public as $body$
    begin
      if new.activity_space_id is null then
        new.activity_space_id := public.element_space(new.element_id);
      end if;
      return new;
    end
    $body$
  $fn$;
  execute 'drop trigger if exists code_changes_stamp_space on public.code_changes';
  execute 'create trigger code_changes_stamp_space before insert on public.code_changes for each row execute function public.code_changes_stamp_space()';

  execute $fn$
    create or replace function public.user_can_see_code_change(p_code_change_id uuid)
    returns boolean language sql stable security definer set search_path = public as $body$
      select coalesce((select public.user_can_see_element(c.element_id) from public.code_changes c where c.id = p_code_change_id), false)
    $body$
  $fn$;

  execute $ddl$
    create table if not exists public.code_change_reviews (
      id uuid primary key default gen_random_uuid(),
      code_change_id uuid not null references public.code_changes(id) on delete cascade,
      reviewer_id uuid not null default auth.uid(),
      reviewer_name text,
      verdict text not null check (verdict in ('matches', 'needs_changes', 'comment')),
      body text not null default '' check (char_length(body) <= 10000),
      head_sha text,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists code_change_reviews_change on public.code_change_reviews (code_change_id, created_at)';
  execute 'alter table public.code_change_reviews enable row level security';
  execute 'drop policy if exists code_change_reviews_select on public.code_change_reviews';
  execute 'create policy code_change_reviews_select on public.code_change_reviews for select to authenticated using (public.user_can_see_code_change(code_change_id))';
  execute 'drop policy if exists code_change_reviews_insert on public.code_change_reviews';
  execute 'create policy code_change_reviews_insert on public.code_change_reviews for insert to authenticated with check (reviewer_id = auth.uid() and public.user_can_see_code_change(code_change_id))';
  execute 'drop policy if exists code_change_reviews_delete on public.code_change_reviews';
  execute 'create policy code_change_reviews_delete on public.code_change_reviews for delete to authenticated using (reviewer_id = auth.uid())';

  execute $ddl$
    create table if not exists public.code_change_comments (
      id uuid primary key default gen_random_uuid(),
      code_change_id uuid not null references public.code_changes(id) on delete cascade,
      author_id uuid not null default auth.uid(),
      author_name text,
      path text not null check (char_length(path) between 1 and 1000),
      line integer not null check (line > 0),
      side text not null check (side in ('old', 'new')),
      body text not null check (char_length(body) between 1 and 10000),
      head_sha text,
      resolved boolean not null default false,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists code_change_comments_change on public.code_change_comments (code_change_id, path, line)';
  execute 'alter table public.code_change_comments enable row level security';
  execute 'drop policy if exists code_change_comments_select on public.code_change_comments';
  execute 'create policy code_change_comments_select on public.code_change_comments for select to authenticated using (public.user_can_see_code_change(code_change_id))';
  execute 'drop policy if exists code_change_comments_insert on public.code_change_comments';
  execute 'create policy code_change_comments_insert on public.code_change_comments for insert to authenticated with check (author_id = auth.uid() and public.user_can_see_code_change(code_change_id))';
  -- Anyone on the Element may resolve a thread; only the author deletes it.
  execute 'drop policy if exists code_change_comments_update on public.code_change_comments';
  execute 'create policy code_change_comments_update on public.code_change_comments for update to authenticated using (public.user_can_see_code_change(code_change_id)) with check (public.user_can_see_code_change(code_change_id))';
  execute 'revoke update on public.code_change_comments from authenticated';
  execute 'grant update (resolved) on public.code_change_comments to authenticated';
  execute 'drop policy if exists code_change_comments_delete on public.code_change_comments';
  execute 'create policy code_change_comments_delete on public.code_change_comments for delete to authenticated using (author_id = auth.uid())';
end $$;
