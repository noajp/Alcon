import { describe, expect, it } from 'vitest';
import { scopedView, settingsInScope, spaceScope, viewInScope } from '@/Function/space/spaceScope';
import { MODE_META } from '@/shell/railApps';
import { SETTINGS_NAV } from '@/Function/settings/settingsNav';

// What an audit Space shows (ADR 0048): the Space, People and Audit — no
// way into Strategy or Execution.
describe('space scope', () => {
  it('reads anything but audit as full, so an unread or unknown value shows everything', () => {
    expect(spaceScope('audit')).toBe('audit');
    expect(spaceScope('full')).toBe('full');
    expect(spaceScope(undefined)).toBe('full');
    expect(spaceScope('other')).toBe('full');
  });

  it('keeps every Workspace view out of an audit Space', () => {
    for (const view of [...MODE_META.workspace.views, 'workload', 'my-elements', 'home']) {
      expect(viewInScope(view, 'audit')).toBe(false);
      expect(scopedView(view, 'audit')).toBe('audit');
      expect(viewInScope(view, 'full')).toBe(true);
    }
  });

  it('shows the Space, People and Audit, and the way back to them', () => {
    for (const view of ['audit', 'team', 'inbox', 'settings', 'profile']) expect(scopedView(view, 'audit')).toBe(view);
  });

  it('lists no Strategy or Execution settings in an audit Space', () => {
    const hidden = SETTINGS_NAV.filter(s => s.title === 'Strategy settings' || s.title === 'Execution settings').flatMap(s => s.items);
    expect(hidden.length).toBeGreaterThan(0);
    for (const item of hidden) expect(settingsInScope(item.id, 'audit')).toBe(false);
    expect(settingsInScope('workspace', 'audit')).toBe(true);
    expect(settingsInScope('domain', 'full')).toBe(true);
  });
});
