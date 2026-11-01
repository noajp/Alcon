import { describe, expect, it } from 'vitest';
import { dragRange } from '@/ActivitySpace/execution/element/gantt/ganttRange';

const d = (day: number) => new Date(2026, 10, day);
const ymd = (x: Date | null) => (x ? `${x.getMonth() + 1}/${x.getDate()}` : null);
const show = (r: { start: Date | null; end: Date | null }) => [ymd(r.start), ymd(r.end)];

describe('Gantt drag', () => {
  it('turns a due-only bar into a range by pulling its start edge', () => {
    expect(show(dragRange({ start: null, end: d(10) }, 'resize-start', -3))).toEqual(['11/7', '11/10']);
  });

  it('turns a start-only bar into a range by pulling its end edge', () => {
    expect(show(dragRange({ start: d(10), end: null }, 'resize-end', 4))).toEqual(['11/10', '11/14']);
  });

  it('never lets an edge pass the other', () => {
    expect(show(dragRange({ start: d(5), end: d(8) }, 'resize-start', 6))).toEqual(['11/8', '11/8']);
    expect(show(dragRange({ start: d(5), end: d(8) }, 'resize-end', -9))).toEqual(['11/5', '11/5']);
  });

  it('moves only the ends that are set', () => {
    expect(show(dragRange({ start: null, end: d(10) }, 'move', 2))).toEqual([null, '11/12']);
    expect(show(dragRange({ start: d(1), end: d(3) }, 'move', -1))).toEqual(['10/31', '11/2']);
  });
});
