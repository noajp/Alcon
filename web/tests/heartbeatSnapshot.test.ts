import { describe, expect, it } from 'vitest';

// The heartbeat's inspection (_shared/heartbeatSnapshot.ts): thresholds
// are code's, dedup is the last digest's fingerprints, and escalation
// is the one re-raise. The model picks from what this file passes; it
// cannot loosen any of it.
const snap = await import(new URL('../../supabase/functions/_shared/heartbeatSnapshot.ts', import.meta.url).pathname);

const NOW = new Date('2026-11-08T12:00:00+09:00');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const signal = (over: Record<string, unknown> = {}) => ({
  kind: 'approval_element', id: 'a1', since: hoursAgo(30), label: '請求書の送付', place: 'Element で判断できます', ...over,
}) as never;

const build = (signals: unknown[], previousFingerprints: string[] = [], thresholdHours = 24) =>
  snap.buildHeartbeatSnapshot(signals as never, { now: NOW, thresholdHours, previousFingerprints });

describe('fingerprintOf', () => {
  it('names the kind, the thing, and the state’s version', () => {
    expect(snap.fingerprintOf(signal())).toBe('approval:a1');
    expect(snap.fingerprintOf(signal({ kind: 'draft_review', id: 'd1', version: 'awaiting_review' }))).toBe('draft_review:d1:awaiting_review');
    expect(snap.fingerprintOf(signal({ kind: 'run_paused', id: 'r1', version: 't2' }))).toBe('run_paused:r1:t2');
  });
});

describe('buildHeartbeatSnapshot — the threshold', () => {
  it('passes a wait older than the threshold, and only that', () => {
    const out = build([signal(), signal({ id: 'a2', since: hoursAgo(23) }), signal({ id: 'a3', since: hoursAgo(24) })]);
    expect(out.candidates.map((c: { signalId: string }) => c.signalId)).toEqual(['approval:a1', 'approval:a3']);
    expect(out.pending).toHaveLength(2);
    expect(out.silenced).toBe(0);
  });

  it('an approaching lapse raises a young wait (the deadline outranks the age)', () => {
    const out = build([
      signal({ kind: 'approval_copilot', id: 'c1', since: hoursAgo(2), expiresAt: hoursAhead(10) }),
      signal({ kind: 'approval_copilot', id: 'c2', since: hoursAgo(2), expiresAt: hoursAhead(100) }),
    ]);
    expect(out.candidates.map((c: { signalId: string }) => c.signalId)).toEqual(['approval:c1']);
    expect(out.candidates[0].expiryHours).toBeCloseTo(10);
  });

  it('caps per kind and in total, oldest first', () => {
    const many = Array.from({ length: 30 }, (_, i) => signal({ id: `a${i}`, since: hoursAgo(100 - i) }));
    const out = build(many);
    expect(out.candidates).toHaveLength(20);
    expect(out.candidates[0].signalId).toBe('approval:a0');
    const mixed = [
      ...Array.from({ length: 20 }, (_, i) => signal({ id: `a${i}`, since: hoursAgo(100 - i) })),
      ...Array.from({ length: 20 }, (_, i) => signal({ kind: 'run_failed', id: `r${i}`, since: hoursAgo(100 - i) })),
      ...Array.from({ length: 20 }, (_, i) => signal({ kind: 'draft_review', id: `d${i}`, version: 'awaiting_review', since: hoursAgo(100 - i) })),
    ];
    expect(build(mixed).candidates).toHaveLength(50);
  });
});

describe('buildHeartbeatSnapshot — dedup and escalation', () => {
  it('a told wait is quiet until the escalation line (3× the threshold)', () => {
    const quiet = build([signal({ since: hoursAgo(50) })], ['approval:a1']);
    expect(quiet.candidates).toHaveLength(0);
    expect(quiet.silenced).toBe(1);
    expect(quiet.pending).toHaveLength(1); // still counted by the inspection
  });

  it('past the escalation line it is raised once, under the esc fingerprint', () => {
    const out = build([signal({ since: hoursAgo(80) })], ['approval:a1']);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].signalId).toBe('approval:a1:esc1');
    expect(out.candidates[0].escalated).toBe(true);
  });

  it('an escalated wait is never raised a third time', () => {
    const out = build([signal({ since: hoursAgo(200) })], ['approval:a1', 'approval:a1:esc1']);
    expect(out.candidates).toHaveLength(0);
    expect(out.silenced).toBe(1);
  });

  it('a wait in a new state is a new wait (the version is in the fingerprint)', () => {
    const out = build([signal({ kind: 'run_paused', id: 'r1', version: 't9', since: hoursAgo(30) })], ['run_paused:r1:t1']);
    expect(out.candidates.map((c: { signalId: string }) => c.signalId)).toEqual(['run_paused:r1:t9']);
  });
});

describe('carryDigestFingerprints', () => {
  it('keeps told fingerprints whose waits still pend, in their told form', () => {
    expect(snap.carryDigestFingerprints(['approval:a1', 'run_failed:r1'], ['approval:a1'], []))
      .toEqual(['approval:a1']);
    expect(snap.carryDigestFingerprints(['approval:a1:esc1'], ['approval:a1'], []))
      .toEqual(['approval:a1:esc1']);
  });

  it('adds what this wake notified, and drops the resolved', () => {
    expect(snap.carryDigestFingerprints(['approval:old'], ['approval:a1'], ['approval:a1']))
      .toEqual(['approval:a1']);
    expect(snap.carryDigestFingerprints([], [], [])).toEqual([]);
  });
});

describe('digestTitleFor', () => {
  it('names the one kind, or counts across kinds', () => {
    const one = build([signal(), signal({ id: 'a2', since: hoursAgo(31) })]).candidates;
    expect(snap.digestTitleFor(one)).toBe('承認待ちが 2 件、最古は 31 時間待っています');
    const mixed = build([signal(), signal({ kind: 'run_failed', id: 'r1', since: hoursAgo(26) })]).candidates;
    expect(snap.digestTitleFor(mixed)).toBe('この Space で 2 件が待っています（最古 30 時間）');
  });
});
