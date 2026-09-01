-- el_TM-001 becomes ELE_TM-001; obj_TM becomes OBJ_TM.
--
-- A house style choice, not a bug fix — unlike the two migrations before it,
-- nothing here was broken. The two triggers this replaces (set_object_display_id,
-- set_element_display_id) already do the real work correctly since
-- 20260901070000; this changes only the literal static text each one prefixes
-- onto the per-Object part.
--
-- Forward-only, on purpose. The board already carries 175 Elements and Objects
-- named in the old style, and 176 comments that quote them in prose —
-- "el_QLT-012 のトリガを直した" is itself a record of what happened, and
-- rewriting it to say ELE_QLT-012 after the fact would make history disagree
-- with itself. So this migration touches only what CREATE OR REPLACE touches:
-- the rule for rows not yet written. Existing rows keep their el_ / obj_ ids
-- exactly as they are.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the functions this replaces are created outside it.

do $migration$
begin
  if to_regclass('public.objects') is null or to_regclass('public.elements') is null then
    raise notice 'ELE/OBJ id style skipped: base schema not present';
    return;
  end if;

  execute $fn$
    create or replace function public.set_object_display_id()
    returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      new_space uuid;
      base text;
      taken text[];
      candidate text;
      n int;
    begin
      if new.prefix is null or new.prefix = '' then
        base := public.generate_prefix(new.name);

        select d.activity_space_id into new_space
        from public.domains d
        where d.id = new.domain_id;

        select array_agg(upper(o.prefix)) into taken
        from public.objects o
        left join public.domains d on d.id = o.domain_id
        where o.id is distinct from new.id
          and o.prefix is not null
          and o.prefix <> ''
          and d.activity_space_id is not distinct from new_space;

        candidate := upper(base);
        if taken is not null and candidate = any(taken) then
          n := 2;
          loop
            candidate := upper(base) || n::text;
            exit when taken is null or not (candidate = any(taken));
            n := n + 1;
          end loop;
        end if;

        new.prefix := candidate;
      end if;

      new.display_id := 'OBJ_' || new.prefix;
      return new;
    end;
    $body$;
  $fn$;

  execute $fn$
    create or replace function public.set_element_display_id()
    returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      obj_prefix text;
      next_seq integer;
    begin
      if new.object_id is not null then
        select prefix into obj_prefix from public.objects where id = new.object_id;
      end if;
      if obj_prefix is null or obj_prefix = '' then
        obj_prefix := 'GEN';
      end if;

      if new.seq_number is null then
        select greatest(
          coalesce((select max(seq_number) from public.elements
                     where object_id is not distinct from new.object_id), 0),
          coalesce((select max(s.seq_number) from public.subelements s
                     join public.elements pe on pe.id = s.element_id
                    where pe.object_id is not distinct from new.object_id), 0)
        ) + 1 into next_seq;
        new.seq_number := next_seq;
      end if;

      new.display_id := 'ELE_' || obj_prefix || '-' || lpad(new.seq_number::text, 3, '0');
      return new;
    end;
    $body$;
  $fn$;
end $migration$;
