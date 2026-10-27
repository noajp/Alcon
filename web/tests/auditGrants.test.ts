import { describe, expect, it } from 'vitest';

// The pure half of audit-grants (ADR 0046): the request a gateway signs, the
// signed table, and how the gateway decides an operation from it.
const grants = await import(new URL('../../supabase/functions/_shared/auditGrants.ts', import.meta.url).pathname);

const DEP = '7c1e2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b';
const PAUSED = '0f1e2d3c-4b5a-4968-8776-655443322110';
const NOW = Date.parse('2026-10-28T09:00:00.000Z');

function table(issuedMs = NOW) {
  return grants.buildGrantsTable({
    spaceId: 'space', keyId: 'key', signingKey: 'k', now: new Date(issuedMs),
    deployments: [
      { deployment_id: PAUSED, state: 'paused', version: 2, grants: [{ connector: 'mail', operation: 'read' }] },
      { deployment_id: DEP, state: 'live', version: 4, grants: [{ connector: 'mail', operation: 'send' }, { connector: 'erp', operation: 'draft' }, { connector: 'mail', operation: 'read' }] },
    ],
  });
}

describe('buildGrantsTable', () => {
  it('orders deployments and grants so the same grants are the same bytes', () => {
    const t = table();
    expect(t.deployments.map((d: { deployment_id: string }) => d.deployment_id)).toEqual([PAUSED, DEP]);
    expect(t.deployments[1].grants).toEqual([
      { connector: 'erp', operation: 'draft' }, { connector: 'mail', operation: 'read' }, { connector: 'mail', operation: 'send' },
    ]);
    expect(Date.parse(t.expires_at) - Date.parse(t.issued_at)).toBe(grants.GRANTS_TTL_SECONDS * 1000);
  });
});

describe('decideOperation', () => {
  it('allows what is granted and nothing else', () => {
    const t = table();
    expect(grants.decideOperation(t, NOW, DEP, 'mail', 'send')).toEqual({ allowed: true, grants_version: 4 });
    expect(grants.decideOperation(t, NOW, DEP, 'mail', 'money')).toEqual({ allowed: false, grants_version: 4, reason: 'outside grant' });
    expect(grants.decideOperation(t, NOW, DEP, 'erp', 'send')).toMatchObject({ allowed: false, reason: 'outside grant' });
    expect(grants.decideOperation(t, NOW, DEP, null, 'read')).toMatchObject({ allowed: false, reason: 'outside grant' });
  });

  it('stops send and money once the table expires, but not read and draft', () => {
    const t = table(NOW - grants.GRANTS_TTL_SECONDS * 1000);
    expect(grants.decideOperation(t, NOW, DEP, 'mail', 'send')).toMatchObject({ allowed: false, reason: 'expired' });
    expect(grants.decideOperation(t, NOW, DEP, 'mail', 'read')).toMatchObject({ allowed: true });
    expect(grants.decideOperation(t, NOW, DEP, 'erp', 'draft')).toMatchObject({ allowed: true });
  });

  it('allows nothing without a table, for an unknown deployment, or a paused one', () => {
    expect(grants.decideOperation(null, NOW, DEP, 'mail', 'read')).toMatchObject({ allowed: false, reason: 'no table' });
    expect(grants.decideOperation(table(), NOW, 'other', 'mail', 'read')).toMatchObject({ allowed: false, reason: 'unknown deployment' });
    expect(grants.decideOperation(table(), NOW, PAUSED, 'mail', 'read')).toMatchObject({ allowed: false, reason: 'paused', grants_version: 2 });
    expect(grants.decideOperation(null, NOW, DEP, null, 'none')).toEqual({ allowed: true, grants_version: null });
  });
});

describe('requests and signatures', () => {
  it('takes a request only near the present', () => {
    expect(grants.requestIsFresh(String(NOW / 1000 - 60), NOW)).toBe(true);
    expect(grants.requestIsFresh(String(NOW / 1000 - grants.REQUEST_SKEW_SECONDS - 1), NOW)).toBe(false);
    expect(grants.requestIsFresh('1.5e9', NOW)).toBe(false);
  });

  it('a table reads only under the pinned key it was signed with', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const pkcs8 = grants.base64UrlEncode(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const loaded = await grants.loadSigningKey(pkcs8);
    const pinned = grants.base64UrlEncode(await crypto.subtle.exportKey('raw', pair.publicKey));
    const otherKey = grants.base64UrlEncode(await crypto.subtle.exportKey('raw', other.publicKey));
    expect(loaded.publicKey).toBe(pinned);

    const body = new TextEncoder().encode(JSON.stringify({ ...table(), signing_key: loaded.publicKey }));
    const signature = grants.base64UrlEncode(await crypto.subtle.sign({ name: 'Ed25519' }, loaded.key, body));
    expect((await grants.readGrantsTable(pinned, signature, body))?.deployments).toHaveLength(2);
    expect(await grants.readGrantsTable(otherKey, signature, body)).toBeNull();
    const widened = new TextEncoder().encode(new TextDecoder().decode(body).replace('"draft"', '"money"'));
    expect(await grants.readGrantsTable(pinned, signature, widened)).toBeNull();
    expect(await grants.loadSigningKey('not a key')).toBeNull();
  });
});
