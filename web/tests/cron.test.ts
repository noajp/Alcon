import { describe, expect, it } from 'vitest';

const cron = await import(new URL('../../supabase/functions/_shared/cron.ts', import.meta.url).pathname);
const { parseCron, nextCronRun, describeCron } = cron as typeof import('../../supabase/functions/_shared/cron');

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('parseCron', () => {
  it('reads lists, ranges and steps', () => {
    const s = parseCron('*/15 9-17 * * 1-5');
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.weekdays]).toEqual([1, 2, 3, 4, 5]);
  });
  it('treats 7 as Sunday', () => {
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0]);
  });
  it('refuses what it cannot read', () => {
    expect(() => parseCron('0 9 * *')).toThrow();
    expect(() => parseCron('61 9 * * *')).toThrow();
    expect(() => parseCron('a 9 * * *')).toThrow();
    expect(() => parseCron('0 9 * * */0')).toThrow();
  });
});

describe('nextCronRun', () => {
  it('finds the next 9:00 in Tokyo', () => {
    // 2026-11-06 10:00 JST = 01:00 UTC → the next 09:00 JST is 2026-11-07 00:00 UTC
    expect(iso(nextCronRun('0 9 * * *', new Date('2026-11-06T01:00:00Z'), 'Asia/Tokyo'))).toBe('2026-11-07T00:00:00.000Z');
  });
  it('is strictly after the given time', () => {
    expect(iso(nextCronRun('0 9 * * *', new Date('2026-11-07T00:00:00Z'), 'Asia/Tokyo'))).toBe('2026-11-08T00:00:00.000Z');
  });
  it('skips the weekend for weekdays', () => {
    // Friday 2026-11-06 18:00 JST → Monday 2026-11-09 09:00 JST
    expect(iso(nextCronRun('0 9 * * 1-5', new Date('2026-11-06T09:00:00Z'), 'Asia/Tokyo'))).toBe('2026-11-09T00:00:00.000Z');
  });
  it('runs every 15 minutes', () => {
    expect(iso(nextCronRun('*/15 * * * *', new Date('2026-11-06T01:07:30Z'), 'UTC'))).toBe('2026-11-06T01:15:00.000Z');
  });
  it('matches either day field when both are restricted', () => {
    // the 1st of the month or a Monday, at 08:00 UTC; after Sat 2026-11-07 → Mon 2026-11-09
    expect(iso(nextCronRun('0 8 1 * 1', new Date('2026-11-07T00:00:00Z'), 'UTC'))).toBe('2026-11-09T08:00:00.000Z');
  });
  it('finds a leap day', () => {
    expect(iso(nextCronRun('0 0 29 2 *', new Date('2026-11-06T00:00:00Z'), 'UTC'))).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('describeCron', () => {
  it('says common schedules plainly', () => {
    expect(describeCron('0 9 * * *')).toBe('毎日 09:00');
    expect(describeCron('30 8 * * 1-5')).toBe('毎週平日 08:30');
    expect(describeCron('0 10 1 * *')).toBe('毎月1日 10:00');
    expect(describeCron('*/30 * * * *')).toBe('30分ごと');
    expect(describeCron('5 4 3 2 1')).toBe('5 4 3 2 1');
  });
});

describe('the web copy of the cron reader', () => {
  it('is the same file the automations function uses', async () => {
    const { readFileSync } = await import('node:fs');
    const fn = readFileSync(new URL('../../supabase/functions/_shared/cron.ts', import.meta.url), 'utf8');
    const web = readFileSync(new URL('../src/AIP/automation/cron.ts', import.meta.url), 'utf8');
    expect(web).toBe(fn);
  });
});
