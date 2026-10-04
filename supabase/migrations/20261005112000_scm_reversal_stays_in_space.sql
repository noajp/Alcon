-- A reversal can only point at a movement of its own Space, like every
-- other SCM reference.
do $$
begin
  if to_regclass('public.scm_movements') is null then
    raise notice 'scm reversal key skipped: scm_movements not present';
    return;
  end if;
  execute $ddl$
  create unique index if not exists scm_movements_id_space on public.scm_movements (id, activity_space_id);
  alter table public.scm_movements drop constraint if exists scm_movements_reverses_id_fkey;
  alter table public.scm_movements drop constraint if exists scm_movements_reverses_in_space;
  alter table public.scm_movements add constraint scm_movements_reverses_in_space
    foreign key (reverses_id, activity_space_id) references public.scm_movements (id, activity_space_id) on delete set null (reverses_id);
  $ddl$;
end $$;
