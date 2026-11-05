-- What an Element asks someone to do, as a verb (Function/shared/
-- elementActionKinds.ts). judge / decide / approve / answer are a person's;
-- the rest are work an AI can carry. Null: not said.
do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'elements.action skipped: elements not present'; return;
  end if;
  execute 'alter table public.elements add column if not exists action text';
  execute 'alter table public.elements drop constraint if exists elements_action_check';
  execute $c$alter table public.elements add constraint elements_action_check check (action is null or action in (
    'judge', 'decide', 'approve', 'answer',
    'plan', 'research', 'create', 'execute', 'verify', 'report', 'send', 'delegate', 'monitor'))$c$;
end $$;
