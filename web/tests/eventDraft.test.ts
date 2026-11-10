import { describe, expect, it } from 'vitest';
import { draftFromEvent, draftFromSlot, draftProblem, inputFromDraft } from '@/ActivitySpace/calendar/eventDraft';

describe('eventDraft', () => {
  it('a spot on the hour grid starts a one-hour event there; the button starts an all-day one', () => {
    expect(draftFromSlot('2026-11-10', 13 * 60 + 30)).toMatchObject({ allDay: false, startDate: '2026-11-10', startTime: '13:30', endTime: '14:30' });
    expect(draftFromSlot('2026-11-10', 23 * 60 + 30)).toMatchObject({ startTime: '23:00', endTime: '23:59' });
    expect(draftFromSlot('2026-11-10', null)).toMatchObject({ allDay: true, startDate: '2026-11-10', endDate: '2026-11-10' });
  });

  it('names what keeps a draft from being saved', () => {
    const d = draftFromSlot('2026-11-10', 9 * 60);
    expect(draftProblem(d)).toBe('title');
    expect(draftProblem({ ...d, title: '定例' })).toBeNull();
    expect(draftProblem({ ...d, title: '定例', endTime: '09:00' })).toBe('times');
    const all = { ...draftFromSlot('2026-11-10', null), title: '休み' };
    expect(draftProblem({ ...all, endDate: '2026-11-09' })).toBe('dates');
    expect(draftProblem({ ...all, endDate: '2026-11-12' })).toBeNull();
  });

  it('writes a timed event as one day and an all-day event without times', () => {
    const timed = { ...draftFromSlot('2026-11-10', 9 * 60), title: ' 定例 ', endDate: '2026-11-12', elementIds: ['e1'] };
    expect(inputFromDraft(timed)).toEqual({ title: '定例', start_date: '2026-11-10', end_date: '2026-11-10', start_time: '09:00', end_time: '10:00', element_ids: ['e1'] });
    const all = { ...draftFromSlot('2026-11-10', null), title: '休み', endDate: '2026-11-12' };
    expect(inputFromDraft(all)).toMatchObject({ end_date: '2026-11-12', start_time: null, end_time: null });
  });

  it('reads an event back for editing', () => {
    const d = draftFromEvent({ id: 'x', activity_space_id: 's', title: '定例', start_date: '2026-11-10', end_date: '2026-11-10', start_time: '09:00:00', end_time: '10:30:00', created_by: 'u', element_ids: ['e1'] });
    expect(d).toMatchObject({ allDay: false, startTime: '09:00', endTime: '10:30', elementIds: ['e1'] });
  });
});
