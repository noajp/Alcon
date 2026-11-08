import { describe, expect, it } from 'vitest';
import { topicKeyOf as webTopicKeyOf } from '@/Function/settings/memoryModel';

// Memory's store discipline (_shared/memoryStore.ts): the topic key
// that makes one fact one memory, the fingerprint that makes a
// re-driven finish distill once, the supersede decision, promotion at
// 3 uses, and the 90-day episode life. The web twin's key function is
// pinned to the engine's here.
const store = await import(new URL('../../supabase/functions/_shared/memoryStore.ts', import.meta.url).pathname);

const candidate = (over: Record<string, unknown> = {}) => ({
  kind: 'procedure', title: 'X の一覧 API は limit を絞る', gist: 'limit=50 以下でないと 504', body: 'limit=50 以下でないと 504 になる。',
  topic: 'X 一覧 API の上限', ...over,
}) as never;

describe('topicKeyOf', () => {
  it('folds case, width and whitespace so one fact keys once', () => {
    expect(store.topicKeyOf('  X  一覧 API の上限 ')).toBe('x 一覧 api の上限');
    expect(store.topicKeyOf('Ｘ 一覧')).toBe('x 一覧');
    expect(store.topicKeyOf('')).toBeNull();
    expect(store.topicKeyOf(null)).toBeNull();
    expect(store.topicKeyOf(undefined)).toBeNull();
  });

  it('is the same function on the web side', () => {
    for (const s of ['請求書 の 締め日', 'Slack 連携の癖', '  ', 'A  B']) {
      expect(webTopicKeyOf(s)).toBe(store.topicKeyOf(s));
    }
  });
});

describe('fingerprintOf', () => {
  it('separates by scope, topic and target — and meets across writings', () => {
    const a = store.fingerprintOf(candidate(), 'space', 's1', 'u1');
    const b = store.fingerprintOf(candidate({ topic: ' x 一覧 api の上限 ' }), 'space', 's1', 'u1');
    expect(a).toBe(b);
    expect(store.fingerprintOf(candidate(), 'personal', null, 'u1')).not.toBe(a);
    expect(store.fingerprintOf(candidate({ elementId: 'e1' }), 'space', 's1', 'u1')).not.toBe(a);
  });

  it('falls back to the title when there is no topic', () => {
    const fp = store.fingerprintOf(candidate({ topic: null }), 'space', 's1', 'u1');
    expect(fp).toContain('title:');
  });
});

describe('decideEpisodeWrite', () => {
  it('drops a candidate whose fingerprint already stands active', () => {
    const fp = store.fingerprintOf(candidate(), 'space', 's1', 'u1');
    const existing = [{ id: 'm1', fingerprint: fp, status: 'active' }];
    expect(store.decideEpisodeWrite(candidate(), 'space', 's1', 'u1', existing)).toEqual({ action: 'drop-duplicate', existingId: 'm1' });
    expect(store.decideEpisodeWrite(candidate(), 'space', 's1', 'u1', [{ ...existing[0], status: 'superseded' }])).toEqual({ action: 'write' });
    expect(store.decideEpisodeWrite(candidate({ topic: '別の話題' }), 'space', 's1', 'u1', existing)).toEqual({ action: 'write' });
  });
});

describe('supersedeTargetFor', () => {
  const durable = (over: Record<string, unknown> = {}) => ({
    id: 'd1', layer: 'durable', status: 'active', scope: 'space', activity_space_id: 's1', user_id: null,
    topic_key: 'x 一覧 api の上限', ...over,
  }) as never;

  it('finds the active durable holding the topic in the same scope', () => {
    expect(store.supersedeTargetFor('x 一覧 api の上限', 'space', 's1', 'u1', [durable()])).toBe('d1');
    expect(store.supersedeTargetFor('x 一覧 api の上限', 'space', 's2', 'u1', [durable()])).toBeNull();
    expect(store.supersedeTargetFor('x 一覧 api の上限', 'personal', null, 'u1', [durable()])).toBeNull();
    expect(store.supersedeTargetFor(null, 'space', 's1', 'u1', [durable()])).toBeNull();
    expect(store.supersedeTargetFor('x 一覧 api の上限', 'space', 's1', 'u1', [durable({ status: 'superseded' })])).toBeNull();
    expect(store.supersedeTargetFor('x 一覧 api の上限', 'space', 's1', 'u1', [durable({ layer: 'episode' })])).toBeNull();
  });

  it('never supersedes itself (an episode promoting into its own slot)', () => {
    expect(store.supersedeTargetFor('x 一覧 api の上限', 'space', 's1', 'u1', [durable()], 'd1')).toBeNull();
  });
});

describe('promotion and expiry', () => {
  it('promotes an active episode at exactly 3 uses, nothing else', () => {
    expect(store.PROMOTE_USE_COUNT).toBe(3);
    expect(store.promotionDue({ layer: 'episode', status: 'active', use_count: 3 })).toBe(true);
    expect(store.promotionDue({ layer: 'episode', status: 'active', use_count: 2 })).toBe(false);
    expect(store.promotionDue({ layer: 'durable', status: 'active', use_count: 9 })).toBe(false);
    expect(store.promotionDue({ layer: 'episode', status: 'superseded', use_count: 9 })).toBe(false);
  });

  it('gives an episode 90 days, and the sweep leaves pinned ones alone', () => {
    const from = new Date('2026-11-08T00:00:00Z');
    expect(store.EPISODE_TTL_DAYS).toBe(90);
    expect(store.episodeExpiry(from).toISOString()).toBe('2027-02-06T00:00:00.000Z');
    const m = { layer: 'episode', status: 'active', expires_at: '2026-11-01T00:00:00Z', pinned: false };
    expect(store.episodeExpired(m, new Date('2026-11-08T00:00:00Z'))).toBe(true);
    expect(store.episodeExpired({ ...m, pinned: true }, new Date('2026-11-08T00:00:00Z'))).toBe(false);
    expect(store.episodeExpired({ ...m, expires_at: '2027-01-01T00:00:00Z' }, new Date('2026-11-08T00:00:00Z'))).toBe(false);
  });
});
