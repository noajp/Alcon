import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Secure-login PR2 (design §5.2): the use-once stash and the request
// lifecycle RPCs. The stash holds NO value column — the value lives in
// the Vault under a per-request name and is taken exactly once through
// a service-role-only RPC. These are source-level guards: the shape
// the production catch-up will apply, pinned here the way the repo
// pins every migration.

const sql = readFileSync(new URL('../../supabase/migrations/20261202090000_credential_capture.sql', import.meta.url), 'utf8');

describe('20261202090000 credential capture migration', () => {
  it('is guarded for a safe re-apply', () => {
    expect(sql).toContain("to_regclass('public.credential_requests')");
    expect(sql).toContain("to_regclass('public.credential_uses')");
    expect(sql).toContain("nspname = 'vault'");
    expect(sql).toContain("to_regprocedure('public.is_activity_space_owner(uuid)')");
    expect(sql).toContain('create table if not exists public.credential_once_stash');
  });

  it('the stash holds no value — only the request’s address and its expiry', () => {
    const stashBlock = sql.slice(sql.indexOf('create table if not exists public.credential_once_stash'), sql.indexOf('alter table public.credential_once_stash'));
    expect(stashBlock).toContain('request_id uuid primary key');
    expect(stashBlock).toContain('expires_at timestamptz not null');
    expect(stashBlock).not.toMatch(/\bvalue\b/);
    expect(stashBlock).not.toMatch(/\bsecret\b/);
    expect(stashBlock).not.toMatch(/password/);
  });

  it('the stash table is reachable by no client role (service role bypasses)', () => {
    expect(sql).toContain('revoke all on table public.credential_once_stash from public, anon, authenticated');
  });

  it('stash is owner-only, TTL-bound at ten minutes, and refuses an Alcon PAT', () => {
    expect(sql).toContain('public.stash_credential_once(');
    expect(sql).toContain('p_value text');
    expect(sql).toContain('is_activity_space_owner(v_req.activity_space_id)');
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("position('alc_pat_' in p_value) > 0");
    expect(sql).toContain('grant execute on function public.stash_credential_once(uuid, text, text) to authenticated');
  });

  it('the take is service-role only, single (row lock + delete inside the call)', () => {
    expect(sql).toContain('for update');
    expect(sql).toContain('delete from public.credential_once_stash');
    expect(sql).toContain('revoke all on function public.take_credential_once(uuid) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.take_credential_once(uuid) to service_role');
  });

  it('the take destroys the secret and the stash whether it succeeds or not', () => {
    // Single-take: both deletes run unconditionally inside the take,
    // before the expiry check seals a stale request expired.
    expect(sql).toContain("delete from vault.secrets where name = 'credential-once:' || p_request_id::text");
    expect(sql).toContain('delete from public.credential_once_stash where request_id = p_request_id');
    expect(sql).toContain('if v_stash.expires_at < now() or v_secret is null then');
  });

  it('decline and complete are person-called and re-check their caller', () => {
    expect(sql).toContain('grant execute on function public.decline_credential_request(uuid) to authenticated');
    expect(sql).toContain('grant execute on function public.complete_credential_request(uuid) to authenticated');
    // Complete seals 'saved' only over a secret that is actually stored.
    expect(sql).toContain('if v_secret_id is null then');
    expect(sql).toContain("return 'not_saved'");
  });

  it('expiry is swept by a service-role-only function', () => {
    expect(sql).toContain('revoke all on function public.expire_credential_requests() from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.expire_credential_requests() to service_role');
  });

  it('deleting a request takes its once-secret with it', () => {
    expect(sql).toContain('trg_credential_requests_drop_once_secret');
  });

  it('a use-once secret lives under the per-request Vault name', () => {
    expect(sql).toContain("'credential-once:' || p_request_id::text");
  });
});
