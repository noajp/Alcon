import { describe, expect, it } from 'vitest';
import { URGENCY_DAYS, deadlineUrgency, daysToNextDate, warnsAboutTime } from '@/ActivitySpace/execution/element/gantt/ganttUrgency';

describe('Gantt urgency', () => {
  it('is nothing far from the date, or with no date', () => {
    expect(deadlineUrgency(null)).toBe(0);
    expect(deadlineUrgency(URGENCY_DAYS)).toBe(0);
    expect(deadlineUrgency(60)).toBe(0);
  });

  it('warms in a straight line and is full on the day and after it', () => {
    expect(deadlineUrgency(URGENCY_DAYS / 2)).toBeCloseTo(0.5);
    expect(deadlineUrgency(1)).toBeGreaterThan(deadlineUrgency(7));
    expect(deadlineUrgency(0)).toBe(1);
    expect(deadlineUrgency(-5)).toBe(1);
  });

  it('measures against the soonest date still ahead, milestones included', () => {
    expect(daysToNextDate('2026-11-14', ['2026-12-01', '2026-11-20', null])).toBe(6);
    expect(daysToNextDate('2026-11-14', ['2026-11-14'])).toBe(0);
  });

  it('measures against the latest date when all have passed, and is null with none', () => {
    expect(daysToNextDate('2026-11-14', ['2026-11-01', '2026-11-10'])).toBe(-4);
    expect(daysToNextDate('2026-11-14', [null, undefined])).toBeNull();
  });

  it('leaves finished and set-aside work alone', () => {
    expect(warnsAboutTime('done')).toBe(false);
    expect(warnsAboutTime('cancelled')).toBe(false);
    expect(warnsAboutTime('in_progress')).toBe(true);
    expect(warnsAboutTime(null)).toBe(true);
  });
});
