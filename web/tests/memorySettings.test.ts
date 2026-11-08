import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fingerprintOf as webFingerprintOf } from '@/Function/settings/memoryModel';

// The settings side of Memory (PR4): the web twin's fingerprint must
// agree with the engine's — a memory shared into a Space is
// fingerprinted by the screen, and deduped by the store — and the
// automations tick must retire episodes the way the design says:
// unpinned, active, past their 90 days, bounded, and only ever to
// 'expired' (provenance survives; nothing is deleted by the sweep).
const store = await import(new URL('../../supabase/functions/_shared/memoryStore.ts', import.meta.url).pathname);
const tick = readFileSync(new URL('../../supabase/functions/automations/index.ts', import.meta.url).pathname, 'utf8');

describe('the fingerprint twin', () => {
  const candidate = {
    kind: 'fact', title: '請求書は税込で送る', gist: '', body: '税込で送る。',
    topic: '請求書', integrationName: null, elementId: null, strategyId: null,
  };
  const row = { topic_key: '請求書', title: '請求書は税込で送る', element_id: null, strategy_id: null, integration_name: null };

  it('keys a Space copy exactly as the store keys the candidate', () => {
    expect(webFingerprintOf(row, 'space', 'sp1', 'u1')).toBe(store.fingerprintOf(candidate, 'space', 'sp1', 'u1'));
    expect(webFingerprintOf(row, 'personal', null, 'u1')).toBe(store.fingerprintOf(candidate, 'personal', null, 'u1'));
  });

  it('falls back to the title the same way on both sides', () => {
    const noTopic = { ...candidate, topic: null };
    const noKey = { ...row, topic_key: null };
    expect(webFingerprintOf(noKey, 'space', 'sp1', 'u1')).toBe(store.fingerprintOf(noTopic, 'space', 'sp1', 'u1'));
  });
});

describe('the episode sweep on the automations tick', () => {
  it('retires only unpinned, active episodes past their expiry, a bounded batch at a time', () => {
    expect(tick).toContain('.from("memories")');
    expect(tick).toContain('.eq("layer", "episode").eq("status", "active").eq("pinned", false)');
    expect(tick).toContain('.lt("expires_at", now.toISOString())');
    expect(tick).toContain('episodesExpired');
  });

  it('expires in place — the row and its provenance stay', () => {
    expect(tick).toContain('update({ status: "expired"');
    expect(tick).not.toContain('.from("memories").delete');
    expect(tick).not.toContain('from("memories").delete');
  });
});
