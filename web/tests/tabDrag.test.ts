import { describe, expect, it } from 'vitest';
import { constrainTabDrag } from '../src/Frame/tabDrag';

const drag = (x: number, left = 100, right = 180, stripRight = 400) => constrainTabDrag({
  transform: { x, y: 200, scaleX: 1, scaleY: 1 },
  draggingNodeRect: { left, right }, containerNodeRect: { left: 20, right: stripRight },
} as Parameters<typeof constrainTabDrag>[0]);

describe('tab drag bounds', () => {
  it('clamps arbitrarily far pointer movement to either edge', () => {
    expect(drag(100000).x).toBe(220);
    expect(drag(-100000).x).toBe(-80);
  });
  it('preserves in-range horizontal movement and removes vertical movement', () => {
    expect(drag(40)).toEqual({ x: 40, y: 0, scaleX: 1, scaleY: 1 });
  });
  it('handles a tab wider than its visible strip without reversed bounds', () => {
    expect(drag(1000, 20, 500, 200).x).toBe(0);
  });
});
