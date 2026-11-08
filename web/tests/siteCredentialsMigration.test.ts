import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Secure-login PR1: the two migrations are the storage contract —
// a site-credential class extending the Vault pattern exactly. These
// tests pin what the design cannot afford to drift: the owner-only
// write (D1), the covered-host refusal with its force flag (D5), the
// service-role-only read, the Vault key the secret lives under, and
// an audit table no browser can write.

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const storage = read('20261201090000_site_credentials.sql');
const requests = read('20261201100000_credential_requests.sql');

describe('site credentials migration (secure-login PR1)', () => {
  it('is guarded for preview replay', () => {
    expect(storage).toContain("to_regclass('public.activity_spaces') is null");
    expect(storage).toContain("not exists (select 1 from pg_namespace where nspname = 'vault')");
    expect(storage).toContain('raise notice');
    expect(requests).toContain("to_regclass('public.site_credentials') is null");
    expect(requests).toContain('raise notice');
  });

  it('creates the store, unique per Space and origin', () => {
    expect(storage).toContain('create table if not exists public.site_credentials');
    expect(storage).toContain('unique (activity_space_id, origin)');
    expect(storage).toContain("origin ~ '^https?://[a-z0-9.\\-]+(:[0-9]{1,5})?$'");
    expect(storage).toContain('secret_id uuid');
    expect(storage).toContain('last_test jsonb');
  });

  it('canonicalizes the origin server-side, in one shared function', () => {
    expect(storage).toContain('create or replace function public.normalize_site_origin(p_origin text)');
    expect(storage).toContain("v_scheme not in ('http', 'https')");
    expect(storage).toContain("if position('@' in v_authority) > 0 then return null; end if;");
    expect(storage).toContain('revoke all on function public.normalize_site_origin(text) from public, anon, authenticated');
  });

  it('members read the metadata; nobody writes the table directly', () => {
    expect(storage).toContain('create policy site_credentials_select on public.site_credentials');
    expect(storage).toContain('public.is_activity_space_member(activity_space_id)');
    expect(storage).not.toMatch(/create policy site_credentials_(insert|update)/);
    expect(storage).toContain('create policy site_credentials_delete on public.site_credentials');
    expect(storage).toContain('public.is_activity_space_owner(activity_space_id)');
  });

  it('writes only through the owner-checked by-origin RPC (D1)', () => {
    expect(storage).toContain('create or replace function public.set_site_credential_by_origin(');
    expect(storage).toContain('security definer');
    expect(storage).toContain('not public.is_activity_space_owner(p_activity_space_id)');
    expect(storage).toContain("raise exception 'not allowed' using errcode = '42501'");
    expect(storage).toContain('grant execute on function public.set_site_credential_by_origin(uuid, text, text, text, text, boolean) to authenticated');
  });

  it('keeps the Vault idiom: found by name, empty value deletes, PATs refused', () => {
    expect(storage).toContain("'site-credential:' || v_row.id::text");
    expect(storage).toContain('select id into v_secret_id from vault.secrets where name = v_name');
    expect(storage).toContain('if p_password is null or length(p_password) = 0 then');
    expect(storage).toContain("position('alc_pat_' in p_password) > 0");
    expect(storage).toContain("jsonb_build_object('username', btrim(p_username), 'password', p_password)::text");
  });

  it('refuses a host a connection already covers, unless forced (D5)', () => {
    expect(storage).toContain('p_force boolean default false');
    expect(storage).toContain("lower(substring(i.endpoint from '^https?://([^/:?#]+)')) = substring(v_origin from '^https?://([^/:]+)')");
    expect(storage).toContain("return 'covered_by_connection'");
  });

  it('reads back through one service-role-only function', () => {
    expect(storage).toContain('create or replace function public.get_site_credential(p_site_credential_id uuid)');
    expect(storage).toContain("ds.name = 'site-credential:' || p_site_credential_id::text");
    expect(storage).toContain('revoke all on function public.get_site_credential(uuid) from authenticated');
    expect(storage).toContain('revoke all on function public.get_site_credential(uuid) from anon');
    expect(storage).toContain('grant execute on function public.get_site_credential(uuid) to service_role');
  });

  it('a deleted row takes its Vault secret with it', () => {
    expect(storage).toContain('create trigger trg_site_credentials_drop_secret after delete on public.site_credentials');
    expect(storage).toContain("delete from vault.secrets where name = 'site-credential:' || old.id::text");
  });

  it('lands the append-only audit with lifecycle writes in the RPC', () => {
    expect(storage).toContain('create table if not exists public.credential_uses');
    expect(storage).toContain("event in ('stored', 'replaced', 'deleted', 'declined', 'used', 'test_failed', 'release_refused')");
    expect(storage).toContain('create policy credential_uses_select on public.credential_uses');
    expect(storage).not.toMatch(/create policy credential_uses_(insert|update|delete)/);
    expect(storage).toContain("insert into public.credential_uses (activity_space_id, credential_kind, site_credential_id, event, actor_id, origin)");
    expect(storage).toContain("'site', v_row.id, v_event, auth.uid(), v_origin");
    expect(storage).toContain("'site', v_row.id, 'deleted', auth.uid(), v_origin");
  });
});

describe('credential requests migration (secure-login PR1 schema)', () => {
  it('creates the request record with the design’s states', () => {
    expect(requests).toContain('create table if not exists public.credential_requests');
    expect(requests).toContain("kind in ('integration_secret', 'site_login')");
    expect(requests).toContain("status in ('pending', 'saved', 'used_once', 'declined', 'expired', 'superseded')");
    expect(requests).toContain('need jsonb not null');
    expect(requests).toContain('expires_at timestamptz');
  });

  it('members read requests; nobody writes the table directly', () => {
    expect(requests).toContain('create policy credential_requests_select on public.credential_requests');
    expect(requests).not.toMatch(/create policy credential_requests_(insert|update|delete)/);
  });

  it('the capture submit is addressed by request id and reads the origin off the row', () => {
    expect(requests).toContain('create or replace function public.set_site_credential(');
    expect(requests).toContain("if v_req.status <> 'pending' then");
    expect(requests).toContain('public.set_site_credential_by_origin(');
    expect(requests).toContain('v_req.activity_space_id, v_req.origin, v_username, p_password, null, false');
    expect(requests).toContain("set status = 'saved'");
    expect(requests).toContain('decided_by = auth.uid()');
    expect(requests).toContain('grant execute on function public.set_site_credential(uuid, text, text) to authenticated');
  });
});
