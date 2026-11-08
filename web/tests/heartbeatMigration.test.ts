import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The heartbeat arrives in one migration (20261128090000): the Space's
// settings columns (opt-in, off by default), the Space as a run's
// subject, the digest's notification kind and its link back to the
// wake, and the one owner-checked RPC that changes the settings. These
// tests pin that shape — above all that an existing Space gains a
// heartbeat that is off, and that the wake's record belongs to the
// Space's members while its settings move only at an owner's hand.

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('20261128090000_heartbeat.sql');

describe('heartbeat migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("to_regclass('public.activity_spaces') is not null");
    expect(migration).toContain("to_regclass('public.agent_runs') is not null");
    expect(migration).toContain("to_regclass('public.notifications') is not null");
    expect(migration).toContain('raise notice');
  });

  it('lands every Space with the heartbeat off and the recommended defaults', () => {
    expect(migration).toContain("add column if not exists heartbeat_enabled boolean not null default false");
    expect(migration).toContain("add column if not exists heartbeat_cadence_minutes integer not null default 60");
    expect(migration).toContain("add column if not exists heartbeat_notify_after_hours numeric not null default 24");
    expect(migration).toContain("add column if not exists heartbeat_monthly_budget_usd numeric(10,2) not null default 2.00");
    expect(migration).toContain("add column if not exists heartbeat_timezone text not null default ''Asia/Tokyo''");
    expect(migration).toContain('check (heartbeat_cadence_minutes in (30, 60, 180, 360, 720, 1440))');
  });

  it('carries the schedule, the actor and the tick’s arrival stamp', () => {
    expect(migration).toContain('add column if not exists heartbeat_owner_id uuid references auth.users(id) on delete set null');
    expect(migration).toContain('add column if not exists heartbeat_next_at timestamptz');
    expect(migration).toContain('add column if not exists heartbeat_last_wake_at timestamptz');
    expect(migration).toContain('add column if not exists heartbeat_last_tick_at timestamptz');
    expect(migration).toContain('activity_spaces_heartbeat_due_idx');
  });

  it("makes the Space a run's subject through its mode, members reading the record", () => {
    expect(migration).toContain("|| ' or mode = ''heartbeat'''");
    expect(migration).toContain("agent_runs_subject_check check (' || v_check || ')");
    expect(migration).toContain("' when mode = ''heartbeat'' then public.is_activity_space_member(activity_space_id)'");
    expect(migration).toContain('create policy agent_runs_select on public.agent_runs for select using');
  });

  it("adds the 'heartbeat' kind by restating the whole check, and the wake link", () => {
    expect(migration).toContain("''measure_missed'', ''heartbeat'''");
    expect(migration).toContain('add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null');
    expect(migration).toContain('notifications_agent_run_idx');
  });

  it('changes the settings only through the owner-checked RPC', () => {
    expect(migration).toContain('create or replace function public.set_space_heartbeat(');
    expect(migration).toContain('security definer');
    expect(migration).toContain('public.is_activity_space_owner(p_space_id)');
    expect(migration).toContain("using errcode = '42501'");
    // Enabling names the caller as the wake's actor and schedules it;
    // disabling clears the schedule.
    expect(migration).toContain('heartbeat_owner_id = (select auth.uid())');
    expect(migration).toContain('heartbeat_next_at = now() + make_interval(mins => p_cadence_minutes)');
    expect(migration).toContain('heartbeat_enabled = false, heartbeat_next_at = null');
    expect(migration).toContain('revoke all on function public.set_space_heartbeat(uuid, boolean, integer, numeric, time, time, text, numeric) from public');
    expect(migration).toContain('grant execute on function public.set_space_heartbeat(uuid, boolean, integer, numeric, time, time, text, numeric) to authenticated');
    expect(migration).toContain('grant select (heartbeat_enabled, heartbeat_owner_id, heartbeat_cadence_minutes');
  });
});
