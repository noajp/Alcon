import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Approval modes arrive in one migration (20261127090000): the Space's
// mode column with 'auto' as the default (today's meaning exactly), a
// run's snapshot of the mode it started under, who decided an action
// (a person, or the Space's policy), the change history, and the one
// RPC that changes the mode. These tests pin the migration's shape —
// above all that the default changes nothing for existing Spaces and
// that only an owner can move the mode.

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('20261127090000_space_approval_modes.sql');

describe('approval modes migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("if to_regclass('public.activity_spaces') is null then");
    expect(migration).toContain('raise notice');
    expect(migration).toContain("to_regclass('public.agent_runs') is not null");
    expect(migration).toContain("to_regclass('public.agent_actions') is not null");
  });

  it("lands every Space on 'auto', the mode that changes nothing", () => {
    expect(migration).toContain("add column if not exists approval_mode text not null default ''auto''");
    expect(migration).toContain("check (approval_mode in (''ask'', ''auto'', ''free''))");
  });

  it('snapshots the mode on the run, nullable until the engine stamps it', () => {
    expect(migration).toContain('alter table public.agent_runs add column if not exists approval_mode text');
    expect(migration).toContain("approval_mode is null or approval_mode in (''ask'', ''auto'', ''free'')");
  });

  it("marks policy approvals on the action, beside the person's shape", () => {
    expect(migration).toContain('add column if not exists decision_source text');
    expect(migration).toContain('add column if not exists policy_mode text');
    expect(migration).toContain("decision_source is null or decision_source = ''policy''");
  });

  it('keeps a change history members can read and nobody writes directly', () => {
    expect(migration).toContain('create table if not exists public.space_approval_mode_changes');
    expect(migration).toContain('public.is_activity_space_member(activity_space_id)');
    expect(migration).not.toMatch(/create policy space_approval_mode_changes_(insert|update|delete)/);
  });

  it('changes the mode only through the owner-checked RPC, atomically with its history', () => {
    expect(migration).toContain('create or replace function public.set_space_approval_mode(p_space_id uuid, p_mode text)');
    expect(migration).toContain('security definer');
    expect(migration).toContain('public.is_activity_space_owner(p_space_id)');
    expect(migration).toContain("using errcode = '42501'");
    expect(migration).toContain('insert into public.space_approval_mode_changes');
    expect(migration).toContain("if p_mode not in ('ask', 'auto', 'free')");
    expect(migration).toContain('revoke all on function public.set_space_approval_mode(uuid, text) from public');
    expect(migration).toContain('grant execute on function public.set_space_approval_mode(uuid, text) to authenticated');
  });
});
