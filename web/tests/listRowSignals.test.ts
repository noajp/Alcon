import { describe, expect, it } from 'vitest';
import { nameTrackWidth, rowLabels, signalsTrackWidth } from '@/Function/shared/listTable/shared';

// A row of the Elements list is read for its title first. Its labels
// are folded to the first two and a count, and the rows' signals never
// take more than half of the name column.
describe('rowLabels', () => {
  it('shows the first two and counts the rest', () => {
    expect(rowLabels(['security', 'run-1', 'confirmed', 'rls', 'github'])).toEqual({ shown: ['security', 'run-1'], more: 3 });
    expect(rowLabels(['bug', 'ui'])).toEqual({ shown: ['bug', 'ui'], more: 0 });
    expect(rowLabels(['bug'])).toEqual({ shown: ['bug'], more: 0 });
  });

  it('takes a row without labels', () => {
    expect(rowLabels(null)).toEqual({ shown: [], more: 0 });
    expect(rowLabels(undefined)).toEqual({ shown: [], more: 0 });
    expect(rowLabels([])).toEqual({ shown: [], more: 0 });
  });
});

describe('signalsTrackWidth', () => {
  it('gives the signals what they need while the title keeps half the column', () => {
    expect(signalsTrackWidth(180, 600)).toBe(180);
    expect(signalsTrackWidth(420, 600)).toBe(300);
  });

  it('never leaves the title under 160px, and never goes negative', () => {
    expect(signalsTrackWidth(400, 280)).toBe(120);
    expect(signalsTrackWidth(400, 120)).toBe(0);
    expect(signalsTrackWidth(0, 600)).toBe(0);
  });
});

describe('nameTrackWidth', () => {
  it('is what the view leaves Name, when that is more than its set width', () => {
    // A 1100px view with 52 + 240 of other columns leaves 808 to Name.
    expect(nameTrackWidth(400, 1100, 292)).toBe(808);
    // So two labels and the count (about 270px with a mark) fit beside the title.
    expect(signalsTrackWidth(270, nameTrackWidth(400, 1100, 292))).toBe(270);
  });

  it('is the set width when the table is wider than the view, or the view is not measured yet', () => {
    expect(nameTrackWidth(400, 500, 292)).toBe(400);
    expect(nameTrackWidth(400, 0, 292)).toBe(400);
  });
});

