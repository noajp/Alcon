import { describe, expect, it } from 'vitest';
import { arrangeViews, nextViewTabState, parseViewTabState } from '@/Function/shared/tool/viewTabs';

const views = ['today', 'pipeline', 'deals', 'forecast'].map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((v) => v.id);

describe('arrangeViews', () => {
  it('keeps the tool order when nothing is stored', () => {
    const { shown, hidden } = arrangeViews(views, null, 'today');
    expect(ids(shown)).toEqual(['today', 'pipeline', 'deals', 'forecast']);
    expect(hidden).toEqual([]);
  });

  it('pins the home view first even when stored elsewhere', () => {
    const { shown } = arrangeViews(views, { order: ['deals', 'today', 'pipeline', 'forecast'], hidden: [] }, 'today');
    expect(ids(shown)).toEqual(['today', 'deals', 'pipeline', 'forecast']);
  });

  it('never hides the home view', () => {
    const { shown, hidden } = arrangeViews(views, { order: [], hidden: ['today', 'forecast'] }, 'today');
    expect(ids(shown)).toEqual(['today', 'pipeline', 'deals']);
    expect(ids(hidden)).toEqual(['forecast']);
  });

  it('drops ids the tool no longer has and appends views it added', () => {
    const { shown } = arrangeViews(views, { order: ['gone', 'deals', 'today'], hidden: ['gone'] }, 'today');
    expect(ids(shown)).toEqual(['today', 'deals', 'pipeline', 'forecast']);
  });
});

describe('nextViewTabState', () => {
  const current = arrangeViews(views, null, 'today');

  it('hides a view and remembers its place', () => {
    const next = nextViewTabState(current, { hide: 'deals' });
    const { shown, hidden } = arrangeViews(views, next, 'today');
    expect(ids(shown)).toEqual(['today', 'pipeline', 'forecast']);
    expect(ids(hidden)).toEqual(['deals']);
  });

  it('shows a hidden view again at the end of the strip', () => {
    const hiddenDeals = arrangeViews(views, nextViewTabState(current, { hide: 'deals' }), 'today');
    const { shown, hidden } = arrangeViews(views, nextViewTabState(hiddenDeals, { show: 'deals' }), 'today');
    expect(ids(shown)).toEqual(['today', 'pipeline', 'forecast', 'deals']);
    expect(hidden).toEqual([]);
  });

  it('reorders the shown views and keeps the hidden ones hidden', () => {
    const hiddenForecast = arrangeViews(views, nextViewTabState(current, { hide: 'forecast' }), 'today');
    const { shown, hidden } = arrangeViews(views, nextViewTabState(hiddenForecast, { reorder: ['today', 'deals', 'pipeline'] }), 'today');
    expect(ids(shown)).toEqual(['today', 'deals', 'pipeline']);
    expect(ids(hidden)).toEqual(['forecast']);
  });
});

describe('parseViewTabState', () => {
  it('reads a stored state', () => {
    expect(parseViewTabState('{"order":["a","b"],"hidden":["b"]}')).toEqual({ order: ['a', 'b'], hidden: ['b'] });
  });

  it('tolerates junk', () => {
    expect(parseViewTabState(null)).toBeNull();
    expect(parseViewTabState('not json')).toBeNull();
    expect(parseViewTabState('42')).toBeNull();
    expect(parseViewTabState('{"order":[1,"a"],"hidden":"x"}')).toEqual({ order: ['a'], hidden: [] });
  });
});
