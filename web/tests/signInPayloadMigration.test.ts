import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Secure-login PR3: the payload migration is the transport contract
// — a stored pair reaches the runner once, through the Vault, and
// never through asset_calls.input (member-readable). These tests
// pin what the design cannot afford to drift: the guard, the
// service-role-only doors, the delete-inside-the-take, and the
// per-call Vault name.

const sql = readFileSync(new URL('../../supabase/migrations/20261203090000_sign_in_payloads.sql', import.meta.url), 'utf8');

describe('sign-in payloads migration (secure-login PR3)', () => {
  it('is guarded for preview replay', () => {
    expect(sql).toContain("to_regclass('public.asset_calls') is null");
    expect(sql).toContain("not exists (select 1 from pg_namespace where nspname = 'vault')");
    expect(sql).toContain('raise notice');
  });

  it('stages and takes are service-role only — no browser role can call either', () => {
    expect(sql).toContain('create or replace function public.stage_sign_in_payload(');
    expect(sql).toContain('create or replace function public.take_sign_in_payload(p_call_id uuid)');
    expect(sql).toContain("execute 'revoke all on function public.stage_sign_in_payload(uuid, text) from public, anon, authenticated'");
    expect(sql).toContain("execute 'revoke all on function public.take_sign_in_payload(uuid) from public, anon, authenticated'");
    expect(sql).toContain("execute 'grant execute on function public.stage_sign_in_payload(uuid, text) to service_role'");
    expect(sql).toContain("execute 'grant execute on function public.take_sign_in_payload(uuid) to service_role'");
    expect(sql).not.toMatch(/grant execute on function public\.(stage|take)_sign_in_payload\([^)]*\) to (anon|authenticated)/);
  });

  it('the pair lives in the Vault under the call\'s own name, never in a table column', () => {
    expect(sql).toContain("'sign-in:' || p_call_id::text");
    expect(sql).toContain('vault.create_secret');
    expect(sql).not.toMatch(/alter table public\.asset_calls/);
    expect(sql).not.toMatch(/insert into public\./);
  });

  it('the take reads and deletes in the same call — a payload is delivered at most once', () => {
    expect(sql).toContain('from vault.decrypted_secrets ds');
    expect(sql).toContain('delete from vault.secrets where name = v_name');
    expect(sql).toContain('security definer');
  });

  it('the stage refuses a call that does not exist', () => {
    expect(sql).toContain('select 1 from public.asset_calls where id = p_call_id');
    expect(sql).toContain("'asset call not found'");
  });
});
