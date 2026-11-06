import { describe, expect, it } from 'vitest';
import { openScreenFrom } from '@/Frame/openScreen';

const isView = (v: string) => ['inbox', 'strategy', 'settings', 'tables'].includes(v);

describe('the open screen a reload comes back to', () => {
  it('reads back the view, where it was, and the Settings page', () => {
    const s = openScreenFrom({
      view: 'settings', navigation: { objectId: null, strategyId: 's1' },
      settingsReturn: 'strategy', settings: { section: 'integrations', tab: 'external' },
    }, isView);
    expect(s).toEqual({
      view: 'settings', navigation: { objectId: null, strategyId: 's1' },
      settingsReturn: 'strategy', settings: { section: 'integrations', tab: 'external' },
    });
  });

  it('drops a one-time request riding on the navigation', () => {
    const s = openScreenFrom({ view: 'strategy', navigation: { objectId: null, strategyCreate: true } }, isView);
    expect(s?.navigation).toEqual({ objectId: null });
  });

  it('opens the home view for a view the shell does not have or an unreadable entry', () => {
    expect(openScreenFrom({ view: 'gone', navigation: {} }, isView)).toBeNull();
    expect(openScreenFrom({ view: 'inbox' }, isView)).toBeNull();
    expect(openScreenFrom('inbox', isView)).toBeNull();
    expect(openScreenFrom(null, isView)).toBeNull();
  });

  it('forgets a Back target that is not a view', () => {
    expect(openScreenFrom({ view: 'settings', navigation: { objectId: 'o1' }, settingsReturn: 'gone' }, isView)?.settingsReturn).toBeNull();
  });
});
