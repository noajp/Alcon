import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_CADENCES, heartbeatSettingsOf, monthSpendOf, tickState,
} from '@/Function/settings/heartbeatModel';

// The settings screen's pure judgements: a row becomes the settings
// shape with the design's defaults, the tick's arrival is read from
// its stamp (the only sign of a per-environment drive the app can
// see), and the month's spend counts only this month's wakes.
describe('heartbeatSettingsOf', () => {
  it('defaults an untouched Space to the recommended shape', () => {
    expect(heartbeatSettingsOf(null)).toEqual({
      enabled: false, ownerId: null, cadenceMinutes: 60, nextAt: null,
      timezone: 'Asia/Tokyo', quietStart: null, quietEnd: null,
      notifyAfterHours: 24, monthlyBudgetUsd: 2, lastWakeAt: null, lastTickAt: null,
    });
  });

  it('reads a row, trimming Postgres times to HH:MM', () => {
    const s = heartbeatSettingsOf({
      heartbeat_enabled: true, heartbeat_owner_id: 'u1', heartbeat_cadence_minutes: 180,
      heartbeat_next_at: '2026-11-08T13:00:00Z', heartbeat_timezone: 'UTC',
      heartbeat_quiet_start: '23:00:00', heartbeat_quiet_end: '07:00:00',
      heartbeat_notify_after_hours: '12', heartbeat_monthly_budget_usd: '3.50',
      heartbeat_last_wake_at: '2026-11-08T12:00:00Z', heartbeat_last_tick_at: '2026-11-08T12:34:00Z',
    });
    expect(s.enabled).toBe(true);
    expect(s.cadenceMinutes).toBe(180);
    expect(s.quietStart).toBe('23:00');
    expect(s.quietEnd).toBe('07:00');
    expect(s.notifyAfterHours).toBe(12);
    expect(s.monthlyBudgetUsd).toBe(3.5);
  });

  it('offers exactly the cadences the database accepts', () => {
    expect(HEARTBEAT_CADENCES.map((c) => c.minutes)).toEqual([30, 60, 180, 360, 720, 1440]);
  });
});

describe('tickState', () => {
  const now = new Date('2026-11-08T12:35:00Z');
  const base = heartbeatSettingsOf(null);
  it('is off with the heartbeat, whatever the stamp', () => {
    expect(tickState({ ...base, lastTickAt: now.toISOString() }, now)).toBe('off');
  });
  it('arriving while the stamp is fresh, stale as it ages, never when absent', () => {
    expect(tickState({ ...base, enabled: true, lastTickAt: '2026-11-08T12:34:00Z' }, now)).toBe('arriving');
    expect(tickState({ ...base, enabled: true, lastTickAt: '2026-11-08T12:00:00Z' }, now)).toBe('stale');
    expect(tickState({ ...base, enabled: true, lastTickAt: null }, now)).toBe('never');
  });
});

describe('monthSpendOf', () => {
  it("sums only the current month's wakes", () => {
    const wakes = [
      { cost_usd: 0.01, created_at: '2026-11-02T00:00:00Z' },
      { cost_usd: '0.02', created_at: '2026-11-08T00:00:00Z' },
      { cost_usd: 5, created_at: '2026-10-31T23:59:00Z' },
    ];
    expect(monthSpendOf(wakes, new Date('2026-11-08T12:00:00Z'))).toBeCloseTo(0.03);
  });
});
