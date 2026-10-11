-- Widgets are shared components with an origin; a board holds placements of
-- them (ADR 0039). A widget is visible and editable to whoever can see its
-- origin; a board to whoever can see its subject. Placing a widget on another
-- board never widens who can see it.
do $migration$
begin
  if to_regclass('public.objects') is null or to_regclass('public.domains') is null
     or to_regclass('public.elements') is null or to_regclass('public.strategies') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_see_strategy(uuid)') is null then
    raise notice 'Shared widget boards skipped: base schema absent';
    return;
  end if;

  execute $ddl$
    -- One visibility rule for both tables: the subject a board is about and
    -- the origin a widget was born on are the same kinds of thing.
    create function public.user_can_see_widget_subject(_kind text, _id uuid)
    returns boolean language sql stable set search_path = '' as $fn$
      select case _kind
        when 'me' then _id = (select auth.uid())
        when 'domain' then public.user_can_see_domain(_id)
        when 'object' then public.user_can_see_object(_id)
        when 'element' then public.user_can_see_element(_id)
        when 'initiative' then public.user_can_see_strategy(_id)
        else false
      end
    $fn$;

    create table public.widgets (
      id uuid primary key default gen_random_uuid(),
      kind text not null check (length(kind) between 1 and 100),
      origin_kind text not null check (origin_kind in ('me','domain','object','element','initiative')),
      origin_id uuid not null,
      params jsonb not null default '{}'::jsonb
        check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 100000),
      revision integer not null default 1,
      created_by uuid default auth.uid(),
      updated_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index widgets_origin on public.widgets (origin_kind, origin_id);

    create table public.boards (
      id uuid primary key default gen_random_uuid(),
      surface text not null check (length(surface) between 1 and 60),
      subject_kind text not null check (subject_kind in ('me','domain','object','element','initiative')),
      subject_id uuid not null,
      -- A personal board is kept per Space; shared boards belong to their subject alone.
      space_id uuid check (space_id is null or subject_kind = 'me'),
      -- Default instances removed on purpose, so a later load does not put them back.
      dismissed_defaults text[] not null default '{}',
      revision integer not null default 1,
      updated_by uuid default auth.uid(),
      updated_at timestamptz not null default now()
    );
    create unique index boards_identity on public.boards
      (surface, subject_kind, subject_id, coalesce(space_id, '00000000-0000-0000-0000-000000000000'::uuid));
    create index boards_subject on public.boards (subject_kind, subject_id);

    create table public.board_placements (
      id uuid primary key default gen_random_uuid(),
      board_id uuid not null references public.boards(id) on delete cascade,
      widget_id uuid not null references public.widgets(id) on delete cascade,
      zone text not null check (zone in ('band','main','rail')),
      position double precision not null,
      size text check (size in ('half','full')),
      -- Set when the placement is a surface's default instance.
      default_id text check (default_id is null or length(default_id) between 1 and 200),
      updated_by uuid default auth.uid(),
      updated_at timestamptz not null default now(),
      unique (board_id, widget_id)
    );
    create unique index board_placements_default on public.board_placements (board_id, default_id)
      where default_id is not null;
    create index board_placements_widget on public.board_placements (widget_id);

    alter table public.widgets enable row level security;
    alter table public.boards enable row level security;
    alter table public.board_placements enable row level security;
    revoke all on public.widgets, public.boards, public.board_placements from anon;
    grant select, insert, update, delete on public.widgets, public.boards, public.board_placements to authenticated;
    grant all on public.widgets, public.boards, public.board_placements to service_role;

    create policy widgets_by_origin on public.widgets for all to authenticated
      using (public.user_can_see_widget_subject(origin_kind, origin_id))
      with check (public.user_can_see_widget_subject(origin_kind, origin_id));
    create policy boards_by_subject on public.boards for all to authenticated
      using (public.user_can_see_widget_subject(subject_kind, subject_id))
      with check (public.user_can_see_widget_subject(subject_kind, subject_id));
    -- A placement follows its board. Only a widget the caller can see may be
    -- placed; one already placed stays movable and removable by anyone on the
    -- board, including people who cannot see what it holds.
    create policy board_placements_select on public.board_placements for select to authenticated
      using (exists (select 1 from public.boards b where b.id = board_id));
    create policy board_placements_insert on public.board_placements for insert to authenticated
      with check (exists (select 1 from public.boards b where b.id = board_id)
        and exists (select 1 from public.widgets w where w.id = widget_id));
    create policy board_placements_update on public.board_placements for update to authenticated
      using (exists (select 1 from public.boards b where b.id = board_id))
      with check (exists (select 1 from public.boards b where b.id = board_id));
    create policy board_placements_delete on public.board_placements for delete to authenticated
      using (exists (select 1 from public.boards b where b.id = board_id));

    create function public.widget_guard() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.id is distinct from old.id or new.kind is distinct from old.kind
         or new.origin_kind is distinct from old.origin_kind or new.origin_id is distinct from old.origin_id then
        raise exception 'Widget identity cannot be changed';
      end if;
      new.revision := old.revision + 1;
      new.updated_at := now();
      new.updated_by := (select auth.uid());
      return new;
    end $fn$;
    create trigger widget_guard before update on public.widgets
      for each row execute function public.widget_guard();

    create function public.board_guard() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.id is distinct from old.id or new.surface is distinct from old.surface
         or new.subject_kind is distinct from old.subject_kind or new.subject_id is distinct from old.subject_id
         or new.space_id is distinct from old.space_id then
        raise exception 'Board identity cannot be changed';
      end if;
      new.revision := old.revision + 1;
      new.updated_at := now();
      new.updated_by := (select auth.uid());
      return new;
    end $fn$;
    create trigger board_guard before update on public.boards
      for each row execute function public.board_guard();

    create function public.board_placement_guard() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.id is distinct from old.id or new.board_id is distinct from old.board_id
         or new.widget_id is distinct from old.widget_id or new.default_id is distinct from old.default_id then
        raise exception 'Placement identity cannot be changed';
      end if;
      new.updated_at := now();
      new.updated_by := (select auth.uid());
      return new;
    end $fn$;
    create trigger board_placement_guard before update on public.board_placements
      for each row execute function public.board_placement_guard();

    -- Placements on boards the caller cannot see still count.
    create function public.widget_is_placed(_widget_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $fn$
      select exists (select 1 from public.board_placements p where p.widget_id = _widget_id)
    $fn$;

    -- Taking a widget off a board: a default instance is remembered as
    -- dismissed, and a widget left on no board is deleted — when the caller
    -- can see it. Runs as the caller, so a widget they cannot see survives.
    create function public.board_placement_removed() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if old.default_id is not null then
        update public.boards set dismissed_defaults = array_append(dismissed_defaults, old.default_id)
        where id = old.board_id and not (old.default_id = any(dismissed_defaults));
      end if;
      delete from public.widgets w where w.id = old.widget_id and not public.widget_is_placed(old.widget_id);
      return null;
    end $fn$;
    create trigger board_placement_removed after delete on public.board_placements
      for each row execute function public.board_placement_removed();

    -- Boards and widgets go with what they are about. Definer: once the
    -- subject is gone nobody can see its rows, so RLS would keep them forever.
    create function public.widget_subject_deleted() returns trigger
    language plpgsql security definer set search_path = '' as $fn$
    begin
      delete from public.boards where subject_kind = tg_argv[0] and subject_id = old.id;
      delete from public.widgets where origin_kind = tg_argv[0] and origin_id = old.id;
      return null;
    end $fn$;
    create trigger widget_subject_deleted after delete on public.objects
      for each row execute function public.widget_subject_deleted('object');
    create trigger widget_subject_deleted after delete on public.domains
      for each row execute function public.widget_subject_deleted('domain');
    create trigger widget_subject_deleted after delete on public.elements
      for each row execute function public.widget_subject_deleted('element');
    create trigger widget_subject_deleted after delete on public.strategies
      for each row execute function public.widget_subject_deleted('initiative');

    -- A board row exists from the first edit. Default instances are written
    -- with ids derived from the board, so two people making the first edit at
    -- once produce one set of widgets, not two.
    create function public.ensure_board(
      p_surface text, p_subject_kind text, p_subject_id uuid default null,
      p_space_id uuid default null, p_instances jsonb default '[]'::jsonb
    ) returns uuid language plpgsql set search_path = '' as $fn$
    declare
      v_subject uuid := case when p_subject_kind = 'me' then (select auth.uid()) else p_subject_id end;
      v_instances jsonb := coalesce(p_instances, '[]'::jsonb);
      v_board public.boards%rowtype;
      v_item jsonb;
      v_default text;
      v_kind text;
      v_widget uuid;
    begin
      if v_subject is null then raise exception 'A board needs a subject'; end if;
      if jsonb_typeof(v_instances) <> 'array' or jsonb_array_length(v_instances) > 100 then
        raise exception 'Invalid default instances';
      end if;
      insert into public.boards (surface, subject_kind, subject_id, space_id)
        values (p_surface, p_subject_kind, v_subject, p_space_id)
        on conflict do nothing;
      select * into v_board from public.boards b
        where b.surface = p_surface and b.subject_kind = p_subject_kind
          and b.subject_id = v_subject and b.space_id is not distinct from p_space_id;
      if not found then raise exception 'Board unavailable'; end if;
      for v_item in select value from jsonb_array_elements(v_instances) loop
        v_default := v_item->>'default_id';
        v_kind := v_item->>'kind';
        continue when v_default is null or v_kind is null or v_default = any(v_board.dismissed_defaults);
        continue when exists (
          select 1 from public.board_placements p where p.board_id = v_board.id and p.default_id = v_default);
        continue when coalesce((v_item->>'singleton')::boolean, false) and exists (
          select 1 from public.board_placements p join public.widgets w on w.id = p.widget_id
          where p.board_id = v_board.id and w.kind = v_kind);
        v_widget := md5(v_board.id::text || ':' || v_default)::uuid;
        insert into public.widgets (id, kind, origin_kind, origin_id, params)
          values (v_widget, v_kind, v_board.subject_kind, v_board.subject_id, coalesce(v_item->'params', '{}'::jsonb))
          on conflict (id) do nothing;
        insert into public.board_placements (board_id, widget_id, zone, position, size, default_id)
          values (v_board.id, v_widget, v_item->>'zone', (v_item->>'position')::double precision, v_item->>'size', v_default)
          on conflict do nothing;
      end loop;
      return v_board.id;
    end $fn$;

    -- A new widget and its first placement, or neither. Born on the board's
    -- subject unless it is personal, which keeps it to its author.
    create function public.add_widget(
      p_board_id uuid, p_kind text, p_zone text, p_position double precision default null,
      p_size text default null, p_params jsonb default '{}'::jsonb,
      p_personal boolean default false, p_singleton boolean default false
    ) returns uuid language plpgsql set search_path = '' as $fn$
    declare
      v_board public.boards%rowtype;
      v_widget uuid;
    begin
      select * into v_board from public.boards b where b.id = p_board_id;
      if not found then raise exception 'Board unavailable'; end if;
      if p_singleton and exists (
        select 1 from public.board_placements p join public.widgets w on w.id = p.widget_id
        where p.board_id = p_board_id and w.kind = p_kind) then
        raise exception 'This board already has that widget';
      end if;
      insert into public.widgets (kind, origin_kind, origin_id, params)
        values (
          p_kind,
          case when p_personal then 'me' else v_board.subject_kind end,
          case when p_personal then (select auth.uid()) else v_board.subject_id end,
          coalesce(p_params, '{}'::jsonb))
        returning id into v_widget;
      insert into public.board_placements (board_id, widget_id, zone, position, size)
        values (p_board_id, v_widget, p_zone, coalesce(p_position, (
          select coalesce(max(p.position), 0) + 1 from public.board_placements p
          where p.board_id = p_board_id and p.zone = p_zone)), p_size);
      return v_widget;
    end $fn$;

    -- Two people changing different settings of one widget both keep theirs.
    create function public.merge_widget_params(p_widget_id uuid, p_patch jsonb)
    returns jsonb language plpgsql set search_path = '' as $fn$
    declare v_params jsonb;
    begin
      if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'A patch must be an object'; end if;
      update public.widgets set params = params || p_patch where id = p_widget_id returning params into v_params;
      if not found then raise exception 'Widget unavailable'; end if;
      return v_params;
    end $fn$;

    revoke all on function public.user_can_see_widget_subject(text, uuid), public.widget_is_placed(uuid),
      public.ensure_board(text, text, uuid, uuid, jsonb),
      public.add_widget(uuid, text, text, double precision, text, jsonb, boolean, boolean),
      public.merge_widget_params(uuid, jsonb),
      public.widget_guard(), public.board_guard(), public.board_placement_guard(),
      public.board_placement_removed(), public.widget_subject_deleted() from public, anon;
    grant execute on function public.user_can_see_widget_subject(text, uuid), public.widget_is_placed(uuid),
      public.ensure_board(text, text, uuid, uuid, jsonb),
      public.add_widget(uuid, text, text, double precision, text, jsonb, boolean, boolean),
      public.merge_widget_params(uuid, jsonb) to authenticated, service_role;
  $ddl$;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.widgets, public.boards, public.board_placements';
  end if;
end $migration$;
