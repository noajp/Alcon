import { describe, expect, it } from 'vitest';
import { presetPath } from '@/Function/office/presetGeometry';

describe('presetPath', () => {
  it('draws the common shapes with their adjust values', () => {
    expect(presetPath('rect', 100, 50)?.fill).toBe('M0 0 L100 0 L100 50 L0 50 Z');
    expect(presetPath('triangle', 100, 50)?.fill).toBe('M50 0 L100 50 L0 50 Z');
    expect(presetPath('triangle', 100, 50, { adj: 0 })?.fill).toBe('M0 0 L100 50 L0 50 Z');
    expect(presetPath('chevron', 100, 40)?.fill).toBe('M0 0 L80 0 L100 20 L80 40 L0 40 L20 20 Z');
    // A right arrow: shaft half the height by default, a third with adj1.
    expect(presetPath('rightArrow', 200, 60, { adj1: 33333 })?.fill).toBe('M0 20 L170 20 L170 0 L200 30 L170 60 L170 40 L0 40 Z');
    expect(presetPath('roundRect', 100, 50)?.fill).toMatch(/^M8\.33 0 H91\.67 A8\.33/);
  });

  it('marks lines and connectors as open paths, rings as even-odd', () => {
    expect(presetPath('straightConnector1', 100, 0)).toEqual({ fill: 'M0 0 L100 0', line: true });
    expect(presetPath('bentConnector3', 100, 40)).toEqual({ fill: 'M0 0 H50 V40 H100', line: true });
    expect(presetPath('donut', 100, 100)?.evenOdd).toBe(true);
  });

  it('draws the flowchart symbols decks use', () => {
    expect(presetPath('flowChartExtract', 100, 50)?.fill).toBe('M50 0 L100 50 L0 50 Z');
    expect(presetPath('flowChartMerge', 100, 50)?.fill).toBe('M50 50 L100 0 L0 0 Z');
    expect(presetPath('flowChartDelay', 100, 50)?.fill).toBe('M0 0 H50 A50 25 0 0 1 50 50 H0 Z');
    for (const p of ['flowChartOffpageConnector', 'flowChartPunchedCard', 'flowChartCollate', 'flowChartSort', 'flowChartOr', 'flowChartSummingJunction', 'flowChartInternalStorage', 'flowChartMultidocument']) {
      expect(presetPath(p, 100, 50)).not.toBeNull();
    }
  });

  it('returns null for a shape it does not know, so the view draws a box', () => {
    expect(presetPath('gear9', 100, 100)).toBeNull();
  });
});
