import { describe, expect, it } from 'vitest';
import { chartFileName, chartSlots, effectiveColor, withSlotColor } from '@/AIP/ai/chartColors';
import type { ChartSpec } from '@/AIP/ai/chartSpec';

// The default colors, pinned literally: the accent, then the chart hues.
const THEME = [
  'var(--accent-default)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-1)',
];

// A person's chart colors: resolution is the theme family unless a
// slot carries their hex. Pie slots are keyed by row name; the rest by
// series key. The spec itself never carries a color.

const bar: ChartSpec = {
  type: 'bar',
  title: '売上',
  data: [{ name: 'A', 売上: 3, 利益: 1 }, { name: 'B', 売上: 4, 利益: 2 }],
  series: ['売上', '利益'],
};
const pie: ChartSpec = {
  type: 'pie',
  data: [{ name: '12月', n: 3 }, { name: '1月', n: 5 }],
  series: ['n'],
};

describe('chartSlots', () => {
  it('lists series keys in order for bar/line/area', () => {
    expect(chartSlots(bar)).toEqual([
      { key: '売上', label: '売上', index: 0 },
      { key: '利益', label: '利益', index: 1 },
    ]);
  });
  it('lists row names for a pie — the slots the legend draws', () => {
    expect(chartSlots(pie)).toEqual([
      { key: '12月', label: '12月', index: 0 },
      { key: '1月', label: '1月', index: 1 },
    ]);
  });
});

describe('effectiveColor', () => {
  it('is the theme family without overrides, wrapping by index', () => {
    for (let i = 0; i < THEME.length * 2; i++) {
      expect(effectiveColor(undefined, '売上', i)).toBe(THEME[i % THEME.length]);
    }
    expect(effectiveColor({}, '売上', 0)).toBe(THEME[0]);
  });
  it('lets a per-series override win, leaving the others on the theme', () => {
    const overrides = { '利益': '#ef4444' };
    expect(effectiveColor(overrides, '利益', 1)).toBe('#ef4444');
    expect(effectiveColor(overrides, '売上', 0)).toBe(THEME[0]);
  });
  it('resolves a pie slice by its row name', () => {
    const overrides = { '12月': '#8b8d98' };
    const slots = chartSlots(pie);
    expect(slots.map((s) => effectiveColor(overrides, s.key, s.index))).toEqual(['#8b8d98', THEME[1]]);
  });
  it('ignores keys no slot claims', () => {
    const overrides = { '存在しない系列': '#123456' };
    expect(effectiveColor(overrides, '売上', 0)).toBe(THEME[0]);
    expect(effectiveColor(overrides, '利益', 1)).toBe(THEME[1]);
  });
});

describe('withSlotColor', () => {
  it('sets and clears a slot without touching the others', () => {
    const start = { '売上': '#111111' };
    expect(withSlotColor(start, '利益', '#222222')).toEqual({ '売上': '#111111', '利益': '#222222' });
    expect(withSlotColor(start, '売上', null)).toEqual({});
    expect(start).toEqual({ '売上': '#111111' });
  });
  it('an empty record (a reset) restores the theme colors', () => {
    const cleared = withSlotColor({ '売上': '#111111' }, '売上', null);
    expect(effectiveColor(cleared, '売上', 0)).toBe(THEME[0]);
  });
});

describe('chartFileName', () => {
  it('names the PNG after the chart title, else "chart"', () => {
    expect(chartFileName(bar)).toBe('売上.png');
    expect(chartFileName(pie)).toBe('chart.png');
  });
});
