-- An Object's own thread and reactions, the way an Element and a Strategy
-- have theirs: the Object page reads like an Element's — its name, its
-- description, a row of reactions and attachments, the attached files,
-- then the updates people and agents leave on it.
--
-- object_comments has strategy_comments' shape. Who can do what (RLS):
-- - read: whoever can read the Object;
-- - write: whoever can see the Object, as themselves;
-- - change or delete: the comment's author.
-- element_reactions gains object_id, the fourth thing a reaction can be
-- on, read and written under the Object's own visibility.
--
-- Guarded for preview replay: the base schema (objects, element_reactions,
-- the visibility functions) lives outside this folder.

do $$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.element_reactions') is null
     or to_regprocedure('public.user_can_read_object(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.user_can_read_element(uuid)') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_read_strategy(uuid)') is null then
    raise notice 'object comments and reactions skipped: base schema not present';
    return;
  end if;

  create table if not exists public.object_comments (
    id uuid primary key default gen_random_uuid(),
    object_id uuid not null references public.objects(id) on delete cascade,
    parent_id uuid references public.object_comments(id) on delete cascade,
    author_id uuid references auth.users(id) on delete set null,
    author_kind text not null default 'human',
    author_name text,
    content text not null,
    mentions uuid[] not null default '{}',
    is_pinned boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint object_comments_author_kind_check check (author_kind in ('human', 'ai_agent'))
  );

  create index if not exists object_comments_object_idx on public.object_comments (object_id, created_at);

  alter table public.object_comments enable row level security;

  drop policy if exists object_comments_select on public.object_comments;
  create policy object_comments_select on public.object_comments
    for select to authenticated
    using (public.user_can_read_object(object_id));

  drop policy if exists object_comments_insert on public.object_comments;
  create policy object_comments_insert on public.object_comments
    for insert to authenticated
    with check (
      (select auth.uid()) is not null
      and (author_id is null or author_id = (select auth.uid()))
      and public.user_can_see_object(object_id)
    );

  drop policy if exists object_comments_update on public.object_comments;
  create policy object_comments_update on public.object_comments
    for update to authenticated
    using (author_id = (select auth.uid()))
    with check (author_id = (select auth.uid()));

  drop policy if exists object_comments_delete on public.object_comments;
  create policy object_comments_delete on public.object_comments
    for delete to authenticated
    using (author_id = (select auth.uid()));

  grant select, insert, update, delete on public.object_comments to authenticated;

  -- Reactions on an Object.
  alter table public.element_reactions
    add column if not exists object_id uuid references public.objects(id) on delete cascade;
  create index if not exists element_reactions_object_idx on public.element_reactions (object_id) where object_id is not null;

  alter table public.element_reactions drop constraint if exists element_reactions_check;
  alter table public.element_reactions add constraint element_reactions_check check (
    (element_id is not null)::integer + (comment_id is not null)::integer
    + (strategy_id is not null)::integer + (object_id is not null)::integer = 1
  );

  drop policy if exists element_reactions_select on public.element_reactions;
  create policy element_reactions_select on public.element_reactions
    for select to authenticated
    using (case
      when element_id is not null then public.user_can_read_element(element_id)
      when strategy_id is not null then public.user_can_read_strategy(strategy_id)
      when object_id is not null then public.user_can_read_object(object_id)
      else exists (select 1 from public.element_comments c where c.id = element_reactions.comment_id)
    end);

  drop policy if exists element_reactions_insert on public.element_reactions;
  create policy element_reactions_insert on public.element_reactions
    for insert to authenticated
    with check (
      user_id = (select auth.uid())
      and case
        when element_id is not null then public.user_can_see_element(element_id)
        when strategy_id is not null then public.user_can_read_strategy(strategy_id)
        when object_id is not null then public.user_can_see_object(object_id)
        else exists (select 1 from public.element_comments c
                     where c.id = element_reactions.comment_id and public.user_can_see_element(c.element_id))
      end
    );
end $$;
