import { describe, expect, it } from 'vitest';

// The heartbeat's credential inspection (secure-login PR4,
// _shared/credentialAnomalies.ts): anomalous credential use derived
// from the credential_uses trail alone. What qualifies, and under
// which milestone fingerprint, is code's — a pattern that keeps
// growing is re-told as it grows; a stored credential is judged
// only on a life the trail itself watched.
const anomalies = await import(new URL('../../supabase/functions/_shared/credentialAnomalies.ts', import.meta.url).pathname);
const snap = await import(new URL('../../supabase/functions/_shared/heartbeatSnapshot.ts', import.meta.url).pathname);

const NOW = new Date('2026-11-09T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

type Fact = {
  id: string; credential_kind: 'integration' | 'site' | 'once';
  integration_id: string | null; site_credential_id: string | null;
  event: string; run_id: string | null; origin: string | null; created_at: string;
};
let seq = 0;
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: `u${++seq}`, credential_kind: 'site', integration_id: null, site_credential_id: 'sc1',
  event: 'used', run_id: 'run1', origin: 'https://example.com', created_at: daysAgo(1), ...over,
});
const names = {
  integrationName: new Map([['in1', 'GitHub']]),
  siteOrigin: new Map([['sc1', 'https://example.com']]),
};
const signals = (rows: Fact[]) => anomalies.credentialAnomalySignals(rows, names, NOW);

describe('credentialAnomalies > repeated release refusals', () => {
  it('stands at three refusals for one origin, fingerprinted at the milestone', () => {
    const rows = [1, 2, 3].map((d) => fact({ event: 'release_refused', created_at: daysAgo(d) }));
    const out = signals(rows);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('credential_refused');
    expect(out[0].id).toBe('https://example.com');
    // Stood since the third refusal (rows are newest-last by day count here:
    // daysAgo(3) is the oldest, so the milestone event is daysAgo(1)).
    expect(out[0].since).toBe(daysAgo(1));
    expect(snap.fingerprintOf(out[0])).toBe('credential_refused:https://example.com:n3');
    expect(out[0].label).toContain('3 回拒否されました');
  });

  it('two refusals are not yet a pattern', () => {
    expect(signals([1, 2].map((d) => fact({ event: 'release_refused', created_at: daysAgo(d) })))).toHaveLength(0);
  });

  it('a growing pattern re-fingerprints at the next milestone', () => {
    const rows = [1, 2, 3, 4, 5].map((d) => fact({ event: 'release_refused', created_at: daysAgo(d / 10) }));
    const out = signals(rows);
    expect(out).toHaveLength(1);
    expect(snap.fingerprintOf(out[0])).toBe('credential_refused:https://example.com:n5');
  });

  it('refusals outside the window do not count', () => {
    const rows = [8, 9, 10].map((d) => fact({ event: 'release_refused', created_at: daysAgo(d) }));
    expect(signals(rows)).toHaveLength(0);
  });

  it('refusals for different origins are separate patterns', () => {
    const rows = [
      ...[1, 2, 3].map((d) => fact({ event: 'release_refused', created_at: daysAgo(d) })),
      ...[1, 2].map((d) => fact({ event: 'release_refused', origin: 'https://other.example', site_credential_id: 'sc2', created_at: daysAgo(d) })),
    ];
    const out = signals(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('https://example.com');
  });
});

describe('credentialAnomalies > repeated auth failures', () => {
  it('groups by credential and names the connection', () => {
    const rows = [1, 2, 3].map((d) => fact({
      event: 'test_failed', credential_kind: 'integration', integration_id: 'in1', site_credential_id: null, origin: null,
      created_at: daysAgo(d),
    }));
    const out = signals(rows);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('credential_auth_failed');
    expect(out[0].label).toContain('連携「GitHub」');
    expect(snap.fingerprintOf(out[0])).toBe('credential_auth_failed:in1:n3');
  });

  it('a site credential is named by its origin', () => {
    const rows = [1, 2, 3].map((d) => fact({ event: 'test_failed', created_at: daysAgo(d) }));
    const out = signals(rows);
    expect(out).toHaveLength(1);
    expect(out[0].label).toContain('https://example.com');
  });
});

describe('credentialAnomalies > stored and never used', () => {
  it('a credential stored 40 days ago and never spent stands', () => {
    const out = signals([fact({ event: 'stored', run_id: null, created_at: daysAgo(40) })]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('credential_unused');
    expect(out[0].label).toContain('保存から 40 日使われていません');
    expect(snap.fingerprintOf(out[0])).toBe(`credential_unused:site:sc1:${daysAgo(40)}`);
  });

  it('a spend after the storing clears it', () => {
    const out = signals([
      fact({ event: 'stored', run_id: null, created_at: daysAgo(40) }),
      fact({ event: 'used', created_at: daysAgo(10) }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('a replacement restarts the clock: too young since the replace', () => {
    const out = signals([
      fact({ event: 'stored', run_id: null, created_at: daysAgo(60) }),
      fact({ event: 'replaced', run_id: null, created_at: daysAgo(5) }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('a replacement 40 days old with no spend since stands on the replacement', () => {
    const out = signals([
      fact({ event: 'stored', run_id: null, created_at: daysAgo(90) }),
      fact({ event: 'used', created_at: daysAgo(80) }),
      fact({ event: 'replaced', run_id: null, created_at: daysAgo(40) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].since).toBe(daysAgo(40));
  });

  it('a credential whose storing the trail never saw is not judged', () => {
    // Uses alone — the credential predates the trail — say nothing
    // about a life never watched from birth.
    const out = signals([fact({ event: 'used', created_at: daysAgo(1) })]);
    expect(out).toHaveLength(0);
  });
});

describe('credentialAnomalies > a one-time spend no run claimed', () => {
  it('an unattributed once spend a day old stands', () => {
    const row = fact({ credential_kind: 'once', site_credential_id: null, event: 'used', run_id: null, created_at: daysAgo(2) });
    const out = signals([row]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('credential_unknown_use');
    expect(out[0].id).toBe(row.id);
  });

  it('a fresh once spend is still within its annotation grace', () => {
    const out = signals([fact({ credential_kind: 'once', site_credential_id: null, event: 'used', run_id: null, created_at: hoursAgo(2) })]);
    expect(out).toHaveLength(0);
  });

  it('an annotated spend, and ordinary run-less rows of other kinds, never stand', () => {
    const out = signals([
      fact({ credential_kind: 'once', site_credential_id: null, event: 'used', run_id: 'run9', created_at: daysAgo(2) }),
      fact({ event: 'used', run_id: null, created_at: daysAgo(2) }),
    ]);
    expect(out).toHaveLength(0);
  });
});
