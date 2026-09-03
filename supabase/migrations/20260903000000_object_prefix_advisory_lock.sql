-- Closes the read-then-insert race 20260901070000's own comment flagged and
-- left open: "This is a live scan, not a constraint — the read-then-insert
-- race PR #239's review flagged is not closed by this migration, and stays
-- open as its own follow-up."
--
-- Two Objects created concurrently in the same ActivitySpace can both read
-- the same "taken" prefix set before either has committed its own INSERT,
-- and both land on the same candidate prefix — the exact bug el_UXQ-026
-- fixed once already (obj_OPS colliding between "運営体制" and "Agent Ops"),
-- reachable again any time two creations race instead of serialize.
--
-- No unique index is possible here without a schema change first: the
-- uniqueness scope is the ActivitySpace, and `objects` has no
-- `activity_space_id` column of its own — only `domain_id`, with the Space
-- reachable one join away through `domains`. A real unique index needs a
-- column to index; denormalizing `activity_space_id` onto `objects` (kept in
-- sync via its own trigger) is a bigger, separate change with its own
-- failure modes, not a proportionate fix for a race that a lock closes
-- just as completely.
--
-- `pg_advisory_xact_lock` instead: one lock per ActivitySpace, acquired
-- right before the trigger reads which prefixes are already taken, held for
-- the rest of the transaction, released automatically on commit or
-- rollback. A second concurrent INSERT in the same Space blocks at the lock
-- acquisition until the first transaction finishes — by the time it reads
-- "taken", the first one's prefix is either committed and visible, or rolled
-- back and gone. Either way there is no window left in which both readers
-- see the same "not taken yet" answer. Two Objects in *different* Spaces
-- never contend, since the lock key includes the Space id.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the function this replaces is created outside it.

do $migration$
begin
  if to_regclass('public.objects') is null then
    raise notice 'object prefix advisory lock skipped: base schema not present';
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

        -- Serializes concurrent prefix assignment within one Space so the
        -- read below can never race another transaction's read of the same
        -- "taken" set. A null Space (a Domain not yet linked to one) has no
        -- shared scope to serialize, so nothing to lock there — the
        -- collision this closes is specifically cross-Object-within-Space.
        if new_space is not null then
          perform pg_advisory_xact_lock(hashtext('object_prefix'), hashtext(new_space::text));
        end if;

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
end
$migration$;
