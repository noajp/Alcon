-- The trigger read clean, at last: `generate_prefix` splits a name on spaces
-- and takes the first character of every token, with no idea that "医療" is
-- not a Latin letter. "TF-MED — 医療・防疫" tokenizes on whitespace into
-- ["TF-MED", "—", "医療・防疫"], and the trigger takes one character from
-- each — T, —, 医 — which is exactly how el_UXQ-026 and the boards' own
-- "P2—こ" / "開発PJ" prefixes came to exist. The bug was never in the idea of
-- taking initials; it was in trusting split(' ') to find word boundaries in a
-- string that was never only words.
--
-- PR #239 already solved this once, client-side, in
-- web/src/alcon/object/objectPrefix.ts — extract ASCII letters/digits as the
-- tokens instead of whitespace-delimited chunks, so a name contributes only
-- what could plausibly become an initial. This migration ports that rule into
-- `generate_prefix` itself, which is the fallback every insert reaches when
-- nothing upstream supplied a prefix: the copilot Edge Function's direct
-- INSERT, and REST/SQL writes like the one that created this exercise's own
-- "運営体制" Object. PR #239's fix covered exactly one of those paths; this
-- covers what's left, because it lives in the one place all of them pass
-- through.
--
-- Deliberately narrower than the client version in one way: NFKD accent- and
-- full-width-folding ("Zürich", "ＴＦ－ＭＥＤ") is not replicated here.
-- Postgres has no built-in equivalent to JS's String.normalize short of an
-- extension this migration cannot assume is installed, and every mangled
-- prefix actually observed on these boards — "T—医", "P2—こ", "開発PJ" — is
-- plain CJK with no accented Latin or full-width forms in it. Bare-ASCII
-- extraction alone fixes what has actually broken; folding stays a client-side
-- refinement rather than a guess about a case nobody has hit here.
--
-- Uniqueness moved to where the context to check it exists. `generate_prefix`
-- keeps its original single-argument shape — name in, base out — since it may
-- have callers beyond this trigger that this session has no way to enumerate,
-- and changing its signature would break them silently. The trigger, which
-- knows the Object's Domain, checks the base against every prefix already in
-- use in the same ActivitySpace before accepting it — Space-wide because that
-- is where the exercise's own collision happened: "運営体制" and Friction
-- Dev's "Agent Ops" share a Space, and a Domain-scoped check would have missed
-- it just as it did the first time. This is a live scan, not a constraint —
-- the read-then-insert race PR #239's review flagged is not closed by this
-- migration, and stays open as its own follow-up.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the functions this replaces are created outside it.

do $migration$
begin
  if to_regclass('public.objects') is null or to_regclass('public.domains') is null then
    raise notice 'prefix generation fix skipped: base schema not present';
    return;
  end if;

  execute $fn$
    create or replace function public.generate_prefix(name text)
    returns text
    language plpgsql
    immutable
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      raw_tokens text[];
      tok text;
      result text := '';
    begin
      -- Only ASCII letters/digits become tokens — an em dash or a run of
      -- kanji is not a word this function can take an initial from, so it is
      -- dropped rather than misread as one.
      select array_agg(m[1]) into raw_tokens
      from regexp_matches(name, '[A-Za-z0-9]+', 'g') as m;

      if raw_tokens is null or array_length(raw_tokens, 1) is null then
        -- No ASCII content at all — a name that is entirely CJK, for
        -- instance. The old behaviour of taking the first character
        -- regardless of script produced a prefix that named nothing anyone
        -- could pronounce back; this at least says plainly that a prefix
        -- had to be invented rather than read off the name.
        result := 'OBJ';
      elsif array_length(raw_tokens, 1) = 1 then
        result := upper(left(raw_tokens[1], 4));
      else
        foreach tok in array raw_tokens loop
          result := result || upper(left(tok, 1));
        end loop;
        result := left(result, 4);
      end if;

      return result;
    end;
    $body$;
  $fn$;

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

        -- Same ActivitySpace, not just the same Domain: a Domain-scoped check
        -- would not have caught the exercise's own "運営体制" / "Agent Ops"
        -- collision, which happened across two Domains that share one Space.
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

      new.display_id := 'obj_' || new.prefix;
      return new;
    end;
    $body$;
  $fn$;
end $migration$;
