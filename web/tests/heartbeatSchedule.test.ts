import { describe, expect, it } from 'vitest';

// The heartbeat's clock (_shared/heartbeatSchedule.ts): cadences are a
// fixed list, quiet hours may cross midnight, and the schedule advances
// from the scheduled time — not from whenever the tick ran — so a busy
// minute never makes the heartbeat drift.
const sched = await import(new URL('../../supabase/functions/_shared/heartbeatSchedule.ts', import.meta.url).pathname);

const TZ = 'Asia/Tokyo';
const at = (iso: string) => new Date(iso);

describe('cadences and time parsing', () => {
  it('accepts exactly the fixed cadence list', () => {
    for (const m of [30, 60, 180, 360, 720, 1440]) expect(sched.isHeartbeatCadence(m)).toBe(true);
    for (const m of [0, 15, 45, 90, '60', null]) expect(sched.isHeartbeatCadence(m)).toBe(false);
  });

  it('reads Postgres time values as minutes of the day', () => {
    expect(sched.timeToMinutes('23:00:00')).toBe(1380);
    expect(sched.timeToMinutes('07:30')).toBe(450);
    expect(sched.timeToMinutes('00:00:00')).toBe(0);
    expect(sched.timeToMinutes('25:00')).toBeNull();
    expect(sched.timeToMinutes(null)).toBeNull();
    expect(sched.minutesToTime(1380)).toBe('23:00');
  });

  it('a quiet window needs both ends, and an empty window is no window', () => {
    expect(sched.quietHoursOf({ heartbeat_quiet_start: '23:00:00', heartbeat_quiet_end: '07:00:00' }))
      .toEqual({ startMinutes: 1380, endMinutes: 420 });
    expect(sched.quietHoursOf({ heartbeat_quiet_start: '23:00:00', heartbeat_quiet_end: null })).toBeNull();
    expect(sched.quietHoursOf({ heartbeat_quiet_start: '07:00:00', heartbeat_quiet_end: '07:00:00' })).toBeNull();
    expect(sched.quietHoursOf({})).toBeNull();
  });
});

describe('inQuietHours', () => {
  const night = { startMinutes: 1380, endMinutes: 420 }; // 23:00–07:00
  it('judges both sides of a window that crosses midnight', () => {
    expect(sched.inQuietHours(at('2026-11-08T23:30:00+09:00'), TZ, night)).toBe(true);
    expect(sched.inQuietHours(at('2026-11-09T03:00:00+09:00'), TZ, night)).toBe(true);
    expect(sched.inQuietHours(at('2026-11-09T06:59:00+09:00'), TZ, night)).toBe(true);
    expect(sched.inQuietHours(at('2026-11-09T07:00:00+09:00'), TZ, night)).toBe(false);
    expect(sched.inQuietHours(at('2026-11-08T22:59:00+09:00'), TZ, night)).toBe(false);
    expect(sched.inQuietHours(at('2026-11-08T12:00:00+09:00'), TZ, night)).toBe(false);
  });

  it('judges a same-day window and no window', () => {
    const lunch = { startMinutes: 720, endMinutes: 780 }; // 12:00–13:00
    expect(sched.inQuietHours(at('2026-11-08T12:30:00+09:00'), TZ, lunch)).toBe(true);
    expect(sched.inQuietHours(at('2026-11-08T13:00:00+09:00'), TZ, lunch)).toBe(false);
    expect(sched.inQuietHours(at('2026-11-08T12:30:00+09:00'), TZ, null)).toBe(false);
  });

  it('reads the moment in the Space’s timezone, not the server’s', () => {
    // 23:30 in Tokyo is 14:30 UTC; the window is Tokyo's.
    expect(sched.inQuietHours(at('2026-11-08T14:30:00Z'), TZ, night)).toBe(true);
    expect(sched.inQuietHours(at('2026-11-08T14:30:00Z'), 'UTC', night)).toBe(false);
  });
});

describe('nextHeartbeatAt', () => {
  it('advances from the scheduled time, not from now', () => {
    const next = sched.nextHeartbeatAt(at('2026-11-08T10:00:00+09:00'), 60, at('2026-11-08T10:20:00+09:00'), TZ, null);
    expect(next.toISOString()).toBe(at('2026-11-08T11:00:00+09:00').toISOString());
  });

  it('steps over beats missed while the tick was away', () => {
    const next = sched.nextHeartbeatAt(at('2026-11-08T10:00:00+09:00'), 60, at('2026-11-08T13:45:00+09:00'), TZ, null);
    expect(next.toISOString()).toBe(at('2026-11-08T14:00:00+09:00').toISOString());
  });

  it('a landing inside quiet hours moves to the window’s end', () => {
    const night = { startMinutes: 1380, endMinutes: 420 };
    const next = sched.nextHeartbeatAt(at('2026-11-08T22:30:00+09:00'), 60, at('2026-11-08T22:35:00+09:00'), TZ, night);
    expect(next.toISOString()).toBe(at('2026-11-09T07:00:00+09:00').toISOString());
  });

  it('quietAdjusted returns the moment itself outside the window', () => {
    const noon = at('2026-11-08T12:00:00+09:00');
    expect(sched.quietAdjusted(noon, TZ, { startMinutes: 1380, endMinutes: 420 }).toISOString()).toBe(noon.toISOString());
  });
});
