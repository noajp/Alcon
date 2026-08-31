import { describe, expect, it } from 'vitest';
import { createFaultReporter, faultSignature, formatDuration, shouldEscalate } from '../../ops/faultReporter.mjs';

// The monitors report failures as transitions, not as states — and both halves
// of that can fail invisibly.
//
// Too loud is the failure everyone has already seen: a network outage produced
// one `ERROR stall-check could not read the board: fetch failed` every five
// minutes for as long as the laptop was asleep, until the only sane response
// was to mute the watch, which throws away the detector along with the noise.
//
// Too quiet is the worse one, because nothing announces it. A reporter that
// suppresses a *different* failure as though it were the old one hides an
// expired key behind a granted silence, and a reporter that forgets to say it
// recovered leaves every later silence ambiguous. Neither shows up in a log,
// so they have to be pinned here.
//
// The clock is passed in on every call: these are pure decisions about what to
// say, with no timer, no socket and no console anywhere near them.

const MINUTE = 60_000;

function reporter(graceMs = 0) {
  return createFaultReporter({
    subject: 'ERROR     could not read the board',
    restored: 'RECOVERED can read the board again',
    graceMs,
  });
}

describe('what counts as the same failure', () => {
  it('identifies an HTTP failure by status, so a varying body is still one fault', () => {
    expect(faultSignature('401 {"message":"Invalid API key","request_id":"abc"}')).toBe(
      faultSignature('401 {"message":"Invalid API key","request_id":"zzz"}'),
    );
  });

  it('separates one status from another — 401 is not 500', () => {
    expect(faultSignature('401 Unauthorized')).not.toBe(faultSignature('500 Internal Server Error'));
  });

  it('separates a network failure from an auth failure', () => {
    expect(faultSignature('fetch failed')).not.toBe(faultSignature('401 Unauthorized'));
  });

  it('blanks the parts that vary within one episode — ids and clock readings', () => {
    expect(faultSignature('lost row 0f8c2a1e-9d43-4f7b-88aa-1b2c3d4e5f60')).toBe(
      faultSignature('lost row 11111111-2222-3333-4444-555555555555'),
    );
    expect(faultSignature('stale as of 2026-08-30T04:11:02.5Z')).toBe(
      faultSignature('stale as of 2026-08-30T09:57:41.0Z'),
    );
  });

  it('keeps a small integer that names the kind — a close code is not noise', () => {
    expect(faultSignature('code 1006')).not.toBe(faultSignature('code 1000'));
  });
});

describe('a failure that keeps happening', () => {
  it('says it once and then stays quiet — a repeat is not news', () => {
    const r = reporter();
    expect(r.fault('fetch failed', 0)).toBe('ERROR     could not read the board: fetch failed');
    for (let i = 1; i <= 10; i++) {
      expect(r.fault('fetch failed', i * 5_000)).toBeNull();
    }
  });

  it('is not defeated by a body that changes while the fault does not', () => {
    const r = reporter();
    expect(r.fault('500 {"hint":null,"code":"XX000","id":"a1"}', 0)).not.toBeNull();
    expect(r.fault('500 {"hint":null,"code":"XX000","id":"b2"}', 10_000)).toBeNull();
  });
});

describe('re-reporting a long outage', () => {
  // The stall detector's rule, and the reason it is the rule: a twelve-hour
  // outage whose only line sits twelve hours in the past reads exactly like an
  // outage that ended, and re-reporting on a fixed interval is the noise this
  // module exists to remove. Doubling gives a handful of lines that get
  // further apart, so the record shows both that it started and that it is
  // still going.
  it('escalates on doubling, with a one-unit floor so an episode at zero can start', () => {
    expect(shouldEscalate(0, 0)).toBe(false);
    expect(shouldEscalate(0, 1)).toBe(true);
    expect(shouldEscalate(5, 9)).toBe(false);
    expect(shouldEscalate(5, 10)).toBe(true);
  });

  it('re-reports a 12h outage a handful of times, not 144', () => {
    const r = reporter();
    const lines: string[] = [];
    // Twelve hours at the stall watcher's real five-minute tick.
    for (let tick = 0; tick <= 144; tick++) {
      const line = r.fault('fetch failed', tick * 5 * MINUTE);
      if (line) lines.push(line);
    }
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.length).toBeLessThan(12);
    // The first line is the onset; every later one says how long it has been.
    expect(lines[0]).toBe('ERROR     could not read the board: fetch failed');
    expect(lines[1]).toContain('still failing after');
    expect(lines[lines.length - 1]).toContain('still failing after 10h 40m');
  });

  it('never reports twice at the same elapsed time', () => {
    const r = reporter();
    const at: number[] = [];
    for (let tick = 0; tick <= 200; tick++) {
      if (r.fault('fetch failed', tick * MINUTE)) at.push(tick);
    }
    expect(new Set(at).size).toBe(at.length);
    expect(at).toEqual([0, 1, 2, 4, 8, 16, 32, 64, 128]);
  });
});

