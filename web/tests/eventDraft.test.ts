import { describe, expect, it } from 'vitest';
import { draftFromEvent, draftFromSlot, draftMinutes, draftProblem, durationLabel, inputFromDraft } from '@/ActivitySpace/calendar/eventDraft';

describe('eventDraft', () => {
  it('a spot on the hour grid starts a half-hour event there; the button starts an all-day one', () => {
    expect(draftFromSlot('2026-11-10', 13 * 60 + 30)).toMatchObject({ allDay: false, startDate: '2026-11-10', startTime: '13:30', endTime: '14:00' });
    expect(draftFromSlot('2026-11-10', 23 * 60 + 30)).toMatchObject({ startTime: '23:30', endTime: '23:59' });
    expect(draftFromSlot('2026-11-10', null)).toMatchObject({ allDay: true, startDate: '2026-11-10', endDate: '2026-11-10' });
  });

  it('names what keeps a draft from being saved', () => {
    const d = draftFromSlot('2026-11-10', 9 * 60);
    expect(draftProblem(d)).toBe('title');
    expect(draftProblem({ ...d, title: '定例' })).toBeNull();
    expect(draftProblem({ ...d, title: '定例', endTime: '09:00' })).toBe('times');
    // A timed event may run past midnight into a later day.
    expect(draftProblem({ ...d, title: '夜勤', startTime: '22:00', endDate: '2026-11-11', endTime: '06:00' })).toBeNull();
    expect(draftProblem({ ...d, title: '定例', endDate: '2026-11-09' })).toBe('dates');
    const all = { ...draftFromSlot('2026-11-10', null), title: '休み' };
    expect(draftProblem({ ...all, endDate: '2026-11-09' })).toBe('dates');
    expect(draftProblem({ ...all, endDate: '2026-11-12' })).toBeNull();
  });

  it('writes a timed event with its times and an all-day event without them', () => {
    const timed = { ...draftFromSlot('2026-11-10', 9 * 60), title: ' 定例 ', elementIds: ['e1'] };
    expect(inputFromDraft(timed)).toEqual({ title: '定例', start_date: '2026-11-10', end_date: '2026-11-10', start_time: '09:00', end_time: '09:30', element_ids: ['e1'] });
    const all = { ...draftFromSlot('2026-11-10', null), title: '休み', endDate: '2026-11-12' };
    expect(inputFromDraft(all)).toMatchObject({ end_date: '2026-11-12', start_time: null, end_time: null });
  });

  it('says how long a timed draft runs', () => {
    const d = draftFromSlot('2026-11-10', 9 * 60);
    expect(draftMinutes(d)).toBe(30);
    expect(draftMinutes({ ...d, endTime: '10:30' })).toBe(90);
    expect(draftMinutes({ ...d, startTime: '22:00', endDate: '2026-11-11', endTime: '06:00' })).toBe(480);
    expect(draftMinutes({ ...d, allDay: true })).toBeNull();
    expect(durationLabel(30)).toBe('30m');
    expect(durationLabel(90)).toBe('1h 30m');
    expect(durationLabel(60)).toBe('1h');
    expect(durationLabel(1440 + 180)).toBe('1d 3h');
  });

  it('reads an event back for editing', () => {
    const d = draftFromEvent({ id: 'x', activity_space_id: 's', title: '定例', start_date: '2026-11-10', end_date: '2026-11-10', start_time: '09:00:00', end_time: '10:30:00', created_by: 'u', element_ids: ['e1'] });
    expect(d).toMatchObject({ allDay: false, startTime: '09:00', endTime: '10:30', elementIds: ['e1'] });
  });
});
