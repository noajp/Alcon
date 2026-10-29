import { describe, expect, it } from 'vitest';
import type { Asset } from '@/types/database';
import { describeManifest, describeObserved, isLive, relayEnvLines, sortAssets } from '@/Function/integrations/assetModel';

const asset = (over: Partial<Asset>): Asset => ({
  id: over.id ?? 'a', activity_space_id: 's', name: 'x', kind: 'app', status: 'active',
  manifest: {}, observed: {}, token_prefix: 'alc_ast_0000', claimed_by: null, claimed_at: null, revoked_at: null,
  last_seen_at: null, event_count: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('describeManifest', () => {
  it('reads runtime, version, host, folder and AI providers in one line', () => {
    expect(describeManifest({ runtime: 'node 22.1.0', version: '1.4.0', host: 'mba', cwd: 'kessan', ai_providers: ['anthropic', 'openai'] }))
      .toBe('node 22.1.0 · v1.4.0 · mba/kessan · AI: anthropic, openai');
  });
  it('skips what is missing or not a string', () => {
    expect(describeManifest({ version: '2', ai_providers: [1, '', 'ollama'] })).toBe('v2 · AI: ollama');
    expect(describeManifest({})).toBe('');
  });
});

describe('describeObserved', () => {
  it('shows the address and a shortened client', () => {
    expect(describeObserved({ address: '10.0.0.1', user_agent: 'node' })).toBe('10.0.0.1 · node');
    expect(describeObserved({ user_agent: 'x'.repeat(80) })).toBe(`${'x'.repeat(57)}…`);
  });
});

describe('sortAssets', () => {
  it('puts unrecognized first, then recognized by last activity, revoked last', () => {
    const list = [
      asset({ id: 'old-active', status: 'active', last_seen_at: '2026-10-02T00:00:00Z' }),
      asset({ id: 'revoked', status: 'revoked', last_seen_at: '2026-10-09T00:00:00Z' }),
      asset({ id: 'new-active', status: 'active', last_seen_at: '2026-10-05T00:00:00Z' }),
      asset({ id: 'waiting', status: 'unclaimed', created_at: '2026-09-01T00:00:00Z' }),
    ];
    expect(sortAssets(list).map(a => a.id)).toEqual(['waiting', 'new-active', 'old-active', 'revoked']);
    expect(list[0].id).toBe('old-active');
  });
});

describe('isLive', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  it('is live within the window and not after it, never when revoked or unseen', () => {
    expect(isLive({ status: 'active', last_seen_at: '2026-10-03T11:55:00Z' }, now)).toBe(true);
    expect(isLive({ status: 'active', last_seen_at: '2026-10-03T11:40:00Z' }, now)).toBe(false);
    expect(isLive({ status: 'revoked', last_seen_at: '2026-10-03T11:59:00Z' }, now)).toBe(false);
    expect(isLive({ status: 'unclaimed', last_seen_at: null }, now)).toBe(false);
  });
});

describe('relayEnvLines', () => {
  it('gives the two variables the one line needs', () => {
    expect(relayEnvLines('https://x.supabase.co/functions/v1/asset-relay', 'sp')).toBe(
      'ALCON_RELAY=https://x.supabase.co/functions/v1/asset-relay\nALCON_SPACE=sp',
    );
  });
});