describe('recovery', () => {
  it('says so, and says since when — a silence that heals must be dated', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    const line = r.ok(47 * MINUTE);
    expect(line).toBe('RECOVERED can read the board again — was down for 47m, last fault: fetch failed');
  });

  it('stays quiet when nothing was broken', () => {
    const r = reporter();
    expect(r.ok(0)).toBeNull();
    r.fault('fetch failed', 0);
    r.ok(MINUTE);
    expect(r.ok(2 * MINUTE)).toBeNull();
  });

  it('does not un-announce a blip nobody was told about', () => {
    const r = reporter(15_000);
    expect(r.fault('code 1006', 0)).toBeNull();
    expect(r.ok(3_000)).toBeNull();
  });

  it('reports a blip that outlasts the grace window, and dates it from the break', () => {
    const r = reporter(15_000);
    expect(r.fault('code 1006', 0)).toBeNull();
    expect(r.fault('code 1006', 20_000)).toBe('ERROR     could not read the board: code 1006');
    expect(r.ok(80_000)).toContain('was down for 1m');
  });
});

describe('the same failure after a recovery', () => {
  it('is a new episode, not a continuation of the old silence', () => {
    const r = reporter();
    expect(r.fault('fetch failed', 0)).not.toBeNull();
    expect(r.fault('fetch failed', 5 * MINUTE)).not.toBeNull(); // escalation
    expect(r.ok(6 * MINUTE)).not.toBeNull();
    // The outage that follows must not inherit the previous episode's
    // escalation clock — that would buy a fresh failure an hour of silence.
    expect(r.fault('fetch failed', 7 * MINUTE)).toBe('ERROR     could not read the board: fetch failed');
  });
});

describe('a failure that changes character', () => {
  it('reports the new one — an expired key must not hide behind a dead network', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    expect(r.fault('fetch failed', MINUTE)).not.toBeNull(); // escalation, then quiet
    expect(r.fault('fetch failed', 90_000)).toBeNull();
    const line = r.fault('401 {"message":"JWT expired"}', 3 * MINUTE);
    expect(line).toContain('JWT expired');
  });

  it('carries how long the previous failure had been running', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    const line = r.fault('401 Unauthorized', 3 * MINUTE);
    expect(line).toContain('fault changed after 3m');
    expect(line).toContain('fetch failed');
  });

  it('restarts the escalation clock, so the new fault is not silenced by the old one', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    for (let m = 1; m <= 60; m++) r.fault('fetch failed', m * MINUTE);
    expect(r.fault('401 Unauthorized', 61 * MINUTE)).toContain('fault changed');
    expect(r.fault('401 Unauthorized', 62 * MINUTE)).toContain('still failing after 1m');
  });

  it('recovers from the failure it is currently in, not the one it started with', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    r.fault('401 Unauthorized', 3 * MINUTE);
    const line = r.ok(4 * MINUTE);
    expect(line).toContain('last fault: 401 Unauthorized');
    // The whole blind span, not just the leg the 401 accounts for: the board
    // was unreadable from the first `fetch failed`, and a reader deciding
    // whether the silence in between was healthy needs all four minutes.
    expect(line).toContain('was down for 4m');
  });

  it('keeps the start when the first failure was never announced', () => {
    // Still inside the grace window: nothing has been said, and the machine has
    // been broken continuously, so this is one outage changing character rather
    // than two — and the clock it is measured against is when it broke.
    const r = reporter(15_000);
    expect(r.fault('code 1006', 0)).toBeNull();
    expect(r.fault('code 1001', 5_000)).toBeNull();
    expect(r.fault('code 1001', 20_000)).not.toBeNull();
    expect(r.ok(20_000)).toContain('was down for 20s');
  });
});

describe('the state left for whoever asks', () => {
  // Suppressing the repeat is only half the job. A watcher that has gone quiet
  // because it is blind must not also look healthy — otherwise the fix for the
  // noise is the original bug with better manners. `loop-report.mjs` reads this
  // back out of the lock file.
  it('is null while things work', () => {
    expect(reporter().status(0)).toBeNull();
  });

  it('says what broke and since when, including on the ticks that print nothing', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    r.fault('fetch failed', 30 * MINUTE);
    const down = r.status(90 * MINUTE);
    expect(down).toMatchObject({ message: 'fetch failed', announced: true, for: '1h 30m' });
    expect(down?.since).toBe(new Date(0).toISOString());
  });

  it('is present even for an outage still inside its grace window', () => {
    const r = reporter(15_000);
    r.fault('code 1006', 0);
    expect(r.status(5_000)).toMatchObject({ announced: false, for: '5s' });
  });

  it('dates the outage from when it broke, not from the current fault', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    r.fault('401 Unauthorized', 3 * MINUTE);
    expect(r.status(5 * MINUTE)).toMatchObject({ since: new Date(0).toISOString(), for: '5m' });
  });

  it('clears on recovery', () => {
    const r = reporter();
    r.fault('fetch failed', 0);
    r.ok(MINUTE);
    expect(r.status(MINUTE)).toBeNull();
  });
});

describe('durations a person can read', () => {
  it('scales from seconds to hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(5 * MINUTE)).toBe('5m');
    expect(formatDuration(90 * MINUTE)).toBe('1h 30m');
    expect(formatDuration(120 * MINUTE)).toBe('2h');
  });
});
